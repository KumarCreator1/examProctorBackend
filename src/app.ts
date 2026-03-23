import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { globalRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import examRoutes from './modules/exam/exam.routes';
import questionRoutes from './modules/question/question.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import sessionRoutes from './modules/session/session.routes';

/**
 * Create and configure the Express application.
 * Separated from server.ts for testability.
 */
export const createApp = (): Application => {
  const app = express();

  // ─── Security Middleware ─────────────────────────────
  app.use(helmet()); // Security headers
  app.use(hpp());    // HTTP parameter pollution protection
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }),
  );

  // ─── Body & Cookie Parsing ───────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // ─── Rate Limiting ──────────────────────────────────
  app.use(globalRateLimiter);

  // ─── Request Logging ────────────────────────────────
  app.use((req, _res, next) => {
    logger.info({
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    }, `→ ${req.method} ${req.originalUrl}`);
    next();
  });

  // ─── Health Check ───────────────────────────────────
  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      success: true,
      message: 'Integrity Proctoring API is running',
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.env,
        version: '1.0.0',
      },
    });
  });

  // ─── API Routes ─────────────────────────────────────
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/exams', examRoutes);
  app.use('/api/v1/questions', questionRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/sessions', sessionRoutes);

  // ─── 404 & Error Handling (must be last) ────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
