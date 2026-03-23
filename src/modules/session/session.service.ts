import crypto from 'crypto';
import mongoose from 'mongoose';
import { ExamSession, IExamSession } from './examSession.model';
import { Violation } from './violation.model';
import { Enrollment } from '../exam/enrollment.model';
import { Exam } from '../exam/exam.model';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/apiError';
import {
  SESSION_STATUS,
  VIOLATION_SEVERITY,
  ViolationType,
} from '../../utils/constants';

/**
 * Session Service
 *
 * Handles all MongoDB persistence for exam sessions and violations.
 * Works alongside the in-memory SessionManager (which handles real-time state).
 *
 * The flow:
 *   Student starts exam → createSession() → in-memory + MongoDB
 *   Sentinel sends flag → persistViolation() → MongoDB (async, non-blocking)
 *   Session ends       → finalizeSession()  → MongoDB update
 */

// Severity rules: maps violation type to DB severity label
const SEVERITY_MAP: Record<string, string> = {
  gaze_away: VIOLATION_SEVERITY.LOW,
  audio_anomaly: VIOLATION_SEVERITY.LOW,
  object_detected: VIOLATION_SEVERITY.MEDIUM,
  tab_switch: VIOLATION_SEVERITY.MEDIUM,
  whispering_detected: VIOLATION_SEVERITY.MEDIUM,
  phone_detected: VIOLATION_SEVERITY.MEDIUM,
  camera_obstructed: VIOLATION_SEVERITY.HIGH,
  multiple_faces: VIOLATION_SEVERITY.HIGH,
  person_detected: VIOLATION_SEVERITY.HIGH,
  screen_share_stopped: VIOLATION_SEVERITY.HIGH,
  liveness_failed: VIOLATION_SEVERITY.HIGH,
  device_disconnected: VIOLATION_SEVERITY.HIGH,
  vm_detected: VIOLATION_SEVERITY.CRITICAL,
  hdmi_splitter: VIOLATION_SEVERITY.CRITICAL,
};

class SessionService {
  /**
   * Create a new ExamSession record in MongoDB.
   * Called when student successfully joins the exam socket room.
   */
  async createSession(
    examId: string,
    studentId: string,
    sessionId: string,
    userAgent: string,
  ): Promise<IExamSession> {
    // 1. Verify student is enrolled
    const enrollment = await Enrollment.findOne({
      examId: new mongoose.Types.ObjectId(examId),
      studentId: new mongoose.Types.ObjectId(studentId),
      status: 'enrolled',
    });

    if (!enrollment) {
      throw ApiError.forbidden('You are not enrolled in this exam');
    }

    // 2. Verify exam is live
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');
    if (exam.status !== 'live') {
      throw ApiError.badRequest(`Exam is not currently live (status: ${exam.status})`);
    }

    // 3. Upsert session (allow reconnects)
    const session = await ExamSession.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      {
        $setOnInsert: {
          enrollmentId: enrollment._id,
          trustScore: 100,
          trustZone: 'green',
          totalViolations: 0,
          freezeCount: 0,
        },
        $set: {
          status: SESSION_STATUS.WAITING,
          laptopConnected: true,
          laptopUserAgent: userAgent,
          startedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    // 4. Mark enrollment as started
    await Enrollment.findByIdAndUpdate(enrollment._id, {
      status: 'started',
      startedAt: new Date(),
    });

    logger.info({ examId, studentId, sessionId: session._id }, 'Exam session created in DB');
    return session;
  }

  /**
   * Update session when phone is paired.
   */
  async markPhonePaired(examId: string, studentId: string, phoneUserAgent: string = ''): Promise<void> {
    await ExamSession.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      {
        $set: {
          phoneConnected: true,
          phoneUserAgent,
          status: SESSION_STATUS.PAIRED,
          phonePairedAt: new Date(),
        },
      },
    );
  }

  /**
   * Persist a Sentinel violation flag to MongoDB (async, fire-and-forget).
   * We don't await this on the critical path to avoid slowing socket events.
   */
  persistViolation(data: {
    sessionId: string;    // MongoDB session _id
    studentId: string;
    examId: string;
    type: ViolationType;
    confidence: number;
    deduction: number;
    trustScoreAfter: number;
    streakCount: number;
    metadata?: Record<string, unknown>;
    timestamp: string;
  }): void {
    const severity = SEVERITY_MAP[data.type] || VIOLATION_SEVERITY.MEDIUM;

    // Fire-and-forget — don't block socket events
    Violation.create({
      sessionId: new mongoose.Types.ObjectId(data.sessionId),
      studentId: new mongoose.Types.ObjectId(data.studentId),
      examId: new mongoose.Types.ObjectId(data.examId),
      type: data.type,
      severity,
      confidence: data.confidence,
      deduction: data.deduction,
      trustScoreAfter: data.trustScoreAfter,
      streakCount: data.streakCount,
      metadata: data.metadata || {},
      timestamp: new Date(data.timestamp),
    }).catch((err) => {
      logger.error({ err, type: data.type }, 'Failed to persist violation');
    });

    // Also update session trust score in DB (async)
    ExamSession.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(data.examId),
        studentId: new mongoose.Types.ObjectId(data.studentId),
      },
      {
        $set: {
          trustScore: data.trustScoreAfter,
          trustZone: data.trustScoreAfter >= 80 ? 'green' : data.trustScoreAfter >= 50 ? 'yellow' : 'red',
        },
        $inc: { totalViolations: 1 },
      },
    ).catch((err) => {
      logger.error({ err }, 'Failed to update session trust score in DB');
    });
  }

  /**
   * Generate a cryptographic resume token (HMAC-SHA256).
   * Used when phone disconnects and student needs to re-pair.
   */
  async generateResumeToken(sessionId: string, studentId: string): Promise<string> {
    const payload = `${sessionId}:${studentId}:${Date.now()}`;
    const secret = process.env.JWT_ACCESS_SECRET || 'fallback-secret';
    const token = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await ExamSession.findByIdAndUpdate(sessionId, {
      $set: { resumeToken: token, resumeTokenExpiresAt: expiresAt },
    });

    return token;
  }

  /**
   * Validate and consume a resume token.
   */
  async validateResumeToken(sessionId: string, token: string): Promise<boolean> {
    const session = await ExamSession.findById(sessionId).select('+resumeToken +resumeTokenExpiresAt');
    if (!session || !session.resumeToken) return false;
    if (new Date() > (session.resumeTokenExpiresAt as Date)) return false;
    if (session.resumeToken !== token) return false;

    // Consume token
    await ExamSession.findByIdAndUpdate(sessionId, {
      $unset: { resumeToken: 1, resumeTokenExpiresAt: 1 },
    });

    return true;
  }

  /**
   * Freeze a session (phone disconnected).
   */
  async freezeSession(examId: string, studentId: string): Promise<void> {
    await ExamSession.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      {
        $set: {
          status: SESSION_STATUS.FROZEN,
          phoneConnected: false,
          lastFrozenAt: new Date(),
        },
        $inc: { freezeCount: 1 },
      },
    );
  }

  /**
   * Complete a session.
   */
  async completeSession(examId: string, studentId: string): Promise<void> {
    await ExamSession.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      {
        $set: {
          status: SESSION_STATUS.COMPLETED,
          completedAt: new Date(),
          laptopConnected: false,
          phoneConnected: false,
        },
      },
    );

    // Update enrollment status
    await Enrollment.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
  }

  /**
   * Terminate a session (proctor action).
   */
  async terminateSession(
    examId: string,
    studentId: string,
    terminatedById: string,
    reason: string,
  ): Promise<void> {
    await ExamSession.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      {
        $set: {
          status: SESSION_STATUS.TERMINATED,
          terminatedAt: new Date(),
          terminatedBy: new mongoose.Types.ObjectId(terminatedById),
          terminationReason: reason,
          laptopConnected: false,
          phoneConnected: false,
        },
      },
    );
  }

  /**
   * Get all sessions for an exam (for admin dashboard & leaderboard API).
   * Sorted by trust score ascending (Red Zone students first).
   */
  async getExamSessions(examId: string) {
    return ExamSession.find({
      examId: new mongoose.Types.ObjectId(examId),
    })
      .sort({ trustScore: 1 }) // Red Zone (lowest score) first
      .populate('studentId', 'firstName lastName email')
      .lean();
  }

  /**
   * Get violation timeline for a session (evidence log).
   */
  async getViolationTimeline(sessionId: string) {
    return Violation.find({ sessionId: new mongoose.Types.ObjectId(sessionId) })
      .sort({ timestamp: -1 })
      .lean();
  }

  /**
   * Trust score leaderboard for an exam.
   * Red Zone students appear first (lowest score).
   */
  async getTrustLeaderboard(examId: string) {
    return ExamSession.find({
      examId: new mongoose.Types.ObjectId(examId),
      status: { $in: ['paired', 'active', 'paused', 'frozen'] },
    })
      .sort({ trustScore: 1 })
      .populate('studentId', 'firstName lastName email')
      .select('studentId trustScore trustZone totalViolations status devices lastFrozenAt')
      .lean();
  }
}

export const sessionService = new SessionService();
