import { Server as HttpServer } from 'http';
import { Server, Namespace } from 'socket.io';
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SOCKET_EVENTS } from '../utils/constants';
import { SocketAuthPayload } from '../types';
import { registerStudentHandlers } from './handlers/student.handler';
import { registerProctorHandlers } from './handlers/proctor.handler';
import { sessionManager } from './sessionManager';
import { sessionService } from '../modules/session/session.service';

let io: Server;

/**
 * Initialize Socket.io server with JWT auth from httpOnly cookies.
 *
 * Architecture:
 *   Namespace: /proctoring
 *   Room naming:
 *     exam:{examId}           → all participants (students + proctors)
 *     exam:{examId}:proctors  → only proctors (for admin-level events)
 *     student:{sessionId}     → individual student session (for device pairing)
 */
export const initializeSocket = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e6, // 1MB max payload
  });

  // ─── /proctoring Namespace ─────────────────────────
  const proctoring: Namespace = io.of('/proctoring');

  // ─── Auth Middleware: JWT from Cookie ───────────────
  proctoring.use((socket, next) => {
    try {
      // 1. Parse cookies from handshake headers
      const rawCookie = socket.handshake.headers.cookie;
      let token: string | undefined;

      if (rawCookie) {
        const cookies = cookie.parse(rawCookie);
        token = cookies.accessToken;
      }

      // 2. Fallback: check auth query or header
      if (!token) {
        token = socket.handshake.auth?.token as string | undefined;
      }

      if (!token) {
        return next(new Error('Authentication required. No access token found.'));
      }

      // 3. Verify JWT
      const decoded = jwt.verify(token, config.jwt.accessSecret) as {
        id: string;
        email: string;
        role: string;
      };

      // 4. Attach user data to socket
      const authPayload: SocketAuthPayload = {
        userId: decoded.id,
        role: decoded.role as SocketAuthPayload['role'],
        sessionId: socket.handshake.auth?.sessionId as string | undefined,
        examId: socket.handshake.auth?.examId as string | undefined,
      };
      socket.data.user = authPayload;

      logger.info(
        { userId: decoded.id, role: decoded.role },
        'Socket authenticated',
      );

      next();
    } catch (err) {
      logger.warn({ err }, 'Socket auth failed');
      next(new Error('Invalid or expired access token'));
    }
  });

  // ─── Connection Handler ────────────────────────────
  proctoring.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    const user = socket.data.user as SocketAuthPayload;
    logger.info(
      { socketId: socket.id, userId: user.userId, role: user.role },
      'Client connected to /proctoring',
    );

    // Route to role-specific handlers
    if (user.role === 'student') {
      registerStudentHandlers(proctoring, socket);
    } else if (['proctor', 'admin', 'superadmin'].includes(user.role)) {
      registerProctorHandlers(proctoring, socket);
    }

    // ─── Disconnect ──────────────────────────────────
    socket.on(SOCKET_EVENTS.DISCONNECT, (reason) => {
      logger.info(
        { socketId: socket.id, userId: user.userId, reason },
        'Client disconnected from /proctoring',
      );

      // If student laptop disconnects, issue a resume token and start grace period
      if (user.role === 'student' && user.sessionId) {
        handleStudentLaptopDisconnect(proctoring, user.sessionId, user.userId, user.examId);
      }
    });

    // ─── Error ───────────────────────────────────────
    socket.on(SOCKET_EVENTS.ERROR, (err) => {
      logger.error({ socketId: socket.id, err }, 'Socket error');
    });
  });

  logger.info('Socket.io server initialized on /proctoring namespace');
  return io;
};

/**
 * Handle student laptop disconnect.
 * Issues a server-signed resume token (HMAC-SHA256) stored in MongoDB
 * with a 10-minute TTL. The student can use this to reconnect.
 */
async function handleStudentLaptopDisconnect(
  ns: Namespace,
  sessionId: string,
  studentId: string,
  examId?: string,
): Promise<void> {
  const session = sessionManager.getSession(sessionId);
  if (!session) return;

  // Don't issue tokens for already-completed sessions
  if (session.status === 'completed' || session.status === 'terminated') return;

  try {
    // Generate server-signed resume token and store in MongoDB
    const resumeToken = await sessionService.generateResumeToken(sessionId, studentId);

    // Update in-memory session to mark laptop as disconnected
    sessionManager.updateSession(sessionId, {
      devices: { ...session.devices, laptop: false },
    });

    // Emit resume token to student's session room (phone may still be connected)
    ns.to(`student:${sessionId}`).emit(SOCKET_EVENTS.SESSION_RECONNECT_TOKEN, {
      sessionId,
      resumeToken,
      expiresIn: 600, // 10 minutes in seconds
      serverTime: new Date().toISOString(),
    });

    // Notify proctors about the disconnect
    const targetExamId = examId || session.examId;
    if (targetExamId) {
      ns.to(`exam:${targetExamId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
        type: 'student_disconnected',
        sessionId,
        studentId,
        reason: 'laptop_disconnected',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info({ sessionId, studentId }, 'Resume token issued for disconnected student');
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to issue resume token on disconnect');
    // Still handle disconnect even if token generation fails
    sessionManager.handleStudentDisconnect(sessionId, 'laptop');
  }
}

/**
 * Broadcast exam lifecycle event to all connected sockets in the exam room.
 * Called by REST controllers AFTER updating the DB.
 *
 * Usage in exam.controller.ts:
 *   broadcastExamLifecycle('exam:start', examId, { title, duration, ... });
 */
export const broadcastExamLifecycle = (
  event: string,
  examId: string,
  payload: Record<string, unknown>,
): void => {
  if (!io) {
    logger.warn('Cannot broadcast — Socket.io not initialized');
    return;
  }
  const ns = io.of('/proctoring');
  ns.to(`exam:${examId}`).emit(event, {
    ...payload,
    examId,
    serverTime: new Date().toISOString(),
  });

  logger.info({ event, examId }, 'Exam lifecycle event broadcast');
};

/**
 * Get the Socket.io server instance.
 */
export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initializeSocket first.');
  }
  return io;
};

/**
 * Get the /proctoring namespace.
 */
export const getProctoringNamespace = (): Namespace => {
  return getIO().of('/proctoring');
};
