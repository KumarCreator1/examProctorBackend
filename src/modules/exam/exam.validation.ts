import { z } from 'zod';
import { EXAM_STATUS, QUESTION_TYPES } from '../../utils/constants';

// ─── Proctoring Settings ─────────────────────────────
const proctoringSettingsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  dualCamera: z.boolean().optional().default(true),
  objectDetection: z.boolean().optional().default(true),
  gazeTracking: z.boolean().optional().default(true),
  audioMonitoring: z.boolean().optional().default(true),
  livenessChecks: z.boolean().optional().default(true),
  antiVM: z.boolean().optional().default(true),
  screenRecording: z.boolean().optional().default(true),
  heartbeatInterval: z.number().min(1000).max(30000).optional().default(5000),
  heartbeatTimeout: z.number().min(5000).max(60000).optional().default(15000),
  honeypotWatermark: z.boolean().optional().default(true),
}).optional();

// ─── Create Exam ─────────────────────────────────────
export const createExamSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200).trim(),
  description: z.string().max(2000).trim().optional().default(''),
  instructions: z.string().max(5000).trim().optional().default(''),
  institution: z.string().max(100).trim().optional().default(''),
  scheduledStart: z.string().datetime({ message: 'Invalid start date. Use ISO 8601 format.' }),
  scheduledEnd: z.string().datetime({ message: 'Invalid end date. Use ISO 8601 format.' }),
  duration: z.number().int().min(1).max(480),
  timezone: z.string().optional().default('Asia/Kolkata'),
  settings: z.object({
    shuffleQuestions: z.boolean().optional().default(true),
    shuffleOptions: z.boolean().optional().default(true),
    showResults: z.boolean().optional().default(false),
    maxAttempts: z.number().int().min(1).max(5).optional().default(1),
    passingScore: z.number().min(0).max(100).optional().default(40),
    allowBackNavigation: z.boolean().optional().default(true),
    autoSubmit: z.boolean().optional().default(true),
  }).optional(),
  proctoring: proctoringSettingsSchema,
  isPublic: z.boolean().optional().default(false),
  tags: z.array(z.string().trim()).optional().default([]),
});

// ─── Update Exam ─────────────────────────────────────
export const updateExamSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(2000).trim().optional(),
  instructions: z.string().max(5000).trim().optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  duration: z.number().int().min(1).max(480).optional(),
  timezone: z.string().optional(),
  settings: z.object({
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    showResults: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    passingScore: z.number().min(0).max(100).optional(),
    allowBackNavigation: z.boolean().optional(),
    autoSubmit: z.boolean().optional(),
  }).optional(),
  proctoring: proctoringSettingsSchema,
  isPublic: z.boolean().optional(),
  tags: z.array(z.string().trim()).optional(),
});

// ─── Update Exam Status ──────────────────────────────
export const updateExamStatusSchema = z.object({
  status: z.enum([
    EXAM_STATUS.DRAFT,
    EXAM_STATUS.SCHEDULED,
    EXAM_STATUS.LIVE,
    EXAM_STATUS.PAUSED,
    EXAM_STATUS.COMPLETED,
    EXAM_STATUS.ARCHIVED,
  ]),
});

// ─── Enroll Students ─────────────────────────────────
export const enrollStudentsSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1, 'At least one student ID is required'),
});

// ─── Self-Enroll with Access Code ────────────────────
export const selfEnrollSchema = z.object({
  accessCode: z.string().min(1, 'Access code is required').toUpperCase().trim(),
});

// ─── Create Question ─────────────────────────────────
export const createQuestionSchema = z.object({
  type: z.enum([QUESTION_TYPES.MCQ, QUESTION_TYPES.SUBJECTIVE, QUESTION_TYPES.CODING]),
  text: z.string().min(1, 'Question text is required').max(5000).trim(),
  options: z.array(z.object({
    text: z.string().min(1).trim(),
    isCorrect: z.boolean(),
  })).optional().default([]),
  correctAnswer: z.string().trim().optional().default(''),
  explanation: z.string().max(2000).trim().optional().default(''),
  points: z.number().min(0).optional().default(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().default('medium'),
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string().trim()).optional().default([]),
});

// ─── Update Question ─────────────────────────────────
export const updateQuestionSchema = z.object({
  text: z.string().min(1).max(5000).trim().optional(),
  options: z.array(z.object({
    text: z.string().min(1).trim(),
    isCorrect: z.boolean(),
  })).optional(),
  correctAnswer: z.string().trim().optional(),
  explanation: z.string().max(2000).trim().optional(),
  points: z.number().min(0).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string().trim()).optional(),
});

// ─── Reorder Questions ───────────────────────────────
export const reorderQuestionsSchema = z.object({
  questionOrder: z.array(z.object({
    questionId: z.string().min(1),
    order: z.number().int().min(0),
  })).min(1),
});

// ─── List Exams Query ────────────────────────────────
export const listExamsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  status: z.enum([
    EXAM_STATUS.DRAFT,
    EXAM_STATUS.SCHEDULED,
    EXAM_STATUS.LIVE,
    EXAM_STATUS.PAUSED,
    EXAM_STATUS.COMPLETED,
    EXAM_STATUS.ARCHIVED,
  ]).optional(),
  search: z.string().optional(),
});

// ─── Type Exports ────────────────────────────────────
export type CreateExamInput = z.infer<typeof createExamSchema>;
export type UpdateExamInput = z.infer<typeof updateExamSchema>;
export type UpdateExamStatusInput = z.infer<typeof updateExamStatusSchema>;
export type EnrollStudentsInput = z.infer<typeof enrollStudentsSchema>;
export type SelfEnrollInput = z.infer<typeof selfEnrollSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;
export type ListExamsQuery = z.infer<typeof listExamsQuerySchema>;
