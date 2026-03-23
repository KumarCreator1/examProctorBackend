import { Response, NextFunction } from 'express';
import { dashboardService } from './dashboard.service';
import { ApiResponse } from '../../utils/apiResponse';
import { AuthRequest } from '../../types';

/**
 * Dashboard Controller
 *
 * All endpoints require proctor/admin/superadmin auth.
 * These power the Admin Proctor Dashboard UI.
 */
class DashboardController {
  /**
   * GET /api/v1/dashboard/:examId/live
   * Main dashboard view — summary + student cards
   */
  async getLiveDashboard(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const filter = req.query.filter as 'clear' | 'warning' | 'flagged' | undefined;
    const data = await dashboardService.getLiveDashboard(req.params.examId as string, filter);
    ApiResponse.success(res, 'Dashboard data fetched', data);
  }

  /**
   * GET /api/v1/dashboard/:examId/summary
   * Header bar — exam info + live counts
   */
  async getExamSummary(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const data = await dashboardService.getExamSummary(req.params.examId as string);
    ApiResponse.success(res, 'Exam summary fetched', data);
  }

  /**
   * GET /api/v1/dashboard/:examId/leaderboard
   * Trust score leaderboard (Red Zone first)
   */
  async getTrustLeaderboard(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const data = await dashboardService.getTrustLeaderboard(req.params.examId as string);
    ApiResponse.success(res, 'Trust leaderboard fetched', { leaderboard: data });
  }

  /**
   * GET /api/v1/dashboard/:examId/student/:sessionId
   * Single student detail + evidence log
   */
  async getStudentDetail(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const data = await dashboardService.getStudentDetail(
      req.params.examId as string,
      req.params.sessionId as string,
    );
    ApiResponse.success(res, 'Student detail fetched', data);
  }

  /**
   * GET /api/v1/dashboard/:examId/violations
   * Violation signal feed (paginated)
   */
  async getViolationFeed(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const data = await dashboardService.getViolationFeed(req.params.examId as string, page, limit);
    ApiResponse.success(res, 'Violation feed fetched', data);
  }

  /**
   * GET /api/v1/dashboard/:examId/hardware
   * Hardware registry — connected peripherals
   */
  async getHardwareRegistry(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const data = await dashboardService.getHardwareRegistry(req.params.examId as string);
    ApiResponse.success(res, 'Hardware registry fetched', { registry: data });
  }

  /**
   * GET /api/v1/dashboard/:examId/analytics
   * Post-exam analytics — leakage heatmap, distributions
   */
  async getPostExamAnalytics(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const data = await dashboardService.getPostExamAnalytics(req.params.examId as string);
    ApiResponse.success(res, 'Post-exam analytics fetched', data);
  }
}

export const dashboardController = new DashboardController();
