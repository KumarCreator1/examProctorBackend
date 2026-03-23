import { Worker } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { sessionManager, SessionState } from '../../socket/sessionManager';
import { ExamSession } from '../../modules/session/examSession.model';

/**
 * Trust Score Decay Recovery Worker
 *
 * Runs every 60 seconds.
 *
 * Algorithm:
 *   - For every active session in memory, if there have been NO violations
 *     in the last 60 seconds, restore +0.5 trust points.
 *   - Capped at 95 after any violation has occurred (can never return to 100).
 *   - Only applies to sessions in 'active' or 'paired' status.
 *
 * This is what makes the system fair: a glance away costs 1pt, but
 * if you stay focused for 2 minutes, you recover that point.
 */

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
};

const DECAY_RECOVERY_AMOUNT = 0.5;
const MAX_RECOVERY_SCORE = 95;   // Can never fully recover to 100 after a violation
const NO_VIOLATION_WINDOW = 60000; // 60s — no violations in this window = recovery eligible

export const trustDecayWorker = new Worker(
  'trust-decay',
  async () => {
    const allSessions: SessionState[] = sessionManager.getAllSessions();
    let recoveredCount = 0;

    for (const session of allSessions) {
      // Only recover for active/paired sessions
      if (!['active', 'paired'].includes(session.status)) continue;

      // Only recover if there was at least one violation (otherwise score is 100)
      if (session.violations === 0) continue;

      // Only recover if no violation in the last 60 seconds
      if (session.lastViolationAt) {
        const timeSinceViolation = Date.now() - session.lastViolationAt.getTime();
        if (timeSinceViolation < NO_VIOLATION_WINDOW) continue;
      }

      // Cap recovery at 95 (can't fully recover after a violation)
      if (session.trustScore >= MAX_RECOVERY_SCORE) continue;

      // Apply recovery
      const newScore = Math.min(
        MAX_RECOVERY_SCORE,
        session.trustScore + DECAY_RECOVERY_AMOUNT,
      );

      sessionManager.updateSession(session.sessionId, {
        trustScore: newScore,
        trustZone: newScore >= 80 ? 'green' : newScore >= 50 ? 'yellow' : 'red',
      });

      recoveredCount++;

      // Also update MongoDB (async, non-blocking)
      ExamSession.findOneAndUpdate(
        { examId: session.examId, studentId: session.studentId },
        {
          $set: {
            trustScore: newScore,
            trustZone: newScore >= 80 ? 'green' : newScore >= 50 ? 'yellow' : 'red',
          },
        },
      ).catch((err: unknown) => {
        logger.error({ err }, 'Failed to persist trust decay recovery to DB');
      });
    }

    if (recoveredCount > 0) {
      logger.debug({ recoveredCount }, 'Trust decay recovery applied');
    }
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 30000 },
  },
);

// ─── Error Handling ──────────────────────────────────
trustDecayWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Trust decay job failed');
});

trustDecayWorker.on('error', (err: Error) => {
  logger.error({ err }, 'Trust decay worker error');
});
