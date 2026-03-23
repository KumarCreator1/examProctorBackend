import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { ExamSession, IExamSession } from '../../modules/session/examSession.model';
import { Violation, IViolation } from '../../modules/session/violation.model';
import { Exam } from '../../modules/exam/exam.model';
import { Enrollment } from '../../modules/exam/enrollment.model';

/**
 * Post-Exam Report Generation Worker
 *
 * Called when an exam is completed/archived (on-demand job).
 * Generates a structured JSON report.
 */

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
};

export const reportGenWorker = new Worker(
  'report-generation',
  async (job) => {
    const { examId } = job.data as { examId: string };
    const eid = new mongoose.Types.ObjectId(examId);

    logger.info({ examId }, 'Generating post-exam report');

    // 1. Exam metadata
    const exam = await Exam.findById(examId)
      .select('title description scheduledStart scheduledEnd duration totalQuestions totalPoints institution')
      .lean();

    if (!exam) throw new Error(`Exam ${examId} not found`);

    // 2. Enrollment and session stats
    const [enrollmentCount, sessions] = await Promise.all([
      Enrollment.countDocuments({ examId: eid, status: { $ne: 'revoked' } }),
      ExamSession.find({ examId: eid })
        .populate('studentId', 'firstName lastName email')
        .lean() as Promise<IExamSession[]>,
    ]);

    // 3. Per-student violation timeline
    const studentReports = await Promise.all(
      sessions.map(async (session: IExamSession) => {
        const violations = await Violation.find({ sessionId: session._id })
          .sort({ timestamp: 1 })
          .lean() as IViolation[];

        return {
          studentId: session.studentId,
          trustScore: session.trustScore,
          trustZone: session.trustZone,
          totalViolations: session.totalViolations,
          status: session.status,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          terminatedAt: session.terminatedAt,
          terminationReason: session.terminationReason,
          freezeCount: session.freezeCount,
          violationTimeline: violations.map((v: IViolation) => ({
            type: v.type,
            severity: v.severity,
            confidence: v.confidence,
            deduction: v.deduction,
            trustScoreAfter: v.trustScoreAfter,
            timestamp: v.timestamp,
          })),
        };
      }),
    );

    // 4. Question leakage heatmap
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
          uniqueStudents: { $addToSet: '$studentId' },
        },
      },
      {
        $project: {
          questionId: '$_id',
          totalViolations: 1,
          gazeAwayCount: 1,
          tabSwitchCount: 1,
          studentCount: { $size: '$uniqueStudents' },
          _id: 0,
        },
      },
      { $sort: { totalViolations: -1 } },
    ]);

    // 5. Overall trust score distribution
    const avgTrustScore = sessions.length > 0
      ? Math.round(sessions.reduce((sum: number, s: IExamSession) => sum + s.trustScore, 0) / sessions.length)
      : 100;

    const report = {
      generatedAt: new Date(),
      exam: {
        ...exam,
        totalEnrolled: enrollmentCount,
        totalParticipated: sessions.length,
      },
      summary: {
        avgTrustScore,
        totalSessions: sessions.length,
        completedSessions: sessions.filter((s: IExamSession) => s.status === 'completed').length,
        terminatedSessions: sessions.filter((s: IExamSession) => s.status === 'terminated').length,
        redZoneStudents: sessions.filter((s: IExamSession) => s.trustZone === 'red').length,
        yellowZoneStudents: sessions.filter((s: IExamSession) => s.trustZone === 'yellow').length,
        greenZoneStudents: sessions.filter((s: IExamSession) => s.trustZone === 'green').length,
      },
      leakageHeatmap,
      students: studentReports,
    };

    logger.info({ examId, students: sessions.length }, 'Post-exam report generated');
    return report;
  },
  {
    connection,
    concurrency: 1,
  },
);

// ─── Error Handling ──────────────────────────────────
reportGenWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Report generation job failed');
});
