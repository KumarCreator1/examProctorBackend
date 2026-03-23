import { Namespace, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../../utils/constants';
import { SocketAuthPayload } from '../../types';
import { sessionManager } from '../sessionManager';
import { logger } from '../../utils/logger';

/**
 * Proctor Socket Handlers
 *
 * Handles:
 * 1. Join exam monitoring room (receives all student events)
 * 2. Warn a specific student (popup warning)
 * 3. Global broadcast to all students in an exam
 * 4. Pause/Resume/Terminate individual sessions ("Sudo" controls)
 * 5. Request current exam dashboard state (all sessions)
 * 6. Request liveness check from a student
 * 7. Request hardware snapshot from a student
 * 8. Request evidence snapshot from a student
 *
 * NOTE: Exam lifecycle events (start/end/pause_all/resume_all) are
 * NOT handled here. They are broadcast by the REST controller after
 * PATCH /exams/:id/status updates the DB. See exam.controller.ts.
 */
export const registerProctorHandlers = (
  ns: Namespace,
  socket: Socket,
): void => {
  const user = socket.data.user as SocketAuthPayload;

  // ─── 1. Join Exam Monitoring Room ──────────────────
  socket.on('proctor:join_exam', (data: { examId: string }) => {
    const { examId } = data;

    // Join both the general exam room and the proctors-only room
    socket.join(`exam:${examId}`);
    socket.join(`exam:${examId}:proctors`);
    socket.data.user = { ...user, examId };

    // Send current state of all sessions in this exam
    const sessions = sessionManager.getExamSessions(examId);
    socket.emit('proctor:exam_state', {
      examId,
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        studentId: s.studentId,
        status: s.status,
        trustScore: s.trustScore,
        trustZone: s.trustZone,
        violations: s.violations,
        lastViolationAt: s.lastViolationAt?.toISOString() || null,
        devices: s.devices,
        hardware: s.hardware,
        connectedAt: s.connectedAt.toISOString(),
      })),
    });

    logger.info({ examId, proctorId: user.userId }, 'Proctor joined exam monitoring room');
  });

  // ─── 2. Warn Student (Personal Popup) ──────────────
  socket.on(SOCKET_EVENTS.PROCTOR_WARN, (data: {
    sessionId: string;
    message: string;
    severity?: 'info' | 'warning' | 'critical';
  }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    // Send warning popup to the specific student
    ns.to(`student:${data.sessionId}`).emit(SOCKET_EVENTS.PROCTOR_WARN, {
      message: data.message,
      severity: data.severity || 'warning',
      from: 'Proctor',
      timestamp: new Date().toISOString(),
    });

    logger.info(
      { sessionId: data.sessionId, message: data.message },
      'Proctor sent warning to student',
    );
  });

  // ─── 3. Global Broadcast (All Students in Exam) ────
  socket.on(SOCKET_EVENTS.PROCTOR_BROADCAST, (data: {
    examId: string;
    message: string;
    severity?: 'info' | 'warning' | 'critical';
  }) => {
    const examId = data.examId || socket.data.user?.examId;
    if (!examId) return;

    // Broadcast to ALL sockets in the exam room (students + proctors)
    ns.to(`exam:${examId}`).emit(SOCKET_EVENTS.PROCTOR_BROADCAST, {
      message: data.message,
      severity: data.severity || 'info',
      from: 'Proctor',
      timestamp: new Date().toISOString(),
    });

    logger.info(
      { examId, message: data.message },
      'Proctor sent global broadcast',
    );
  });

  // ─── 4. Pause Student Session ──────────────────────
  socket.on(SOCKET_EVENTS.PROCTOR_PAUSE, (data: { sessionId: string; reason?: string }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    if (session.status !== 'active' && session.status !== 'paired') {
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: `Cannot pause session in "${session.status}" status`,
      });
      return;
    }

    sessionManager.updateSession(data.sessionId, { status: 'paused' });

    const serverTime = new Date().toISOString();

    // Notify the student
    ns.to(`student:${data.sessionId}`).emit(SOCKET_EVENTS.SESSION_FREEZE, {
      sessionId: data.sessionId,
      reason: data.reason || 'Your exam has been paused by the proctor.',
      pausedBy: 'proctor',
      timestamp: serverTime,
    });

    // Notify all proctors
    ns.to(`exam:${session.examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'session_paused',
      sessionId: data.sessionId,
      studentId: session.studentId,
      reason: data.reason || 'Paused by proctor',
      pausedBy: user.userId,
      timestamp: serverTime,
    });

    logger.info({ sessionId: data.sessionId, proctorId: user.userId }, 'Proctor paused session');
  });

  // ─── 5. Resume Student Session ─────────────────────
  socket.on(SOCKET_EVENTS.PROCTOR_RESUME, (data: { sessionId: string }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    if (session.status !== 'paused' && session.status !== 'frozen') {
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: `Cannot resume session in "${session.status}" status`,
      });
      return;
    }

    sessionManager.updateSession(data.sessionId, { status: 'active' });

    // If phone is reconnected, restart heartbeat
    if (session.devices.phone) {
      sessionManager.recordHeartbeat(data.sessionId, (sid) => {
        const s = sessionManager.getSession(sid);
        if (s) {
          sessionManager.updateSession(sid, { status: 'frozen' });
          ns.to(`student:${sid}`).emit(SOCKET_EVENTS.SESSION_FREEZE, {
            sessionId: sid,
            reason: 'Phone disconnected — reconnect to resume.',
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    const serverTime = new Date().toISOString();

    // Notify the student
    ns.to(`student:${data.sessionId}`).emit(SOCKET_EVENTS.SESSION_RESUME, {
      sessionId: data.sessionId,
      resumedBy: 'proctor',
      timestamp: serverTime,
    });

    // Notify all proctors
    ns.to(`exam:${session.examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'session_resumed',
      sessionId: data.sessionId,
      studentId: session.studentId,
      resumedBy: user.userId,
      timestamp: serverTime,
    });

    logger.info({ sessionId: data.sessionId, proctorId: user.userId }, 'Proctor resumed session');
  });

  // ─── 6. Terminate Student Session ──────────────────
  socket.on(SOCKET_EVENTS.PROCTOR_TERMINATE, (data: {
    sessionId: string;
    reason: string;
  }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    if (session.status === 'completed' || session.status === 'terminated') {
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: `Session is already "${session.status}"`,
      });
      return;
    }

    sessionManager.updateSession(data.sessionId, { status: 'terminated' });
    sessionManager.clearHeartbeatTimer(data.sessionId);

    const serverTime = new Date().toISOString();

    // Force-disconnect all student devices from this session
    ns.to(`student:${data.sessionId}`).emit(SOCKET_EVENTS.SESSION_TERMINATE, {
      sessionId: data.sessionId,
      reason: data.reason || 'Your exam has been terminated by the proctor.',
      terminatedBy: 'proctor',
      timestamp: serverTime,
    });

    // Notify all proctors
    ns.to(`exam:${session.examId}:proctors`).emit(SOCKET_EVENTS.SESSION_UPDATE, {
      type: 'session_terminated',
      sessionId: data.sessionId,
      studentId: session.studentId,
      reason: data.reason,
      terminatedBy: user.userId,
      timestamp: serverTime,
    });

    logger.info(
      { sessionId: data.sessionId, reason: data.reason, proctorId: user.userId },
      'Proctor terminated session',
    );
  });

  // ─── 7. Request Dashboard State Refresh ────────────
  socket.on('proctor:refresh_state', () => {
    const examId = socket.data.user?.examId;
    if (!examId) return;

    const sessions = sessionManager.getExamSessions(examId);
    socket.emit('proctor:exam_state', {
      examId,
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        studentId: s.studentId,
        status: s.status,
        trustScore: s.trustScore,
        trustZone: s.trustZone,
        violations: s.violations,
        lastViolationAt: s.lastViolationAt?.toISOString() || null,
        devices: s.devices,
        hardware: s.hardware,
        connectedAt: s.connectedAt.toISOString(),
      })),
    });
  });

  // ─── 8. Request Liveness Check ─────────────────────
  // Proctor requests a specific student to perform a liveness challenge.
  // Server forwards the challenge; student responds via liveness:response.
  socket.on(SOCKET_EVENTS.PROCTOR_REQUEST_LIVENESS, (data: {
    sessionId: string;
    challenge: 'blink' | 'look_left' | 'look_right' | 'nod';
  }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    if (session.status !== 'active' && session.status !== 'paired') {
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: `Cannot request liveness for "${session.status}" session`,
      });
      return;
    }

    // Forward liveness challenge to the student
    ns.to(`student:${data.sessionId}`).emit(SOCKET_EVENTS.LIVENESS_CHALLENGE, {
      challenge: data.challenge,
      timeoutSeconds: 15,
      requestedBy: 'proctor',
      serverTime: new Date().toISOString(),
    });

    logger.info(
      { sessionId: data.sessionId, challenge: data.challenge, proctorId: user.userId },
      'Proctor requested liveness check',
    );
  });

  // ─── 9. Request Hardware Snapshot ───────────────────
  // Proctor requests a fresh hardware registry from a specific student.
  // Student responds via the existing hardware:update event.
  socket.on(SOCKET_EVENTS.PROCTOR_REQUEST_HARDWARE, (data: {
    sessionId: string;
  }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    // Forward hardware request to the student
    ns.to(`student:${data.sessionId}`).emit('hardware:request', {
      requestedBy: 'proctor',
      serverTime: new Date().toISOString(),
    });

    logger.info(
      { sessionId: data.sessionId, proctorId: user.userId },
      'Proctor requested hardware snapshot',
    );
  });

  // ─── 10. Request Evidence Snapshot ──────────────────
  // Proctor requests a camera/screen snapshot from a student.
  // Student captures and uploads via REST (POST /sessions/:id/evidence),
  // then notifies via evidence:upload socket event.
  socket.on(SOCKET_EVENTS.EVIDENCE_REQUEST, (data: {
    sessionId: string;
    type: 'camera_snapshot' | 'screen_snapshot' | 'both';
    reason: string;
    requestId: string;        // UUID4 from proctor frontend
  }) => {
    const session = sessionManager.getSession(data.sessionId);
    if (!session) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Session not found' });
      return;
    }

    // Forward evidence request to the student
    ns.to(`student:${data.sessionId}`).emit(SOCKET_EVENTS.EVIDENCE_REQUEST, {
      requestId: data.requestId,
      type: data.type,
      reason: data.reason,
      requestedBy: 'proctor',
      serverTime: new Date().toISOString(),
    });

    logger.info(
      { sessionId: data.sessionId, type: data.type, requestId: data.requestId },
      'Proctor requested evidence snapshot',
    );
  });
};
