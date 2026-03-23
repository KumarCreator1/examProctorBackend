import mongoose from 'mongoose';
import { ExamSession } from '../session/examSession.model';
import { Violation } from '../session/violation.model';
import { Exam } from '../exam/exam.model';
import { Enrollment } from '../exam/enrollment.model';
import { ApiError } from '../../utils/apiError';
import { logger } from '../../utils/logger';
import { sessionManager } from '../../socket/sessionManager';

/**
 * Dashboard Service
 *
 * Serves all data for the Proctor Dashboard UI.
 * Combines real-time in-memory state (for live exams)
 * with MongoDB persistence (for historical/post-exam data).
 *
 * UI data points (from the dashboard mockup):
 *   ┌─────────────────────────────────────────────┐
 *   │  Summary:  Total | Clear | Warning | Flagged │
 *   │  Filter:   All   | Clear | Warning | Flagged │
 *   │  Per-student card:                           │
 *   │    - Name, Student ID, Status badge          │
 *   │    - Trust score (large number + color bar)   │
 *   │    - Latency, Gaze %, Camera status          │
 *   │    - Violation tags (GAZE_AWAY, PHONE_DET..) │
 *   └─────────────────────────────────────────────┘
 */

// Student status classification
type StudentStatus = 'clear' | 'warning' | 'flagged';

function classifyStatus(trustScore: number, trustZone: string): StudentStatus {
  if (trustZone === 'red' || trustScore < 50) return 'flagged';
  if (trustZone === 'yellow' || trustScore < 80) return 'warning';
  return 'clear';
}

/**
 * Resolve exam by either MongoDB _id or accessCode.
 * Returns { exam, examId } where examId is always the string _id.
 */
async function resolveExam(examIdOrCode: string, selectFields?: string) {
  const isObjectId = /^[a-f\d]{24}$/i.test(examIdOrCode);

  const query = isObjectId
    ? { _id: examIdOrCode }
    : { accessCode: examIdOrCode.toUpperCase() };

  const exam = await Exam.findOne(query).select(selectFields || '').lean();
  if (!exam) throw ApiError.notFound('Exam not found');

  return { exam, examId: String(exam._id) };
}

class DashboardService {
  /**
   * GET /api/v1/dashboard/:examId/live
   *
   * The main dashboard endpoint for a LIVE exam.
   * Returns summary stats + all student cards from in-memory state.
   */
  async getLiveDashboard(examIdOrCode: string, filter?: StudentStatus) {
    const { exam, examId } = await resolveExam(examIdOrCode, 'title status institution scheduledStart scheduledEnd duration');

    // Get real-time sessions from in-memory manager
    const sessions = sessionManager.getExamSessions(examId);

    // Build student cards
    const studentCards = sessions.map((s) => {
      const status = classifyStatus(s.trustScore, s.trustZone);
      return {
        sessionId: s.sessionId,
        studentId: s.studentId,
        status,
        trustScore: s.trustScore,
        trustZone: s.trustZone,
        // Live metrics (sent by Sentinel via socket, tracked in sessionManager)
        latencyMs: s.lastHeartbeatAt
          ? Date.now() - s.lastHeartbeatAt.getTime()
          : null,
        devices: s.devices,
        hardware: s.hardware,
        violations: s.violations,
        violationStreaks: s.violationStreaks,  // { gaze_away: 3, tab_switch: 1, ... }
        lastViolationAt: s.lastViolationAt,
        sessionStatus: s.status,
        connectedAt: s.connectedAt,
      };
    });

    // Apply filter
    const filtered = filter
      ? studentCards.filter((c) => c.status === filter)
      : studentCards;

    // Sort: flagged first, then warning, then clear (Red Zone at top)
    filtered.sort((a, b) => a.trustScore - b.trustScore);

    // Compute summary stats
    const summary = {
      total: studentCards.length,
      clear: studentCards.filter((c) => c.status === 'clear').length,
      warning: studentCards.filter((c) => c.status === 'warning').length,
      flagged: studentCards.filter((c) => c.status === 'flagged').length,
    };

    return {
      exam: {
        _id: exam._id,
        title: exam.title,
        status: exam.status,
        institution: exam.institution,
        scheduledStart: exam.scheduledStart,
        scheduledEnd: exam.scheduledEnd,
        duration: exam.duration,
      },
      summary,
      students: filtered,
    };
  }

  /**
   * GET /api/v1/dashboard/:examId/student/:sessionId
   *
   * Detailed view for a single student session.
   * Includes violation timeline / evidence log.
   */
  async getStudentDetail(examIdOrCode: string, sessionId: string) {
    const { examId } = await resolveExam(examIdOrCode);
    // Try in-memory first (for live sessions)
    const liveSession = sessionManager.getSession(sessionId);

    // Get persisted session
    const dbSession = await ExamSession.findOne({
      examId: new mongoose.Types.ObjectId(examId),
    }).or([
      { _id: sessionId },
    ]).populate('studentId', 'firstName lastName email institution').lean();

    // Get violation history (evidence log)
    const violations = await Violation.find({
      examId: new mongoose.Types.ObjectId(examId),
      ...(dbSession ? { sessionId: dbSession._id } : {}),
    })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    // Aggregate violation counts by type
    const violationSummary: Record<string, number> = {};
    violations.forEach((v) => {
      violationSummary[v.type] = (violationSummary[v.type] || 0) + 1;
    });

    return {
      session: {
        ...(dbSession || {}),
        // Overlay live data if available
        ...(liveSession ? {
          trustScore: liveSession.trustScore,
          trustZone: liveSession.trustZone,
          status: liveSession.status,
          devices: liveSession.devices,
          hardware: liveSession.hardware,
          violations: liveSession.violations,
          violationStreaks: liveSession.violationStreaks,
        } : {}),
      },
      violationTimeline: violations.map((v) => ({
        _id: v._id,
        type: v.type,
        severity: v.severity,
        confidence: v.confidence,
        deduction: v.deduction,
        trustScoreAfter: v.trustScoreAfter,
        streakCount: v.streakCount,
        timestamp: v.timestamp,
        metadata: v.metadata,
      })),
      violationSummary,
    };
  }

  /**
   * GET /api/v1/dashboard/:examId/leaderboard
   *
   * Trust score leaderboard — Red Zone students first.
   * Used by the main dashboard view.
   */
  async getTrustLeaderboard(examIdOrCode: string) {
    const { examId } = await resolveExam(examIdOrCode);
    // For live exams, use in-memory
    const liveSessions = sessionManager.getExamSessions(examId);

    if (liveSessions.length > 0) {
      return liveSessions
        .map((s) => ({
          sessionId: s.sessionId,
          studentId: s.studentId,
          trustScore: s.trustScore,
          trustZone: s.trustZone,
          status: classifyStatus(s.trustScore, s.trustZone),
          violations: s.violations,
          sessionStatus: s.status,
        }))
        .sort((a, b) => a.trustScore - b.trustScore);
    }

    // Fallback to MongoDB (post-exam)
    return ExamSession.find({
      examId: new mongoose.Types.ObjectId(examId),
    })
      .sort({ trustScore: 1 })
      .populate('studentId', 'firstName lastName email')
      .select('studentId trustScore trustZone totalViolations status')
      .lean();
  }

  /**
   * GET /api/v1/dashboard/:examId/violations
   *
   * Signal feed — real-time text-based violation log for the sidebar.
   * Returns latest violations across all students in an exam.
   */
  async getViolationFeed(examIdOrCode: string, page = 1, limit = 50) {
    const { examId } = await resolveExam(examIdOrCode);
    const skip = (page - 1) * limit;

    const eid = new mongoose.Types.ObjectId(examId);
    const [violations, total] = await Promise.all([
      Violation.find({ examId: eid })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('studentId', 'firstName lastName')
        .lean(),
      Violation.countDocuments({ examId: eid }),
    ]);

    return {
      violations: violations.map((v) => ({
        _id: v._id,
        studentId: v.studentId,
        type: v.type,
        severity: v.severity,
        confidence: v.confidence,
        deduction: v.deduction,
        trustScoreAfter: v.trustScoreAfter,
        timestamp: v.timestamp,
        metadata: v.metadata,
      })),
      meta: { page, limit, total },
    };
  }

  /**
   * GET /api/v1/dashboard/:examId/hardware
   *
   * Hardware registry — connected peripherals for every student.
   */
  async getHardwareRegistry(examIdOrCode: string) {
    const { examId } = await resolveExam(examIdOrCode);
    // Live sessions
    const liveSessions = sessionManager.getExamSessions(examId);
    if (liveSessions.length > 0) {
      return liveSessions.map((s) => ({
        sessionId: s.sessionId,
        studentId: s.studentId,
        hardware: s.hardware,
        devices: s.devices,
      }));
    }

    // Fallback to MongoDB
    return ExamSession.find({
      examId: new mongoose.Types.ObjectId(examId),
    })
      .populate('studentId', 'firstName lastName email')
      .select('studentId hardware laptopUserAgent phoneUserAgent')
      .lean();
  }

  /**
   * GET /api/v1/dashboard/:examId/analytics
   *
   * Post-exam analytics including:
   * - Question leakage heatmap (aggregate gaze/behavior by questionId)
   * - Trust score distribution
   * - Violation type distribution
   * - Session completion stats
   */
  async getPostExamAnalytics(examIdOrCode: string) {
    const { examId } = await resolveExam(examIdOrCode);
    const eid = new mongoose.Types.ObjectId(examId);

    // 1. Question leakage heatmap
    // Aggregate violations where metadata.questionId exists,
    // grouped by questionId — high counts mean possible leakage
    const leakageHeatmap = await Violation.aggregate([
      { $match: { examId: eid, 'metadata.questionId': { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: '$metadata.questionId',
          totalViolations: { $sum: 1 },
          gazeAwayCount: {
            $sum: { $cond: [{ $eq: ['$type', 'gaze_away'] }, 1, 0] },
          },
          tabSwitchCount: {
            $sum: { $cond: [{ $eq: ['$type', 'tab_switch'] }, 1, 0] },
          },
          avgConfidence: { $avg: '$confidence' },
          uniqueStudents: { $addToSet: '$studentId' },
        },
      },
      {
        $project: {
          questionId: '$_id',
          totalViolations: 1,
          gazeAwayCount: 1,
          tabSwitchCount: 1,
          avgConfidence: { $round: ['$avgConfidence', 2] },
          studentCount: { $size: '$uniqueStudents' },
          _id: 0,
        },
      },
      { $sort: { totalViolations: -1 } },
    ]);

    // 2. Trust score distribution
    const trustDistribution = await ExamSession.aggregate([
      { $match: { examId: eid } },
      {
        $bucket: {
          groupBy: '$trustScore',
          boundaries: [0, 20, 40, 60, 80, 101],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
    ]);

    // 3. Violation type distribution
    const violationDistribution = await Violation.aggregate([
      { $match: { examId: eid } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
        },
      },
      {
        $project: {
          type: '$_id',
          count: 1,
          avgConfidence: { $round: ['$avgConfidence', 2] },
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
    ]);

    // 4. Session completion stats
    const sessionStats = await ExamSession.aggregate([
      { $match: { examId: eid } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgTrustScore: { $avg: '$trustScore' },
        },
      },
      {
        $project: {
          status: '$_id',
          count: 1,
          avgTrustScore: { $round: ['$avgTrustScore', 1] },
          _id: 0,
        },
      },
    ]);

    // 5. Overall exam stats
    const [totalSessions, totalViolations, enrollmentCount] = await Promise.all([
      ExamSession.countDocuments({ examId: eid }),
      Violation.countDocuments({ examId: eid }),
      Enrollment.countDocuments({ examId: eid, status: { $ne: 'revoked' } }),
    ]);

    return {
      leakageHeatmap,
      trustDistribution,
      violationDistribution,
      sessionStats,
      overview: {
        totalEnrolled: enrollmentCount,
        totalSessions,
        totalViolations,
      },
    };
  }

  /**
   * GET /api/v1/dashboard/:examId/summary
   *
   * Quick summary for the top bar of the dashboard.
   */
  async getExamSummary(examIdOrCode: string) {
    const { exam, examId } = await resolveExam(examIdOrCode, 'title status institution scheduledStart scheduledEnd duration totalQuestions totalPoints');

    // Live sessions
    const liveSessions = sessionManager.getExamSessions(examId);

    const enrollmentCount = await Enrollment.countDocuments({
      examId: new mongoose.Types.ObjectId(examId),
      status: { $ne: 'revoked' },
    });

    const statusCounts = { clear: 0, warning: 0, flagged: 0 };
    liveSessions.forEach((s) => {
      const st = classifyStatus(s.trustScore, s.trustZone);
      statusCounts[st]++;
    });

    return {
      exam,
      live: {
        totalConnected: liveSessions.length,
        totalEnrolled: enrollmentCount,
        ...statusCounts,
      },
    };
  }
}

export const dashboardService = new DashboardService();
