import crypto from 'crypto';
import mongoose from 'mongoose';
import { Question, IQuestion } from './question.model';
import { Exam } from '../exam/exam.model';
import { ApiError } from '../../utils/apiError';
import { logger } from '../../utils/logger';
import { EXAM_STATUS } from '../../utils/constants';
import { CreateQuestionInput, UpdateQuestionInput, ReorderQuestionsInput } from '../exam/exam.validation';

class QuestionService {
  /**
   * Generate a honeypot watermark ID.
   * This is used to embed invisible zero-width characters in question text
   * to trace leaked questions back to a specific student session.
   */
  private generateWatermarkId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Add a question to an exam.
   */
  async createQuestion(examId: string, userId: string, input: CreateQuestionInput): Promise<IQuestion> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    // Only the exam creator can add questions
    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only add questions to exams you created');
    }

    // Only draft/scheduled exams can have questions added
    if (![EXAM_STATUS.DRAFT, EXAM_STATUS.SCHEDULED].includes(exam.status as typeof EXAM_STATUS.DRAFT)) {
      throw ApiError.badRequest(`Cannot add questions to an exam in "${exam.status}" status`);
    }

    // Get next order number
    const lastQuestion = await Question.findOne({ examId: exam._id }).sort({ order: -1 });
    const nextOrder = lastQuestion ? lastQuestion.order + 1 : 0;

    const question = await Question.create({
      ...input,
      examId: exam._id,
      order: nextOrder,
      watermarkId: exam.proctoring.honeypotWatermark ? this.generateWatermarkId() : '',
      watermarkEnabled: exam.proctoring.honeypotWatermark,
    });

    // Update exam totals
    await Exam.findByIdAndUpdate(examId, {
      $inc: { totalQuestions: 1, totalPoints: input.points || 1 },
    });

    logger.info({ examId, questionId: question._id }, 'Question added');
    return question;
  }

  /**
   * Bulk add questions to an exam.
   */
  async bulkCreateQuestions(
    examId: string,
    userId: string,
    questions: CreateQuestionInput[],
  ): Promise<IQuestion[]> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only add questions to exams you created');
    }

    if (![EXAM_STATUS.DRAFT, EXAM_STATUS.SCHEDULED].includes(exam.status as typeof EXAM_STATUS.DRAFT)) {
      throw ApiError.badRequest(`Cannot add questions to an exam in "${exam.status}" status`);
    }

    const lastQuestion = await Question.findOne({ examId: exam._id }).sort({ order: -1 });
    let nextOrder = lastQuestion ? lastQuestion.order + 1 : 0;

    const questionDocs = questions.map((q) => ({
      ...q,
      examId: exam._id,
      order: nextOrder++,
      watermarkId: exam.proctoring.honeypotWatermark ? this.generateWatermarkId() : '',
      watermarkEnabled: exam.proctoring.honeypotWatermark,
    }));

    const created = await Question.insertMany(questionDocs);

    // Update exam totals
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    await Exam.findByIdAndUpdate(examId, {
      $inc: { totalQuestions: created.length, totalPoints },
    });

    logger.info({ examId, count: created.length }, 'Questions bulk added');
    return created as IQuestion[];
  }

  /**
   * Get all questions for an exam.
   */
  async getExamQuestions(examId: string, includeAnswers: boolean = false) {
    const query = Question.find({ examId: new mongoose.Types.ObjectId(examId) })
      .sort({ order: 1 });

    if (!includeAnswers) {
      query.select('-correctAnswer -explanation');
    }

    return query.lean();
  }

  /**
   * Get a single question.
   */
  async getQuestionById(questionId: string): Promise<IQuestion> {
    const question = await Question.findById(questionId);
    if (!question) throw ApiError.notFound('Question not found');
    return question;
  }

  /**
   * Update a question.
   */
  async updateQuestion(questionId: string, userId: string, updates: UpdateQuestionInput): Promise<IQuestion> {
    const question = await Question.findById(questionId);
    if (!question) throw ApiError.notFound('Question not found');

    const exam = await Exam.findById(question.examId);
    if (!exam) throw ApiError.notFound('Associated exam not found');

    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only edit questions on exams you created');
    }

    if (![EXAM_STATUS.DRAFT, EXAM_STATUS.SCHEDULED].includes(exam.status as typeof EXAM_STATUS.DRAFT)) {
      throw ApiError.badRequest(`Cannot edit questions on an exam in "${exam.status}" status`);
    }

    // If points changed, update exam total
    if (updates.points !== undefined && updates.points !== question.points) {
      const diff = updates.points - question.points;
      await Exam.findByIdAndUpdate(exam._id, { $inc: { totalPoints: diff } });
    }

    const updated = await Question.findByIdAndUpdate(
      questionId,
      { $set: updates },
      { new: true, runValidators: true },
    );

    logger.info({ questionId }, 'Question updated');
    return updated!;
  }

  /**
   * Delete a question.
   */
  async deleteQuestion(questionId: string, userId: string): Promise<void> {
    const question = await Question.findById(questionId);
    if (!question) throw ApiError.notFound('Question not found');

    const exam = await Exam.findById(question.examId);
    if (!exam) throw ApiError.notFound('Associated exam not found');

    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only delete questions on exams you created');
    }

    if (![EXAM_STATUS.DRAFT, EXAM_STATUS.SCHEDULED].includes(exam.status as typeof EXAM_STATUS.DRAFT)) {
      throw ApiError.badRequest(`Cannot delete questions on an exam in "${exam.status}" status`);
    }

    await Exam.findByIdAndUpdate(exam._id, {
      $inc: { totalQuestions: -1, totalPoints: -question.points },
    });

    await question.deleteOne();

    logger.info({ questionId, examId: exam._id }, 'Question deleted');
  }

  /**
   * Reorder questions.
   */
  async reorderQuestions(examId: string, userId: string, input: ReorderQuestionsInput): Promise<void> {
    const exam = await Exam.findById(examId);
    if (!exam) throw ApiError.notFound('Exam not found');

    if (String(exam.createdBy) !== userId) {
      throw ApiError.forbidden('You can only reorder questions on exams you created');
    }

    const bulkOps = input.questionOrder.map(({ questionId, order }) => ({
      updateOne: {
        filter: {
          _id: new mongoose.Types.ObjectId(questionId),
          examId: new mongoose.Types.ObjectId(examId),
        },
        update: { $set: { order } },
      },
    }));

    await Question.bulkWrite(bulkOps);
    logger.info({ examId, count: input.questionOrder.length }, 'Questions reordered');
  }
}

export const questionService = new QuestionService();
