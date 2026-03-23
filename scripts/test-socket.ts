/**
 * Socket.io Test Script
 * 
 * Tests the full proctoring pipeline without a frontend:
 *   1. Logs in via REST API → gets accessToken cookie
 *   2. Connects to /proctoring namespace as a student
 *   3. Starts a session → gets QR pairing code
 *   4. Simulates phone pairing
 *   5. Sends fake Sentinel violation flags
 *   6. Connects as a proctor and observes events
 *
 * Usage:
 *   npx ts-node scripts/test-socket.ts
 * 
 * Prerequisites:
 *   - Server must be running (npm run dev)
 *   - At least one user registered (student + admin/proctor)
 */

import { io, Socket } from 'socket.io-client';

const BASE_URL = 'http://localhost:5000';
const WS_URL = `${BASE_URL}/proctoring`;

// ─── CONFIG: Update these with real credentials ──────
const STUDENT_EMAIL = 'test@example.com';
const STUDENT_PASSWORD = 'Test12345';
const PROCTOR_EMAIL = 'testa@example.com';
const PROCTOR_PASSWORD = 'Test12345';
const EXAM_ID = 'EF1911'; // Replace after creating an exam
// ─────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Login and get access token.
 */
async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  if (!data.success) throw new Error(`Login failed: ${data.message}`);

  console.log(`✅ Logged in as ${email} (role: ${data.data.user.role})`);
  return data.data.accessToken;
}

/**
 * Connect to Socket.io with token.
 */
function connectSocket(token: string, role: string): Socket {
  const socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log(`🔌 [${role}] Connected to /proctoring (id: ${socket.id})`);
  });

  socket.on('connect_error', (err) => {
    console.error(`❌ [${role}] Connection failed: ${err.message}`);
  });

  return socket;
}

async function runTest() {
  console.log('\n🧪 ═══ Socket.io Proctoring Pipeline Test ═══\n');

  // Step 1: Login both users
  console.log('--- Step 1: Login ---');
  const studentToken = await login(STUDENT_EMAIL, STUDENT_PASSWORD);
  const proctorToken = await login(PROCTOR_EMAIL, PROCTOR_PASSWORD);

  await sleep(500);

  // Step 2: Connect proctor
  console.log('\n--- Step 2: Connect Proctor ---');
  const proctorSocket = connectSocket(proctorToken, 'PROCTOR');

  await sleep(1000);

  // Proctor joins exam room
  proctorSocket.emit('proctor:join_exam', { examId: EXAM_ID });

  proctorSocket.on('proctor:exam_state', (data) => {
    console.log(`📊 [PROCTOR] Exam state: ${data.sessionCount} sessions`);
  });

  proctorSocket.on('session:update', (data) => {
    console.log(`📢 [PROCTOR] Session update: ${data.type} → ${data.sessionId?.slice(0, 8)}...`);
  });

  proctorSocket.on('violation:processed', (data) => {
    console.log(`🚨 [PROCTOR] Violation: ${data.type} (confidence: ${data.confidence}) → trust: ${data.trustScore}`);
  });

  proctorSocket.on('trustscore:update', (data) => {
    console.log(`📈 [PROCTOR] Trust score: ${data.trustScore} (zone: ${data.trustZone})`);
  });

  await sleep(500);

  // Step 3: Connect student
  console.log('\n--- Step 3: Connect Student ---');
  const studentSocket = connectSocket(studentToken, 'STUDENT');

  await sleep(1000);

  // Step 4: Start session
  console.log('\n--- Step 4: Start Exam Session ---');
  const sessionId = `test-session-${Date.now()}`;

  studentSocket.emit('session:start', { examId: EXAM_ID, sessionId });

  studentSocket.on('session:qr_code', (data) => {
    console.log(`📱 [STUDENT] QR code received! Code: ${data.pairingCode.slice(0, 8)}... (expires in ${data.expiresIn}s)`);

    // Step 5: Simulate phone pairing (in real life, phone scans QR)
    console.log('\n--- Step 5: Simulate Phone Pairing ---');
    const phoneSocket = connectSocket(studentToken, 'PHONE');

    phoneSocket.on('connect', () => {
      phoneSocket.emit('device:pair:request', { pairingCode: data.pairingCode });
    });

    phoneSocket.on('device:paired', (pairData) => {
      console.log(`✅ [PHONE] Paired! Status: ${pairData.status}`);

      // Step 6: Send heartbeats (like a real phone would)
      console.log('\n--- Step 6: Sending Phone Heartbeats ---');
      const heartbeatInterval = setInterval(() => {
        phoneSocket.emit('device:heartbeat');
        console.log('💓 [PHONE] Heartbeat sent');
      }, 5000);

      // Step 7: Simulate Sentinel violations
      setTimeout(async () => {
        console.log('\n--- Step 7: Simulating Sentinel Violations ---');

        const violations = [
          { type: 'gaze_away', confidence: 0.8, timestamp: new Date().toISOString() },
          { type: 'phone_detected', confidence: 0.92, timestamp: new Date().toISOString() },
          { type: 'tab_switch', confidence: 1.0, timestamp: new Date().toISOString() },
        ];

        for (const v of violations) {
          studentSocket.emit('violation:detected', v);
          console.log(`📤 [STUDENT/SENTINEL] Sent: ${v.type} (confidence: ${v.confidence})`);
          await sleep(1500);
        }

        // Step 8: Proctor sends warning
        setTimeout(() => {
          console.log('\n--- Step 8: Proctor Sends Warning ---');
          proctorSocket.emit('proctor:warn', {
            sessionId,
            message: 'Please focus on your exam. Further violations will result in termination.',
            severity: 'warning',
          });
        }, 2000);

        studentSocket.on('proctor:warn', (warning) => {
          console.log(`⚠️  [STUDENT] Warning from proctor: "${warning.message}"`);
        });

        // Cleanup after 10 seconds
        setTimeout(() => {
          console.log('\n--- Test Complete ---');
          clearInterval(heartbeatInterval);
          phoneSocket.disconnect();
          studentSocket.disconnect();
          proctorSocket.disconnect();
          console.log('🔌 All sockets disconnected');
          process.exit(0);
        }, 8000);
      }, 3000);
    });
  });

  studentSocket.on('violation:processed', (data) => {
    console.log(`✅ [STUDENT] Violation acknowledged: ${data.type} → trust: ${data.trustScore}`);
  });

  studentSocket.on('session:freeze', (data) => {
    console.log(`🧊 [STUDENT] SESSION FROZEN: ${data.reason}`);
  });
}

runTest().catch(console.error);
