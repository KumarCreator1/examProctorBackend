import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { Violation } from '../../modules/session/violation.model';
import { ExamSession } from '../../modules/session/examSession.model';

/**
 * Violation Aggregation Worker
 *
 * Called when an exam ends (on-demand job, not repeating).
 * Aggregates all violations for an exam into summary stats.
 */

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
};

export const violationAggWorker = new Worker(
  'violation-aggregation',
  async (job) => {
    const { examId } = job.data as { examId: string };
    const eid = new mongoose.Types.ObjectId(examId);

    logger.info({ examId }, 'Running violation aggregation for exam');

    // Aggregate violation stats per student
    const studentStats = await Violation.aggregate([
      { $match: { examId: eid } },
      {
        $group: {
          _id: '$studentId',
          totalViolations: { $sum: 1 },
          violationTypes: { $addToSet: '$type' },
          avgConfidence: { $avg: '$confidence' },
          totalDeduction: { $sum: '$deduction' },
          firstViolationAt: { $min: '$timestamp' },
          lastViolationAt: { $max: '$timestamp' },
        },
      },
    ]);

    // Update each session with aggregated stats
    for (const stat of studentStats) {
      await ExamSession.findOneAndUpdate(
        { examId: eid, studentId: stat._id },
        {
          $set: {
            totalViolations: stat.totalViolations,
          },
        },
      );
    }

    logger.info(
      { examId, studentCount: studentStats.length },
      'Violation aggregation complete',
    );

    return { studentStats: studentStats.length };
  },
  {
    connection,
    concurrency: 2,
  },
);

// ─── Error Handling ──────────────────────────────────
violationAggWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Violation aggregation job failed');
});
