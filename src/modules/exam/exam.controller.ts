import { Response, NextFunction } from 'express';
import { examService } from './exam.service';
import { ApiResponse } from '../../utils/apiResponse';
import { AuthRequest } from '../../types';
import {
  CreateExamInput,
  UpdateExamInput,
  UpdateExamStatusInput,
  EnrollStudentsInput,
  SelfEnrollInput,
  ListExamsQuery,
} from './exam.validation';

class ExamController {
  /** POST /api/v1/exams */
  async createExam(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const exam = await examService.createExam(req.user!.id, req.body as CreateExamInput);
    ApiResponse.created(res, 'Exam created successfully', { exam });
  }

  /** GET /api/v1/exams — admin/proctor see their exams */
  async getMyExams(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const query = req.query as unknown as ListExamsQuery;
    const { exams, meta } = await examService.getMyExams(req.user!.id, query);
    ApiResponse.paginated(res, 'Exams fetched successfully', exams, meta);
  }

  /** GET /api/v1/exams/all — superadmin sees all exams */
  async getAllExams(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const query = req.query as unknown as ListExamsQuery;
    const { exams, meta } = await examService.getAllExams(query);
    ApiResponse.paginated(res, 'All exams fetched successfully', exams, meta);
  }

  /** GET /api/v1/exams/my-exams — student sees enrolled exams */
  async getStudentExams(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const exams = await examService.getStudentExams(req.user!.id);
    ApiResponse.success(res, 'Enrolled exams fetched successfully', { exams });
  }

  /** GET /api/v1/exams/:id */
  async getExamById(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const exam = await examService.getExamById(
      req.params.id as string,
      req.user!.id,
      req.user!.role,
    );
    ApiResponse.success(res, 'Exam fetched successfully', { exam });
  }

  /** PATCH /api/v1/exams/:id */
  async updateExam(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const exam = await examService.updateExam(
      req.params.id as string,
      req.user!.id,
      req.body as UpdateExamInput,
    );
    ApiResponse.success(res, 'Exam updated successfully', { exam });
  }

  /** PATCH /api/v1/exams/:id/status */
  async updateExamStatus(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const { status } = req.body as UpdateExamStatusInput;
    const exam = await examService.updateExamStatus(req.params.id as string, req.user!.id, status);
    ApiResponse.success(res, `Exam status updated to "${status}"`, { exam });
  }

  /** DELETE /api/v1/exams/:id */
  async deleteExam(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    await examService.deleteExam(req.params.id as string, req.user!.id);
    ApiResponse.noContent(res);
  }

  /** POST /api/v1/exams/:id/enroll — admin enrolls students */
  async enrollStudents(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const { studentIds } = req.body as EnrollStudentsInput;
    const count = await examService.enrollStudents(req.params.id as string, req.user!.id, studentIds);
    ApiResponse.success(res, `${count} student(s) enrolled successfully`);
  }

  /** POST /api/v1/exams/:id/self-enroll — student self-enrolls */
  async selfEnroll(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const { accessCode } = req.body as SelfEnrollInput;
    await examService.selfEnroll(req.params.id as string, req.user!.id, accessCode);
    ApiResponse.success(res, 'Enrolled successfully');
  }

  /** GET /api/v1/exams/:id/enrollments — admin sees enrollments */
  async getEnrollments(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const enrollments = await examService.getExamEnrollments(req.params.id as string);
    ApiResponse.success(res, 'Enrollments fetched successfully', { enrollments });
  }

  /** DELETE /api/v1/exams/:id/enrollments/:studentId — revoke enrollment */
  async revokeEnrollment(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    await examService.revokeEnrollment(req.params.id as string, req.params.studentId as string);
    ApiResponse.success(res, 'Enrollment revoked successfully');
  }
}

export const examController = new ExamController();
