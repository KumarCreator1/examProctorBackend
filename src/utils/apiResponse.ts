import { Response } from 'express';

/**
 * Standardized API response format.
 * Every API response follows this structure for consistency.
 */
interface ApiResponsePayload<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
  errors?: Record<string, unknown>[];
}

export class ApiResponse {
  /**
   * Success response (200)
   */
  static success<T>(res: Response, message: string, data?: T, statusCode = 200): Response {
    const payload: ApiResponsePayload<T> = {
      success: true,
      message,
      data,
    };
    return res.status(statusCode).json(payload);
  }

  /**
   * Created response (201)
   */
  static created<T>(res: Response, message: string, data?: T): Response {
    return ApiResponse.success(res, message, data, 201);
  }

  /**
   * Paginated response
   */
  static paginated<T>(
    res: Response,
    message: string,
    data: T[],
    meta: { page: number; limit: number; total: number },
  ): Response {
    const payload: ApiResponsePayload<T[]> = {
      success: true,
      message,
      data,
      meta: {
        page: meta.page,
        limit: meta.limit,
        total: meta.total,
        totalPages: Math.ceil(meta.total / meta.limit),
      },
    };
    return res.status(200).json(payload);
  }

  /**
   * Error response
   */
  static error(
    res: Response,
    message: string,
    statusCode = 500,
    errors?: Record<string, unknown>[],
  ): Response {
    const payload: ApiResponsePayload = {
      success: false,
      message,
      errors,
    };
    return res.status(statusCode).json(payload);
  }

  /**
   * No content response (204)
   */
  static noContent(res: Response): Response {
    return res.status(204).send();
  }
}
