import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sessionController } from './session.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';
import { asyncHandler } from '../../middleware/asyncHandler';
import { USER_ROLES } from '../../utils/constants';

const router = Router();

// ─── Multer Configuration ────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads', 'evidence');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `evidence-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, and WebP images are allowed'));
    }
  },
});

// All session routes require authentication
router.use(authenticate);

// ─── Student Routes ──────────────────────────────────

// Submit answers (guaranteed delivery via REST)
router.post(
  '/:id/submit',
  authorize(USER_ROLES.STUDENT),
  asyncHandler(sessionController.submitAnswers),
);

// Upload evidence snapshot
router.post(
  '/:id/evidence',
  authorize(USER_ROLES.STUDENT),
  upload.single('file'),
  asyncHandler(sessionController.uploadEvidence),
);

// ─── Proctor/Admin Routes ────────────────────────────

// List evidence for a session
router.get(
  '/:id/evidence',
  authorize(USER_ROLES.PROCTOR, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  asyncHandler(sessionController.listEvidence),
);

// Get specific evidence by requestId
router.get(
  '/:id/evidence/:requestId',
  authorize(USER_ROLES.PROCTOR, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN),
  asyncHandler(sessionController.getEvidence),
);

// Get answers for a session (student sees own, proctor sees any)
router.get(
  '/:id/answers',
  asyncHandler(sessionController.getAnswers),
);

export default router;
