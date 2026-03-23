import { Namespace, Socket } from 'socket.io';
import { SOCKET_EVENTS, TRUST_DEDUCTIONS, VIOLATION_TYPES } from '../../utils/constants';
import { SocketAuthPayload } from '../../types';
import { sessionManager } from '../sessionManager';
import { sessionService } from '../../modules/session/session.service';
import { logger } from '../../utils/logger';

/**
 * Student Socket Handlers
 *
 * Handles:
 * 1. Session join (laptop connects to exam room)
 * 2. QR code generation for device pairing
 * 3. Phone pairing (phone scans QR → joins session)
 * 4. Phone heartbeat tracking (5s intervals from the phone)
 * 5. Sentinel flag ingestion (Edge AI sends violation events)
 * 6. Hardware registry reporting
 * 7. Student ready confirmation
 * 8. Student session completion (notification only — answers via REST)
 * 9. Liveness challenge response
 * 10. Evidence snapshot upload notification
 * 11. Session reconnect with resume token
 */
export const registerStudentHandlers = (
  ns: Namespace,
  socket: Socket,
): void => {
  const user = socket.data.user as SocketAuthPayload;

  // ─── 1. Session Start (Laptop) ─────────────────────
  socket.on(SOCKET_EVENTS.SESSION_START, (data: { examId: string; sessionId: string }) => {
    const { examId, sessionId } = data;

    // Create session in manager
    const session = sessionManager.createSession(sessionId, examId, user.userId, socket.id);

    // Update socket auth data
    socket.data.user = { ...user, sessionId, examId };

    // Join rooms
    socket.join(`exam:${examId}`);                    // All exam participants
    socket.join(`student:${sessionId}`);              // Individual student room

    // Generate QR pairing code for the phone
    const pairingCode = sessionManager.generatePairingCode(sessionId, examId, user.userId);

    // Send pairing code to the student's laptop
    socket.emit('session:qr_code', {
      pairingCode,
      sessionId,
      expiresIn: 120, // seconds
    });

    // Notify proctors that a student has joined
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'student_joined',
      sessionId,
      studentId: user.userId,
      trustScore: session.trustScore,
      trustZone: session.trustZone,
      timestamp: new Date().toISOString(),
    });

    logger.info({ sessionId, examId, studentId: user.userId }, 'Student started exam session');
  });

  // ─── 2. Device Pair (Phone scans QR) ───────────────
  socket.on(SOCKET_EVENTS.DEVICE_PAIR_REQUEST, (data: { pairingCode: string }) => {
    const pairing = sessionManager.validatePairingCode(data.pairingCode);

    if (!pairing) {
      socket.emit(SOCKET_EVENTS.DEVICE_PAIR_FAILED, {
        error: 'Invalid or expired pairing code. Generate a new QR code.',
      });
      return;
    }

    const session = sessionManager.getSession(pairing.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.DEVICE_PAIR_FAILED, {
        error: 'Session not found.',
      });
      return;
    }

    // Update session with phone socket
    sessionManager.updateSession(pairing.sessionId, {
      phoneSocketId: socket.id,
      status: 'paired',
      devices: { ...session.devices, phone: true },
    });

    // Phone joins the session room
    socket.join(`student:${pairing.sessionId}`);
    socket.join(`exam:${pairing.examId}`);
    socket.data.user = {
      ...user,
      sessionId: pairing.sessionId,
      examId: pairing.examId,
    };

    // Start heartbeat monitoring for the phone
    sessionManager.recordHeartbeat(pairing.sessionId, handleHeartbeatTimeout);

    // Notify laptop that phone is paired
    ns.to(`student:${pairing.sessionId}`).emit(SOCKET_EVENTS.DEVICE_PAIR_SUCCESS, {
      sessionId: pairing.sessionId,
      device: 'phone',
      status: 'paired',
      timestamp: new Date().toISOString(),
    });

    // Notify proctors
    ns.to(`exam:${pairing.examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'device_paired',
      sessionId: pairing.sessionId,
      studentId: pairing.studentId,
      device: 'phone',
      timestamp: new Date().toISOString(),
    });

    logger.info({ sessionId: pairing.sessionId }, 'Phone paired successfully');
  });

  // ─── 3. Phone Heartbeat ────────────────────────────
  socket.on(SOCKET_EVENTS.DEVICE_HEARTBEAT, () => {
    const sessionId = socket.data.user?.sessionId;
    if (!sessionId) return;

    sessionManager.recordHeartbeat(sessionId, handleHeartbeatTimeout);
  });

  // ─── 4. Sentinel Flag Ingestion ────────────────────
  // Edge AI on the client sends lightweight JSON violation events.
  // ALL violation types use the SAME payload shape.
  socket.on(SOCKET_EVENTS.VIOLATION_DETECTED, (data: {
    type: string;
    confidence: number;
    timestamp: string;          // ISO 8601 from client clock
    metadata?: {
      questionId?: string;
      duration?: number;        // ms, e.g. how long gaze was away
      bbox?: number[];          // bounding box for object detections
      label?: string;           // 'phone' | 'earpiece' | 'book'
      source?: 'laptop' | 'phone';
    };
  }) => {
    const sessionId = socket.data.user?.sessionId;
    const examId = socket.data.user?.examId;
    if (!sessionId || !examId) return;

    const session = sessionManager.getSession(sessionId);
    if (!session || session.status === 'frozen' || session.status === 'terminated') return;

    // Validate violation type
    const validTypes = Object.values(VIOLATION_TYPES) as string[];
    if (!validTypes.includes(data.type)) {
      logger.warn({ type: data.type }, 'Unknown violation type from Sentinel');
      return;
    }

    // Calculate trust deduction
    const baseDeduction = TRUST_DEDUCTIONS[data.type] || 5;
    const confidence = Math.max(0, Math.min(1, data.confidence || 0.5));

    // Apply deduction with streak tracking
    const updated = sessionManager.applyTrustDeduction(sessionId, data.type, baseDeduction, confidence);
    if (!updated) return;

    const serverTime = new Date().toISOString();
    const streakCount = updated.violationStreaks[data.type] || 1;

    // Build the processed violation event
    const violationEvent = {
      sessionId,
      studentId: user.userId,
      examId,
      type: data.type,
      confidence,
      deduction: Math.round(baseDeduction * confidence),
      streakCount,
      trustScore: updated.trustScore,
      trustZone: updated.trustZone,
      totalViolations: updated.violations,
      timestamp: data.timestamp || serverTime,
      serverTime,
      metadata: data.metadata || {},
    };

    // Relay to proctor dashboard in real-time
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.VIOLATION_PROCESSED, violationEvent);

    // Send trust score update to proctors
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.TRUST_SCORE_UPDATE, {
      sessionId,
      studentId: user.userId,
      trustScore: updated.trustScore,
      trustZone: updated.trustZone,
      violations: updated.violations,
      lastViolationAt: updated.lastViolationAt?.toISOString() || null,
      serverTime,
    });

    // Acknowledge receipt to the student client
    socket.emit(SOCKET_EVENTS.VIOLATION_PROCESSED, {
      received: true,
      type: data.type,
      trustScore: updated.trustScore,
    });

    logger.info(
      { sessionId, type: data.type, confidence, streakCount, trustScore: updated.trustScore },
      'Sentinel flag processed',
    );
  });

  // ─── 5. Hardware Registry Update ───────────────────
  socket.on('hardware:update', (data: { devices: string[] }) => {
    const sessionId = socket.data.user?.sessionId;
    const examId = socket.data.user?.examId;
    if (!sessionId || !examId) return;

    sessionManager.updateSession(sessionId, { hardware: data.devices });

    // Notify proctors of hardware changes
    ns.to(`exam:${examId}:proctors`).emit('hardware:update', {
      sessionId,
      studentId: user.userId,
      devices: data.devices,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── 6. QR Code Refresh ────────────────────────────
  socket.on('session:qr_refresh', () => {
    const sessionId = socket.data.user?.sessionId;
    const examId = socket.data.user?.examId;
    if (!sessionId || !examId) return;

    const pairingCode = sessionManager.generatePairingCode(sessionId, examId, user.userId);
    socket.emit('session:qr_code', {
      pairingCode,
      sessionId,
      expiresIn: 120,
    });
  });

  // ─── 7. Student Ready Confirmation ─────────────────
  // Student confirms environment is set up and ready to take the exam.
  socket.on(SOCKET_EVENTS.STUDENT_READY, (data: {
    examId: string;
    sessionId: string;
    systemCheck: {
      cameraPermission: boolean;
      micPermission: boolean;
      screenShareActive: boolean;
      browserFullscreen: boolean;
    };
  }) => {
    const sessionId = data.sessionId || socket.data.user?.sessionId;
    const examId = data.examId || socket.data.user?.examId;
    if (!sessionId || !examId) return;

    const session = sessionManager.getSession(sessionId);
    if (!session) return;

    // Mark session as active
    sessionManager.updateSession(sessionId, { status: 'active' });

    // Notify proctors
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'student_ready',
      sessionId,
      studentId: user.userId,
      systemCheck: data.systemCheck,
      timestamp: new Date().toISOString(),
    });

    logger.info({ sessionId, studentId: user.userId }, 'Student ready for exam');
  });

  // ─── 8. Student Complete (notification only) ───────
  // CRITICAL: Actual answer submission happens via REST (POST /sessions/:id/submit).
  // This socket event is emitted AFTER the student gets 200 OK from REST.
  socket.on(SOCKET_EVENTS.STUDENT_COMPLETE, (data: {
    sessionId: string;
    examId: string;
  }) => {
    const sessionId = data.sessionId || socket.data.user?.sessionId;
    const examId = data.examId || socket.data.user?.examId;
    if (!sessionId || !examId) return;

    const session = sessionManager.getSession(sessionId);
    if (!session) return;

    // Mark session as completed
    sessionManager.updateSession(sessionId, { status: 'completed' });
    sessionManager.clearHeartbeatTimer(sessionId);

    // Persist to DB
    sessionService.completeSession(examId, user.userId).catch((err: unknown) => {
      logger.error({ err }, 'Failed to persist session completion');
    });

    // Notify proctors
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'student_completed',
      sessionId,
      studentId: user.userId,
      timestamp: new Date().toISOString(),
    });

    logger.info({ sessionId, studentId: user.userId }, 'Student completed exam');
  });

  // ─── 9. Liveness Response ──────────────────────────
  // Student responds to a liveness challenge (blink, look left, etc.)
  socket.on(SOCKET_EVENTS.LIVENESS_RESPONSE, (data: {
    sessionId: string;
    challenge: string;
    passed: boolean;
    confidence: number;
    responseTimeMs: number;
  }) => {
    const sessionId = data.sessionId || socket.data.user?.sessionId;
    const examId = socket.data.user?.examId;
    if (!sessionId || !examId) return;

    const serverTime = new Date().toISOString();

    if (!data.passed) {
      // Treat as a violation
      const baseDeduction = TRUST_DEDUCTIONS.liveness_failed || 10;
      const confidence = Math.max(0, Math.min(1, data.confidence || 0.5));
      const updated = sessionManager.applyTrustDeduction(sessionId, 'liveness_failed', baseDeduction, confidence);

      if (updated) {
        const streakCount = updated.violationStreaks.liveness_failed || 1;
        ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.VIOLATION_PROCESSED, {
          sessionId,
          studentId: user.userId,
          examId,
          type: 'liveness_failed',
          confidence,
          deduction: Math.round(baseDeduction * confidence),
          streakCount,
          trustScore: updated.trustScore,
          trustZone: updated.trustZone,
          totalViolations: updated.violations,
          timestamp: serverTime,
          serverTime,
          metadata: { challenge: data.challenge, responseTimeMs: data.responseTimeMs },
        });

        ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.TRUST_SCORE_UPDATE, {
          sessionId,
          studentId: user.userId,
          trustScore: updated.trustScore,
          trustZone: updated.trustZone,
          violations: updated.violations,
          lastViolationAt: updated.lastViolationAt?.toISOString() || null,
          serverTime,
        });
      }
    }

    // Always relay the result to proctors
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.LIVENESS_RESULT, {
      sessionId,
      studentId: user.userId,
      challenge: data.challenge,
      passed: data.passed,
      confidence: data.confidence,
      responseTimeMs: data.responseTimeMs,
      serverTime,
    });

    logger.info(
      { sessionId, challenge: data.challenge, passed: data.passed },
      'Liveness response received',
    );
  });

  // ─── 10. Evidence Upload Notification ──────────────
  // Student notifies server that they uploaded a snapshot via REST.
  // Actual file goes to POST /sessions/:id/evidence.
  socket.on(SOCKET_EVENTS.EVIDENCE_UPLOAD, (data: {
    requestId: string;
    sessionId: string;
    type: 'camera_snapshot' | 'screen_snapshot';
  }) => {
    const examId = socket.data.user?.examId;
    if (!examId) return;

    // Notify proctors that evidence is ready for viewing
    ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.EVIDENCE_AVAILABLE, {
      requestId: data.requestId,
      sessionId: data.sessionId,
      studentId: user.userId,
      type: data.type,
      uploadedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    });

    logger.info(
      { requestId: data.requestId, sessionId: data.sessionId, type: data.type },
      'Evidence upload notification received',
    );
  });

  // ─── 11. Session Reconnect (laptop with resume token) ──
  socket.on(SOCKET_EVENTS.SESSION_RECONNECT, async (data: {
    sessionId: string;
    examId: string;
    resumeToken: string;
  }) => {
    const { sessionId, examId, resumeToken } = data;

    try {
      // Validate resume token against MongoDB
      const isValid = await sessionService.validateResumeToken(sessionId, resumeToken);

      if (!isValid) {
        socket.emit(SOCKET_EVENTS.SESSION_RECONNECT_ACK, {
          sessionId,
          restored: false,
          reason: 'Invalid or expired resume token. Please start a new session.',
          serverTime: new Date().toISOString(),
        });
        return;
      }

      // Restore the in-memory session
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        socket.emit(SOCKET_EVENTS.SESSION_RECONNECT_ACK, {
          sessionId,
          restored: false,
          reason: 'Session no longer exists in memory.',
          serverTime: new Date().toISOString(),
        });
        return;
      }

      // Re-attach socket and restore session
      sessionManager.updateSession(sessionId, {
        studentSocketId: socket.id,
        status: session.devices.phone ? 'active' : 'waiting',
        devices: { ...session.devices, laptop: true },
      });

      // Update socket auth data
      socket.data.user = { ...user, sessionId, examId };

      // Re-join rooms
      socket.join(`exam:${examId}`);
      socket.join(`student:${sessionId}`);

      // If phone is still connected, restart heartbeat
      if (session.devices.phone) {
        sessionManager.recordHeartbeat(sessionId, handleHeartbeatTimeout);
      }

      // Acknowledge reconnection to student
      socket.emit(SOCKET_EVENTS.SESSION_RECONNECT_ACK, {
        sessionId,
        restored: true,
        trustScore: session.trustScore,
        trustZone: session.trustZone,
        violations: session.violations,
        serverTime: new Date().toISOString(),
      });

      // Notify proctors
      ns.to(`exam:${examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
        type: 'student_reconnected',
        sessionId,
        studentId: user.userId,
        timestamp: new Date().toISOString(),
      });

      logger.info({ sessionId, studentId: user.userId }, 'Student reconnected with resume token');
    } catch (err) {
      logger.error({ err, sessionId }, 'Session reconnect failed');
      socket.emit(SOCKET_EVENTS.SESSION_RECONNECT_ACK, {
        sessionId,
        restored: false,
        reason: 'Server error during reconnection.',
        serverTime: new Date().toISOString(),
      });
    }
  });
};

// ─── Heartbeat Timeout Callback ──────────────────────
// Called by sessionManager when phone goes silent for 15s.
const handleHeartbeatTimeout = (sessionId: string): void => {
  const session = sessionManager.getSession(sessionId);
  if (!session) return;
  if (session.status === 'completed' || session.status === 'terminated') return;

  // Freeze the session
  sessionManager.updateSession(sessionId, {
    status: 'frozen',
    devices: { ...session.devices, phone: false },
  });

  // Import here to avoid circular dependency
  const { getProctoringNamespace } = require('../index');
  const ns = getProctoringNamespace();

  const serverTime = new Date().toISOString();

  // Notify the student (laptop) to freeze exam UI
  ns.to(`student:${sessionId}`).emit(SOCKET_EVENTS.SESSION_FREEZE, {
    sessionId,
    reason: 'Phone disconnected — reconnect and scan QR again to resume.',
    timestamp: serverTime,
  });

  // Notify proctors
  ns.to(`exam:${session.examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
    type: 'session_frozen',
    sessionId,
    studentId: session.studentId,
    reason: 'phone_heartbeat_timeout',
    timestamp: serverTime,
  });

  // Apply trust deduction for device disconnect
  const baseDeduction = TRUST_DEDUCTIONS.device_disconnected || 30;
  const updated = sessionManager.applyTrustDeduction(sessionId, 'device_disconnected', baseDeduction, 1.0);
  if (updated) {
    ns.to(`exam:${session.examId}:proctors`).emit(SOCKET_EVENTS.TRUST_SCORE_UPDATE, {
      sessionId,
      studentId: session.studentId,
      trustScore: updated.trustScore,
      trustZone: updated.trustZone,
      violations: updated.violations,
      lastViolationAt: updated.lastViolationAt?.toISOString() || null,
      serverTime,
    });
  }

  logger.warn({ sessionId }, 'Session frozen due to phone heartbeat timeout');
};
