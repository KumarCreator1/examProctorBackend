import { Router } from 'express';
import { questionController } from './question.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { USER_ROLES } from '../../utils/constants';
import { updateQuestionSchema } from '../exam/exam.validation';

const router = Router();

// All question routes require authentication
router.use(authenticate);

// Get question by ID (admin/proctor)
router.get(
  '/:id',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  asyncHandler(questionController.getQuestionById),
);

// Update question
router.patch(
  '/:id',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(updateQuestionSchema),
  asyncHandler(questionController.updateQuestion),
);

// Delete question
router.delete(
  '/:id',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  asyncHandler(questionController.deleteQuestion),
);

export default router;
