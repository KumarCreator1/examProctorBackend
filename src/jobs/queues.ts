import { Queue, Worker, QueueEvents } from 'bullmq';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * BullMQ Queue Setup
 *
 * All background jobs run through Redis-backed BullMQ queues.
 * Each queue has its own Worker processor.
 *
 * Queues:
 *   1. trustDecay     — periodic trust score recovery for active sessions
 *   2. violationAgg   — aggregates violations for reporting
 *   3. reportGen      — generates post-exam PDF/JSON reports
 *   4. sessionCleanup — cleans up stale sessions and expired pairing codes
 */

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,   // Required by BullMQ
};

// ─── Queue Definitions ───────────────────────────────
export const trustDecayQueue = new Queue('trust-decay', { connection });
export const violationAggQueue = new Queue('violation-aggregation', { connection });
export const reportGenQueue = new Queue('report-generation', { connection });
export const sessionCleanupQueue = new Queue('session-cleanup', { connection });

/**
 * Initialize repeating jobs (cron-like).
 * Called once at server startup.
 */
export const initializeQueues = async (): Promise<void> => {
  try {
    // 1. Trust score decay recovery — runs every 60 seconds
    // Recovers +0.5 points for sessions with no recent violations
    await trustDecayQueue.upsertJobScheduler(
      'trust-decay-scheduler',
      { every: 60000 }, // every 60s
      {
        name: 'decay-tick',
        data: {},
        opts: {
          removeOnComplete: { count: 10 },
          removeOnFail: { count: 50 },
        },
      },
    );

    // 2. Session cleanup — runs every 5 minutes
    // Removes expired pairing codes and stale sessions
    await sessionCleanupQueue.upsertJobScheduler(
      'session-cleanup-scheduler',
      { every: 300000 }, // every 5 min
      {
        name: 'cleanup-tick',
        data: {},
        opts: {
          removeOnComplete: { count: 5 },
          removeOnFail: { count: 20 },
        },
      },
    );

    logger.info('✅ BullMQ queues initialized with repeating jobs');
  } catch (err) {
    logger.error({ err }, '❌ Failed to initialize BullMQ queues');
  }
};

/**
 * Gracefully close all queues and workers.
 * Called during server shutdown.
 */
export const closeQueues = async (): Promise<void> => {
  await Promise.all([
    trustDecayQueue.close(),
    violationAggQueue.close(),
    reportGenQueue.close(),
    sessionCleanupQueue.close(),
  ]);
  logger.info('BullMQ queues closed');
};
