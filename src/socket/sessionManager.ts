import crypto from 'crypto';
import { logger } from '../utils/logger';
import { VIOLATION_STREAK_MULTIPLIERS } from '../utils/constants';

/**
 * Session Manager
 *
 * In-memory state tracker for active proctoring sessions.
 * Designed for ~15 students per exam room — perfectly fine in-memory.
 *
 * For horizontal scaling (multiple server instances), replace this
 * with a Redis-backed store using the same interface.
 *
 * Structure:
 *   sessions: Map<sessionId, SessionState>
 *   pairingCodes: Map<pairingCode, { sessionId, expiresAt }>
 *   heartbeats: Map<sessionId, NodeJS.Timeout>
 */

export interface SessionState {
  sessionId: string;
  examId: string;
  studentId: string;
  studentSocketId?: string;      // Laptop socket
  phoneSocketId?: string;        // Phone socket (secondary camera)
  status: 'waiting' | 'paired' | 'active' | 'paused' | 'frozen' | 'completed' | 'terminated';
  trustScore: number;
  trustZone: 'green' | 'yellow' | 'red';
  violations: number;
  violationStreaks: Record<string, number>;  // streak count per violation type
  lastViolationAt?: Date;
  lastHeartbeatAt?: Date;
  connectedAt: Date;
  devices: {
    laptop: boolean;
    phone: boolean;
  };
  hardware: string[];  // Connected peripherals reported by client
}

interface PairingCode {
  sessionId: string;
  examId: string;
  studentId: string;
  expiresAt: Date;
}

class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private pairingCodes: Map<string, PairingCode> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();

  private readonly HEARTBEAT_TIMEOUT = 15000; // 15s — freeze session if phone is silent

  // ─── Session CRUD ──────────────────────────────────

  createSession(sessionId: string, examId: string, studentId: string, socketId: string): SessionState {
    const session: SessionState = {
      sessionId,
      examId,
      studentId,
      studentSocketId: socketId,
      status: 'waiting',
      trustScore: 100,
      trustZone: 'green',
      violations: 0,
      violationStreaks: {},
      connectedAt: new Date(),
      devices: { laptop: true, phone: false },
      hardware: [],
    };

    this.sessions.set(sessionId, session);
    logger.info({ sessionId, examId, studentId }, 'Session created');
    return session;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  getExamSessions(examId: string): SessionState[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.examId === examId,
    );
  }

  updateSession(sessionId: string, updates: Partial<SessionState>): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    Object.assign(session, updates);
    this.sessions.set(sessionId, session);
    return session;
  }

  removeSession(sessionId: string): void {
    this.clearHeartbeatTimer(sessionId);
    this.sessions.delete(sessionId);
    logger.info({ sessionId }, 'Session removed');
  }

  // ─── QR Device Pairing ─────────────────────────────

  /**
   * Generate a time-limited QR pairing code.
   * Code is valid for 2 minutes.
   */
  generatePairingCode(sessionId: string, examId: string, studentId: string): string {
    // 6-char hex code, easy to encode in a QR
    const code = crypto.randomBytes(16).toString('hex');

    this.pairingCodes.set(code, {
      sessionId,
      examId,
      studentId,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 min TTL
    });

    // Auto-cleanup expired codes
    setTimeout(() => {
      this.pairingCodes.delete(code);
    }, 2 * 60 * 1000);

    logger.info({ sessionId, code: code.slice(0, 6) + '...' }, 'Pairing code generated');
    return code;
  }

  /**
   * Validate and consume a pairing code.
   * Returns the session info if valid.
   */
  validatePairingCode(code: string): PairingCode | null {
    const pairing = this.pairingCodes.get(code);
    if (!pairing) return null;

    // Check expiry
    if (new Date() > pairing.expiresAt) {
      this.pairingCodes.delete(code);
      return null;
    }

    // Consume the code (single-use)
    this.pairingCodes.delete(code);
    return pairing;
  }

  // ─── Heartbeat Monitoring ──────────────────────────

  /**
   * Record a heartbeat from the phone.
   * Resets the timeout timer. If no heartbeat within HEARTBEAT_TIMEOUT,
   * the session is frozen.
   */
  recordHeartbeat(
    sessionId: string,
    onTimeout: (sessionId: string) => void,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastHeartbeatAt = new Date();

    // Clear existing timer
    this.clearHeartbeatTimer(sessionId);

    // Set new timer — if phone goes silent, freeze session
    const timer = setTimeout(() => {
      logger.warn({ sessionId }, 'Phone heartbeat timeout — freezing session');
      onTimeout(sessionId);
    }, this.HEARTBEAT_TIMEOUT);

    this.heartbeatTimers.set(sessionId, timer);
  }

  clearHeartbeatTimer(sessionId: string): void {
    const timer = this.heartbeatTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.heartbeatTimers.delete(sessionId);
    }
  }

  // ─── Trust Score ───────────────────────────────────

  /**
   * Apply a violation deduction to a session's trust score.
   * Returns the updated session.
   */
  applyTrustDeduction(
    sessionId: string,
    violationType: string,
    baseDeduction: number,
    confidence: number,
  ): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Track streak count for this violation type
    const streak = (session.violationStreaks[violationType] || 0) + 1;
    session.violationStreaks[violationType] = streak;

    // Get streak multiplier (capped at last index)
    const multiplierIndex = Math.min(streak - 1, VIOLATION_STREAK_MULTIPLIERS.length - 1);
    const multiplier = VIOLATION_STREAK_MULTIPLIERS[multiplierIndex];

    // actualDeduction = base × confidence × streakMultiplier
    const actualDeduction = Math.round(baseDeduction * Math.min(confidence, 1) * multiplier);
    session.trustScore = Math.max(0, session.trustScore - actualDeduction);
    session.violations += 1;
    session.lastViolationAt = new Date();

    // Update zone
    if (session.trustScore >= 80) session.trustZone = 'green';
    else if (session.trustScore >= 50) session.trustZone = 'yellow';
    else session.trustZone = 'red';

    this.sessions.set(sessionId, session);
    return session;
  }

  // ─── Student Disconnect Handling ───────────────────

  handleStudentDisconnect(sessionId: string, device: 'laptop' | 'phone'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.devices[device] = false;

    if (device === 'phone') {
      session.phoneSocketId = undefined;
      // Don't immediately freeze — heartbeat timer will handle it
    } else {
      session.studentSocketId = undefined;
    }

    this.sessions.set(sessionId, session);
    logger.info({ sessionId, device }, 'Device disconnected from session');
  }

  // ─── Stats ─────────────────────────────────────────

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getExamSessionCount(examId: string): number {
    return this.getExamSessions(examId).length;
  }

  /**
   * Get all sessions across all exams.
   * Used by background workers (trust decay, session cleanup).
   */
  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }
}

export const sessionManager = new SessionManager();
