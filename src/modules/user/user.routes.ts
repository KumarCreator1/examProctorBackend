import { Router } from 'express';
import { userController } from './user.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { USER_ROLES } from '../../utils/constants';
import { updateProfileSchema } from '../auth/auth.validation';
import { updateRoleSchema, listUsersQuerySchema } from './user.validation';

const router = Router();

// All user routes require authentication
router.use(authenticate);

// ─── Self-service Routes ─────────────────────────────
router.patch(
  '/profile',
  validate(updateProfileSchema),
  asyncHandler(userController.updateProfile),
);

// ─── Admin Routes ────────────────────────────────────
router.get(
  '/',
  authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  validate(listUsersQuerySchema, 'query'),
  asyncHandler(userController.getUsers),
);

router.get(
  '/:id',
  authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  asyncHandler(userController.getUserById),
);

router.patch(
  '/:id/role',
  authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  validate(updateRoleSchema),
  asyncHandler(userController.updateRole),
);

router.patch(
  '/:id/deactivate',
  authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  asyncHandler(userController.deactivateUser),
);

router.patch(
  '/:id/reactivate',
  authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  asyncHandler(userController.reactivateUser),
);

// ─── Superadmin Only ─────────────────────────────────
router.delete(
  '/:id',
  authorize(USER_ROLES.SUPERADMIN),
  asyncHandler(userController.deleteUser),
);

export default router;
