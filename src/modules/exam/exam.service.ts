import crypto from 'crypto';
import mongoose from 'mongoose';
import { Exam, IExam } from './exam.model';
import { Enrollment } from './enrollment.model';
import { Question } from '../question/question.model';
import { ApiError } from '../../utils/apiError';
import { logger } from '../../utils/logger';
import { EXAM_STATUS, ExamStatus, SOCKET_EVENTS } from '../../utils/constants';
import {
  CreateExamInput,
  UpdateExamInput,
  ListExamsQuery,
} from './exam.validation';

class ExamService {
  /**
   * Generate a unique 6-character access code.
   */
  private generateAccessCode(): string {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g., "A3F1B2"
  }

  /**
   * Create a new exam.
   * Only admin/proctor/superadmin can call this.
   */
  async createExam(creatorId: string, input: CreateExamInput): Promise<IExam> {
    // Validate date logic
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    if (end <= start) {
      throw ApiError.badRequest('Scheduled end must be after scheduled start');
    }
    if (input.duration > (end.getTime() - start.getTime()) / (1000 * 60)) {
      throw ApiError.badRequest('Exam duration cannot exceed the scheduled window');
    }

    const exam = await Exam.create({
      ...input,
      scheduledStart: start,
      scheduledEnd: end,
      createdBy: new mongoose.Types.ObjectId(creatorId),
      accessCode: this.generateAccessCode(),
    });

    logger.info({ examId: exam._id, creatorId }, 'Exam created');
    return exam;
  }

  /**
   * Get exams created by a user (admin/proctor).
   */
  async getMyExams(userId: string, query: ListExamsQuery) {
    const { page = 1, limit = 20, status, search } = query;
    const filter: Record<string, unknown> = { createdBy: new mongoose.Types.ObjectId(userId) };
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    const skip = (page - 1) * limit;
    const [exams, total] = await Promise.all([
      Exam.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Exam.countDocuments(filter),
    ]);

    return { exams, meta: { page, limit, total } };
  }

  /**
   * Get all exams (superadmin).
   */
  async getAllExams(query: ListExamsQuery) {
    const { page = 1, limit = 20, status, search } = query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    const skip = (page - 1) * limit;
    const [exams, total] = await Promise.all([
      Exam.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate('createdBy', 'firstName lastName email').lean(),
      Exam.countDocuments(filter),
    ]);

    return { exams, meta: { page, limit, total } };
  }

  /**
   * Get exams a student is enrolled in.
   */
  async getStudentExams(studentId: string) {
    const enrollments = await Enrollment.find({
      studentId: new mongoose.Types.ObjectId(studentId),
      status: { $ne: 'revoked' },
    }).populate({
      path: 'examId',
      select: 'title description scheduledStart scheduledEnd duration status institution proctoring.enabled proctoring.dualCamera',
    }).lean();

    return enrollments.map((e) => ({
      enrollment: {
        _id: e._id,
        status: e.status,
        enrolledAt: e.enrolledAt,
      },
      exam: e.examId,
    }));
  }

  /**
   * Get a single exam by ID.
   */
  async getExamById(examId: string, userId?: string, userRole?: string): Promise<IExam> {
    const exam = await Exam.findById(examId).populate('createdBy', 'firstName lastName email');
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    // Students can only see exams they're enrolled in
    if (userRole === 'student') {
      const enrollment = await Enrollment.findOne({
        examId: exam._id,
        studentId: new mongoose.Types.ObjectId(userId),
        status: { $ne: 'revoked' },
      });
      if (!enrollment) {
        throw ApiError.forbidden('You are not enrolled in this exam');
      }
    }

    return exam;
  }

  /**
   * Update exam (only if in draft or scheduled status).
   */
  async updateExam(examId: string, userId: string, updates: UpdateExamInput): Promise<IExam> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    // Only the creator can edit
    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only edit exams you created');
    }

    // Only draft/scheduled exams can be edited
    if (![EXAM_STATUS.DRAFT, EXAM_STATUS.SCHEDULED].includes(exam.status as typeof EXAM_STATUS.DRAFT)) {
      throw ApiError.badRequest(`Cannot edit an exam in "${exam.status}" status`);
    }

    // Validate dates if provided
    if (updates.scheduledStart || updates.scheduledEnd) {
      const start = new Date(updates.scheduledStart || exam.scheduledStart.toISOString());
      const end = new Date(updates.scheduledEnd || exam.scheduledEnd.toISOString());
      if (end <= start) {
        throw ApiError.badRequest('Scheduled end must be after scheduled start');
      }
    }

    const updated = await Exam.findByIdAndUpdate(
      examId,
      { $set: updates },
      { new: true, runValidators: true },
    );

    logger.info({ examId }, 'Exam updated');
    return updated!;
  }

  /**
   * Update exam status (lifecycle management).
   * Enforces: draft → scheduled → live → completed → archived
   */
  async updateExamStatus(examId: string, userId: string, newStatus: ExamStatus): Promise<IExam> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only manage exams you created');
    }

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      draft: ['scheduled'],
      scheduled: ['live', 'draft'],   // Can go back to draft
      live: ['paused', 'completed'],  // Can pause or complete
      paused: ['live', 'completed'],  // Can resume or complete from paused
      completed: ['archived'],
      archived: [],
    };

    const allowed = validTransitions[exam.status] || [];
    if (!allowed.includes(newStatus)) {
      throw ApiError.badRequest(
        `Cannot transition from "${exam.status}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // Additional checks before going live
    if (newStatus === EXAM_STATUS.LIVE) {
      const questionCount = await Question.countDocuments({ examId: exam._id });
      if (questionCount === 0) {
        throw ApiError.badRequest('Cannot go live with zero questions. Add questions first.');
      }
    }

    const previousStatus = exam.status;
    exam.status = newStatus;
    await exam.save();

    logger.info({ examId, from: previousStatus, to: newStatus }, 'Exam status updated');

    // Broadcast lifecycle event to all connected sockets
    this.broadcastLifecycleEvent(previousStatus, newStatus, exam, userId);

    return exam;
  }

  /**
   * Broadcast exam lifecycle events via Socket.io.
   * Called AFTER the DB write succeeds.
   */
  private broadcastLifecycleEvent(
    previousStatus: string,
    newStatus: string,
    exam: IExam,
    userId: string,
  ): void {
    try {
      // Lazy import to avoid circular dependency at module load
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { broadcastExamLifecycle } = require('../../socket');

      const examId = String(exam._id);

      if (newStatus === EXAM_STATUS.LIVE && previousStatus === 'scheduled') {
        broadcastExamLifecycle(SOCKET_EVENTS.EXAM_START, examId, {
          title: exam.title,
          duration: exam.duration,
          startsAt: new Date().toISOString(),
        });
      } else if (newStatus === EXAM_STATUS.LIVE && previousStatus === 'paused') {
        broadcastExamLifecycle(SOCKET_EVENTS.EXAM_RESUME_ALL, examId, {
          resumedBy: userId,
        });
      } else if (newStatus === EXAM_STATUS.PAUSED) {
        broadcastExamLifecycle(SOCKET_EVENTS.EXAM_PAUSE_ALL, examId, {
          reason: 'Exam paused by proctor',
          pausedBy: userId,
        });
      } else if (newStatus === EXAM_STATUS.COMPLETED) {
        broadcastExamLifecycle(SOCKET_EVENTS.EXAM_END, examId, {
          reason: 'proctor_ended',
          endedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      // Socket broadcast failure should NOT fail the REST request
      logger.warn({ err }, 'Failed to broadcast lifecycle event (socket may not be initialized)');
    }
  }

  /**
   * Delete exam (only draft exams).
   */
  async deleteExam(examId: string, userId: string): Promise<void> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only delete exams you created');
    }

    if (exam.status !== EXAM_STATUS.DRAFT) {
      throw ApiError.badRequest('Only draft exams can be deleted. Archive completed exams instead.');
    }

    // Delete all associated questions & enrollments
    await Promise.all([
      Question.deleteMany({ examId: exam._id }),
      Enrollment.deleteMany({ examId: exam._id }),
      exam.deleteOne(),
    ]);

    logger.info({ examId }, 'Exam and associated data deleted');
  }

  /**
   * Enroll students manually (admin/proctor).
   */
  async enrollStudents(examId: string, enrolledById: string, studentIds: string[]): Promise<number> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    const enrollments = studentIds.map((studentId) => ({
      examId: new mongoose.Types.ObjectId(examId),
      studentId: new mongoose.Types.ObjectId(studentId),
      enrolledBy: new mongoose.Types.ObjectId(enrolledById),
      enrollmentType: 'manual' as const,
      enrolledAt: new Date(),
    }));

    // Use ordered: false to skip duplicates gracefully
    try {
      const result = await Enrollment.insertMany(enrollments, { ordered: false });
      logger.info({ examId, count: result.length }, 'Students enrolled');
      return result.length;
    } catch (error: unknown) {
      // Handle duplicate key errors (already enrolled)
      if ((error as { code?: number }).code === 11000) {
        const insertedCount = ((error as { insertedDocs?: unknown[] }).insertedDocs || []).length;
        logger.info({ examId, count: insertedCount }, 'Students enrolled (some already existed)');
        return insertedCount;
      }
      throw error;
    }
  }

  /**
   * Self-enroll with access code (student).
   */
  async selfEnroll(examId: string, studentId: string, accessCode: string): Promise<void> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    if (!exam.isPublic) {
      throw ApiError.forbidden('This exam does not allow self-enrollment');
    }

    if (exam.accessCode !== accessCode.toUpperCase()) {
      throw ApiError.badRequest('Invalid access code');
    }

    if (![EXAM_STATUS.SCHEDULED, EXAM_STATUS.LIVE].includes(exam.status as typeof EXAM_STATUS.SCHEDULED)) {
      throw ApiError.badRequest('This exam is not currently accepting enrollments');
    }

    // Check if already enrolled
    const existing = await Enrollment.findOne({
      examId: exam._id,
      studentId: new mongoose.Types.ObjectId(studentId),
    });

    if (existing) {
      if (existing.status === 'revoked') {
        throw ApiError.forbidden('Your enrollment has been revoked. Contact the administrator.');
      }
      throw ApiError.conflict('You are already enrolled in this exam');
    }

    await Enrollment.create({
      examId: exam._id,
      studentId: new mongoose.Types.ObjectId(studentId),
      enrolledBy: new mongoose.Types.ObjectId(studentId),
      enrollmentType: 'access_code',
    });

    logger.info({ examId, studentId }, 'Student self-enrolled via access code');
  }

  /**
   * Get enrollments for an exam (admin view).
   */
  async getExamEnrollments(examId: string) {
    return Enrollment.find({ examId: new mongoose.Types.ObjectId(examId) })
      .populate('studentId', 'firstName lastName email role')
      .populate('enrolledBy', 'firstName lastName email')
      .sort({ enrolledAt: -1 })
      .lean();
  }

  /**
   * Revoke a student's enrollment.
   */
  async revokeEnrollment(examId: string, studentId: string): Promise<void> {
    const enrollment = await Enrollment.findOneAndUpdate(
      {
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(studentId),
      },
      { $set: { status: 'revoked' } },
      { new: true },
    );

    if (!enrollment) {
      throw ApiError.notFound('Enrollment not found');
    }

    logger.info({ examId, studentId }, 'Enrollment revoked');
  }
}

export const examService = new ExamService();
