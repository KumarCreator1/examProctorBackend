import { Request } from 'express';
import { UserRole } from '../utils/constants';

/**
 * Authenticated user payload attached to req.user by auth middleware.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  institution?: string;
}

/**
 * Extended Express Request with authenticated user.
 */
export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Pagination query params.
 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Device info for proctoring sessions.
 */
export interface DeviceInfo {
  type: 'laptop' | 'phone';
  userAgent: string;
  fingerprint: string;
  ip: string;
  connectedAt: Date;
}

/**
 * Socket auth payload.
 */
export interface SocketAuthPayload {
  userId: string;
  role: UserRole;
  sessionId?: string;
  examId?: string;
}
