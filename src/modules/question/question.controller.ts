import { Response, NextFunction } from 'express';
import { questionService } from './question.service';
import { ApiResponse } from '../../utils/apiResponse';
import { AuthRequest } from '../../types';
import { CreateQuestionInput, UpdateQuestionInput, ReorderQuestionsInput } from '../exam/exam.validation';

class QuestionController {
  /** POST /api/v1/exams/:examId/questions */
  async createQuestion(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const question = await questionService.createQuestion(
      req.params.examId as string,
      req.user!.id,
      req.body as CreateQuestionInput,
    );
    ApiResponse.created(res, 'Question added successfully', { question });
  }

  /** POST /api/v1/exams/:examId/questions/bulk */
  async bulkCreateQuestions(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const questions = await questionService.bulkCreateQuestions(
      req.params.examId as string,
      req.user!.id,
      req.body.questions as CreateQuestionInput[],
    );
    ApiResponse.created(res, `${questions.length} questions added successfully`, { questions });
  }

  /** GET /api/v1/exams/:examId/questions */
  async getExamQuestions(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    // Admins/proctors see answers. Students don't.
    const includeAnswers = req.user!.role !== 'student';
    const questions = await questionService.getExamQuestions(
      req.params.examId as string,
      includeAnswers,
    );
    ApiResponse.success(res, 'Questions fetched successfully', { questions });
  }

  /** GET /api/v1/questions/:id */
  async getQuestionById(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const question = await questionService.getQuestionById(req.params.id as string);
    ApiResponse.success(res, 'Question fetched successfully', { question });
  }

  /** PATCH /api/v1/questions/:id */
  async updateQuestion(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const question = await questionService.updateQuestion(
      req.params.id as string,
      req.user!.id,
      req.body as UpdateQuestionInput,
    );
    ApiResponse.success(res, 'Question updated successfully', { question });
  }

  /** DELETE /api/v1/questions/:id */
  async deleteQuestion(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    await questionService.deleteQuestion(req.params.id as string, req.user!.id);
    ApiResponse.noContent(res);
  }

  /** PATCH /api/v1/exams/:examId/questions/reorder */
  async reorderQuestions(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    await questionService.reorderQuestions(
      req.params.examId as string,
      req.user!.id,
      req.body as ReorderQuestionsInput,
    );
    ApiResponse.success(res, 'Questions reordered successfully');
  }
}

export const questionController = new QuestionController();
