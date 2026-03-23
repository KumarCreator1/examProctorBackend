import { Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import { AuthRequest } from '../types';
import { UserRole } from '../utils/constants';

/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Must be used AFTER the authenticate middleware.
 *
 * Usage:
 *   router.get('/admin-only', authenticate, authorize('admin', 'superadmin'), handler);
 */
export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${req.user.role}`,
        ),
      );
    }

    next();
  };
};
