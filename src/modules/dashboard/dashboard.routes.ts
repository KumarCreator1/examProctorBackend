import { Router } from 'express';
import { dashboardController } from './dashboard.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';
import { asyncHandler } from '../../middleware/asyncHandler';
import { USER_ROLES } from '../../utils/constants';

const router = Router();

// All dashboard routes require auth + proctor/admin/superadmin role
router.use(authenticate);
router.use(authorize(USER_ROLES.PROCTOR, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN));

// ─── Live Dashboard ──────────────────────────────────
// Main view: summary stats + student cards with trust scores
// Query: ?filter=clear|warning|flagged
router.get(
  '/:examId/live',
  asyncHandler(dashboardController.getLiveDashboard),
);

// ─── Summary Bar ─────────────────────────────────────
router.get(
  '/:examId/summary',
  asyncHandler(dashboardController.getExamSummary),
);

// ─── Trust Score Leaderboard ─────────────────────────
router.get(
  '/:examId/leaderboard',
  asyncHandler(dashboardController.getTrustLeaderboard),
);

// ─── Single Student Detail + Evidence Log ────────────
router.get(
  '/:examId/student/:sessionId',
  asyncHandler(dashboardController.getStudentDetail),
);

// ─── Violation Signal Feed (paginated) ───────────────
// Query: ?page=1&limit=50
router.get(
  '/:examId/violations',
  asyncHandler(dashboardController.getViolationFeed),
);

// ─── Hardware Registry ───────────────────────────────
router.get(
  '/:examId/hardware',
  asyncHandler(dashboardController.getHardwareRegistry),
);

// ─── Post-Exam Analytics ─────────────────────────────
// Leakage heatmap, trust distribution, violation distribution
router.get(
  '/:examId/analytics',
  asyncHandler(dashboardController.getPostExamAnalytics),
);

export default router;
