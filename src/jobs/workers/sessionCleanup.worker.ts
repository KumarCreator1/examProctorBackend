import { Worker } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { sessionManager } from '../../socket/sessionManager';
import { ExamSession } from '../../modules/session/examSession.model';

/**
 * Session Cleanup Worker
 *
 * Runs every 5 minutes.
 *
 * Tasks:
 *   1. Sync in-memory sessions to MongoDB (durability backup)
 *   2. Remove stale/orphaned sessions from memory
 *   3. Auto-terminate frozen sessions after 15 min
 *   4. Garbage-collect completed sessions from memory after 5 min
 */

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
};

const STALE_SESSION_TIMEOUT = 30 * 60 * 1000;  // 30 min
const FROZEN_TIMEOUT = 15 * 60 * 1000;         // 15 min

export const sessionCleanupWorker = new Worker(
  'session-cleanup',
  async () => {
    const allSessions = sessionManager.getAllSessions();
    const now = Date.now();
    let synced = 0;
    let removed = 0;
    let terminated = 0;

    for (const session of allSessions) {
      // 1. Sync active sessions to MongoDB
      if (['active', 'paired', 'paused'].includes(session.status)) {
        ExamSession.findOneAndUpdate(
          { examId: session.examId, studentId: session.studentId },
          {
            $set: {
              trustScore: session.trustScore,
              trustZone: session.trustZone,
              totalViolations: session.violations,
              laptopConnected: session.devices.laptop,
              phoneConnected: session.devices.phone,
              hardware: session.hardware,
            },
          },
        ).catch((err: unknown) => {
          logger.error({ err }, 'Failed to sync session to DB');
        });
        synced++;
      }

      // 2. Remove stale "waiting" sessions (never started within 30 min)
      if (session.status === 'waiting') {
        const age = now - session.connectedAt.getTime();
        if (age > STALE_SESSION_TIMEOUT) {
          sessionManager.removeSession(session.sessionId);
          removed++;
        }
      }

      // 3. Auto-terminate frozen sessions after 15 minutes
      if (session.status === 'frozen') {
        const frozenDuration = session.lastViolationAt
          ? now - session.lastViolationAt.getTime()
          : now - session.connectedAt.getTime();

        if (frozenDuration > FROZEN_TIMEOUT) {
          sessionManager.updateSession(session.sessionId, { status: 'terminated' });
          sessionManager.clearHeartbeatTimer(session.sessionId);

          ExamSession.findOneAndUpdate(
            { examId: session.examId, studentId: session.studentId },
            {
              $set: {
                status: 'terminated',
                terminatedAt: new Date(),
                terminationReason: 'Auto-terminated: frozen for over 15 minutes',
              },
            },
          ).catch((err: unknown) => {
            logger.error({ err }, 'Failed to persist auto-termination');
          });

          terminated++;
        }
      }

      // 4. Clean up completed/terminated sessions from memory after 5 min
      if (['completed', 'terminated'].includes(session.status)) {
        const completionAge = session.lastViolationAt
          ? now - session.lastViolationAt.getTime()
          : now - session.connectedAt.getTime();

        if (completionAge > 5 * 60 * 1000) {
          sessionManager.removeSession(session.sessionId);
          removed++;
        }
      }
    }

    if (synced > 0 || removed > 0 || terminated > 0) {
      logger.info({ synced, removed, terminated }, 'Session cleanup completed');
    }
  },
  {
    connection,
    concurrency: 1,
  },
);

// ─── Error Handling ──────────────────────────────────
sessionCleanupWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Session cleanup job failed');
});

sessionCleanupWorker.on('error', (err: Error) => {
  logger.error({ err }, 'Session cleanup worker error');
});
