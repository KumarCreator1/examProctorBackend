import { Router } from 'express';
import { examController } from './exam.controller';
import { questionController } from '../question/question.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { USER_ROLES } from '../../utils/constants';
import {
  createExamSchema,
  updateExamSchema,
  updateExamStatusSchema,
  enrollStudentsSchema,
  selfEnrollSchema,
  createQuestionSchema,
  reorderQuestionsSchema,
  listExamsQuerySchema,
} from './exam.validation';

const router = Router();

// All exam routes require authentication
router.use(authenticate);

// ─── Student Routes ──────────────────────────────────
// Students: see enrolled exams
router.get(
  '/my-exams',
  authorize(USER_ROLES.STUDENT),
  asyncHandler(examController.getStudentExams),
);

// Students: self-enroll with access code
router.post(
  '/:id/self-enroll',
  authorize(USER_ROLES.STUDENT),
  validate(selfEnrollSchema),
  asyncHandler(examController.selfEnroll),
);

// ─── Admin/Proctor Routes ────────────────────────────
// Create exam
router.post(
  '/',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(createExamSchema),
  asyncHandler(examController.createExam),
);

// List my exams (admin/proctor)
router.get(
  '/',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(listExamsQuerySchema, 'query'),
  asyncHandler(examController.getMyExams),
);

// List ALL exams (superadmin)
router.get(
  '/all',
  authorize(USER_ROLES.SUPERADMIN),
  validate(listExamsQuerySchema, 'query'),
  asyncHandler(examController.getAllExams),
);

// Get single exam (all roles — service handles access control)
router.get(
  '/:id',
  asyncHandler(examController.getExamById),
);

// Update exam
router.patch(
  '/:id',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(updateExamSchema),
  asyncHandler(examController.updateExam),
);

// Update exam status (lifecycle)
router.patch(
  '/:id/status',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(updateExamStatusSchema),
  asyncHandler(examController.updateExamStatus),
);

// Delete exam
router.delete(
  '/:id',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  asyncHandler(examController.deleteExam),
);

// ─── Enrollment Routes ───────────────────────────────
// Admin enrolls students
router.post(
  '/:id/enroll',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(enrollStudentsSchema),
  asyncHandler(examController.enrollStudents),
);

// Get enrollments for an exam
router.get(
  '/:id/enrollments',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  asyncHandler(examController.getEnrollments),
);

// Revoke enrollment
router.delete(
  '/:id/enrollments/:studentId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  asyncHandler(examController.revokeEnrollment),
);

// ─── Question Routes (nested under exam) ─────────────
// Add question to exam
router.post(
  '/:examId/questions',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(createQuestionSchema),
  asyncHandler(questionController.createQuestion),
);

// Bulk add questions
router.post(
  '/:examId/questions/bulk',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  asyncHandler(questionController.bulkCreateQuestions),
);

// Get all questions for an exam (answers hidden for students)
router.get(
  '/:examId/questions',
  asyncHandler(questionController.getExamQuestions),
);

// Reorder questions
router.patch(
  '/:examId/questions/reorder',
  authorize(USER_ROLES.ADMIN, USER_ROLES.PROCTOR, USER_ROLES.SUPERADMIN),
  validate(reorderQuestionsSchema),
  asyncHandler(questionController.reorderQuestions),
);

export default router;
