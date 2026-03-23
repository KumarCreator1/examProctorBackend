import { Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { AuthRequest } from '../../types';
import { ApiResponse } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';
import { ExamSession } from './examSession.model';
import { Answer } from './answer.model';
import { Evidence } from './evidence.model';
import { Question } from '../question/question.model';
import { logger } from '../../utils/logger';

class SessionController {
  /**
   * POST /api/v1/sessions/:id/submit
   *
   * Submit answers for an exam session. This is the guaranteed-delivery
   * endpoint for answer persistence. The client calls this BEFORE emitting
   * the student:complete socket event.
   *
   * Body: { answers: [{ questionId, answer, selectedOptions?, timeSpentMs }] }
   */
  async submitAnswers(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const sessionId = req.params.id as string;
    const studentId = req.user!.id;

    // Verify session exists and belongs to this student
    const session = await ExamSession.findOne({
      _id: sessionId,
      studentId: new mongoose.Types.ObjectId(studentId),
    });

    if (!session) {
      throw ApiError.notFound('Session not found or does not belong to you');
    }

    if (session.status === 'terminated') {
      throw ApiError.badRequest('Cannot submit answers for a terminated session');
    }

    const { answers } = req.body as {
      answers: Array<{
        questionId: string;
        answer: string;
        selectedOptions?: number[];
        timeSpentMs?: number;
      }>;
    };

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      throw ApiError.badRequest('At least one answer is required');
    }

    // Fetch all questions for this exam to auto-grade MCQs and get max scores
    const questions = await Question.find({ examId: session.examId }).lean();
    const questionMap = new Map(questions.map((q) => [String(q._id), q]));

    const now = new Date();
    const bulkOps = answers.map((a) => {
      const question = questionMap.get(a.questionId);
      if (!question) return null;

      // Auto-grade MCQ
      let isCorrect: boolean | undefined;
      let score: number | undefined;

      if (question.type === 'mcq' && a.selectedOptions && a.selectedOptions.length > 0) {
        const correctIndices = question.options
          .map((opt, idx) => (opt.isCorrect ? idx : -1))
          .filter((idx) => idx !== -1);

        isCorrect =
          a.selectedOptions.length === correctIndices.length &&
          a.selectedOptions.every((idx) => correctIndices.includes(idx));

        score = isCorrect ? question.points : 0;
      }

      return {
        updateOne: {
          filter: {
            sessionId: new mongoose.Types.ObjectId(sessionId),
            questionId: new mongoose.Types.ObjectId(a.questionId),
          },
          update: {
            $set: {
              examId: session.examId,
              studentId: new mongoose.Types.ObjectId(studentId),
              answer: a.answer || '',
              selectedOptions: a.selectedOptions || [],
              isCorrect,
              score,
              maxScore: question.points,
              timeSpentMs: a.timeSpentMs || 0,
              answeredAt: now,
              submittedAt: now,
            },
          },
          upsert: true,
        },
      };
    }).filter(Boolean);

    if (bulkOps.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Answer.bulkWrite(bulkOps as any[]);
    }

    // Mark session as completed
    await ExamSession.findByIdAndUpdate(sessionId, {
      $set: { status: 'completed', completedAt: now },
    });

    logger.info(
      { sessionId, studentId, answerCount: bulkOps.length },
      'Answers submitted and session completed',
    );

    ApiResponse.success(res, 'Answers submitted successfully', {
      submitted: bulkOps.length,
      total: answers.length,
    });
  }

  /**
   * POST /api/v1/sessions/:id/evidence
   *
   * Upload an evidence snapshot (camera/screen capture).
   * Uses multer for file handling. Max file size: 5MB.
   *
   * Body (multipart/form-data):
   *   - file: the image file
   *   - requestId: UUID4 linking to the proctor's evidence:request
   *   - type: 'camera_snapshot' | 'screen_snapshot'
   */
  async uploadEvidence(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const sessionId = req.params.id as string;
    const studentId = req.user!.id;

    const session = await ExamSession.findOne({
      _id: sessionId,
      studentId: new mongoose.Types.ObjectId(studentId),
    });

    if (!session) {
      throw ApiError.notFound('Session not found or does not belong to you');
    }

    if (!req.file) {
      throw ApiError.badRequest('No file uploaded');
    }

    const { requestId, type } = req.body as {
      requestId: string;
      type: 'camera_snapshot' | 'screen_snapshot';
    };

    if (!requestId) {
      throw ApiError.badRequest('requestId is required');
    }

    if (!type || !['camera_snapshot', 'screen_snapshot'].includes(type)) {
      throw ApiError.badRequest('type must be "camera_snapshot" or "screen_snapshot"');
    }

    // Check for duplicate requestId
    const existing = await Evidence.findOne({ requestId });
    if (existing) {
      throw ApiError.conflict('Evidence for this requestId already exists');
    }

    const evidence = await Evidence.create({
      sessionId: new mongoose.Types.ObjectId(sessionId),
      examId: session.examId,
      studentId: new mongoose.Types.ObjectId(studentId),
      requestId,
      type,
      reason: req.body.reason || '',
      requestedBy: req.body.requestedBy
        ? new mongoose.Types.ObjectId(req.body.requestedBy)
        : undefined,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date(),
    });

    logger.info(
      { sessionId, requestId, type, fileSize: req.file.size },
      'Evidence snapshot uploaded',
    );

    ApiResponse.created(res, 'Evidence uploaded successfully', {
      evidenceId: evidence._id,
      requestId,
      type,
    });
  }

  /**
   * GET /api/v1/sessions/:id/evidence/:requestId
   *
   * Retrieve evidence metadata and serve the file.
   * Accessible by proctors/admins/superadmins only.
   */
  async getEvidence(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const sessionId = req.params.id as string;
    const requestId = req.params.requestId as string;

    const evidence = await Evidence.findOne({
      sessionId: new mongoose.Types.ObjectId(sessionId),
      requestId,
    });

    if (!evidence) {
      throw ApiError.notFound('Evidence not found');
    }

    // Check if file exists
    const absolutePath = path.resolve(evidence.filePath);
    if (!fs.existsSync(absolutePath)) {
      throw ApiError.notFound('Evidence file not found on disk');
    }

    // Serve the file
    res.setHeader('Content-Type', evidence.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${requestId}.${evidence.mimeType.split('/')[1]}"`);
    res.sendFile(absolutePath);
  }

  /**
   * GET /api/v1/sessions/:id/evidence
   *
   * List all evidence snapshots for a session.
   * Accessible by proctors/admins/superadmins only.
   */
  async listEvidence(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const sessionId = req.params.id as string;

    const evidence = await Evidence.find({
      sessionId: new mongoose.Types.ObjectId(sessionId),
    })
      .sort({ uploadedAt: -1 })
      .lean();

    ApiResponse.success(res, 'Evidence retrieved', { evidence });
  }

  /**
   * GET /api/v1/sessions/:id/answers
   *
   * Get all submitted answers for a session.
   * Accessible by the student (own session) or proctors/admins.
   */
  async getAnswers(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const sessionId = req.params.id as string;

    const session = await ExamSession.findById(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found');
    }

    // Students can only see their own answers
    if (req.user!.role === 'student' && String(session.studentId) !== req.user!.id) {
      throw ApiError.forbidden('You can only view your own answers');
    }

    const answers = await Answer.find({
      sessionId: new mongoose.Types.ObjectId(sessionId),
    })
      .populate('questionId', 'text type options points difficulty')
      .sort({ 'questionId.order': 1 })
      .lean();

    const totalScore = answers.reduce((sum, a) => sum + (a.score || 0), 0);
    const maxPossible = answers.reduce((sum, a) => sum + (a.maxScore || 0), 0);

    ApiResponse.success(res, 'Answers retrieved', {
      answers,
      summary: {
        total: answers.length,
        answered: answers.filter((a) => a.answer || (a.selectedOptions && a.selectedOptions.length > 0)).length,
        score: totalScore,
        maxPossible,
        percentage: maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0,
      },
    });
  }
}

export const sessionController = new SessionController();
