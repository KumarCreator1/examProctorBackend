import { Response, NextFunction } from 'express';
import { authService } from '../modules/auth/auth.service';
import { ApiError } from '../utils/apiError';
import { AuthRequest } from '../types';

/**
 * JWT Authentication middleware.
 * Verifies the access token from the Authorization header
 * and attaches the decoded user to req.user.
 */
export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // 1. Try to get token from httpOnly cookie
    let token = req.cookies?.accessToken;

    // 2. Fallback to Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      throw ApiError.unauthorized('Access token is missing or expired');
    }

    // Verify token (also checks Redis blacklist)
    const decoded = await authService.verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role as AuthRequest['user'] extends undefined ? never : NonNullable<AuthRequest['user']>['role'],
    };

    next();
  } catch (error) {
    next(error);
  }
};
