/**
 * Job Workers Index
 *
 * Conditionally initializes BullMQ workers ONLY when Redis is available.
 * ALL imports are lazy (dynamic) to prevent BullMQ from connecting at module load.
 * Without Redis, the server runs perfectly — just without background job processing.
 */

import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

let workersInitialized = false;

/**
 * Initialize queues and workers.
 * Call this AFTER Redis connection attempt.
 */
export const initializeJobs = async (): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn('⚠️  Redis not available — BullMQ background jobs disabled');
    return;
  }

  try {
    // Dynamic imports: nothing loads until Redis is confirmed available
    const { initializeQueues } = await import('./queues');
    await initializeQueues();

    await import('./workers/trustDecay.worker');
    await import('./workers/violationAgg.worker');
    await import('./workers/reportGen.worker');
    await import('./workers/sessionCleanup.worker');

    workersInitialized = true;
    logger.info('✅ BullMQ workers initialized');
  } catch (err) {
    logger.warn({ err }, '⚠️  BullMQ worker initialization failed — background jobs disabled');
  }
};

/**
 * Gracefully close all queues.
 */
export const closeJobs = async (): Promise<void> => {
  if (!workersInitialized) return;

  try {
    const { closeQueues } = await import('./queues');
    await closeQueues();
  } catch (err) {
    logger.error({ err }, 'Error closing BullMQ queues');
  }
};

/**
 * Get queue references for on-demand job enqueuing.
 * Returns null if workers aren't initialized.
 */
export const getQueues = async () => {
  if (!workersInitialized) return null;
  const queues = await import('./queues');
  return {
    violationAggQueue: queues.violationAggQueue,
    reportGenQueue: queues.reportGenQueue,
  };
};
