import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { initializeSocket } from './socket';
import { initializeJobs, closeJobs } from './jobs';
import { logger } from './utils/logger';

/**
 * ─── Server Bootstrap ─────────────────────────────────
 * Initializes all services and starts the HTTP server.
 */
const startServer = async (): Promise<void> => {
  try {
    // 1. Connect to MongoDB
    await connectDatabase();

    // 2. Connect to Redis (graceful fallback if unavailable)
    try {
      await connectRedis();
    } catch {
      logger.warn('Starting without Redis — caching and job queues disabled');
    }

    // 3. Create Express app
    const app = createApp();

    // 4. Create HTTP server
    const server = http.createServer(app);

    // 5. Initialize Socket.io on /proctoring namespace
    initializeSocket(server);

    // 6. Initialize BullMQ job queues (only if Redis is available)
    await initializeJobs();

    // 6. Start listening
    server.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║   🛡️  Integrity Proctoring API Server            ║
║──────────────────────────────────────────────────║
║   Environment : ${config.env.padEnd(31)}║
║   Port        : ${String(config.port).padEnd(31)}║
║   Health      : http://localhost:${config.port}/api/v1/health  ║
╚══════════════════════════════════════════════════╝
      `);
    });

    // ─── Graceful Shutdown ──────────────────────────────
    const gracefulShutdown = async (signal: string) => {
      logger.info(`\n${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        await disconnectDatabase();
        await disconnectRedis();
        await closeJobs();

        logger.info('All connections closed. Exiting.');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // ─── Unhandled Error Catching ───────────────────────
    process.on('unhandledRejection', (reason: Error) => {
      logger.error({ err: reason }, 'Unhandled Promise Rejection');
      // Let the process manager restart us
      throw reason;
    });

    process.on('uncaughtException', (error: Error) => {
      logger.error({ err: error }, 'Uncaught Exception');
      process.exit(1);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();
