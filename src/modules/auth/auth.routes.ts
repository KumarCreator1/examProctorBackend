import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authRateLimiter } from '../../middleware/rateLimiter';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from './auth.validation';

const router = Router();

// ─── Public Routes ───────────────────────────────────
router.post(
  '/register',
  authRateLimiter,
  validate(registerSchema),
  asyncHandler(authController.register),
);

router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  asyncHandler(authController.login),
);

router.post(
  '/refresh',
  asyncHandler(authController.refresh),
);

// ─── Protected Routes ────────────────────────────────
router.post(
  '/logout',
  authenticate,
  asyncHandler(authController.logout),
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(authController.logoutAll),
);

router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(authController.changePassword),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(authController.getMe),
);

export default router;
