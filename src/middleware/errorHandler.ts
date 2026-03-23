import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import { ApiResponse } from '../utils/apiResponse';
import { logger } from '../utils/logger';

/**
 * Global error handler middleware.
 * Must be registered LAST in the middleware chain.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // Default values
  let statusCode = 500;
  let message = 'Internal Server Error';
  let errors: Record<string, unknown>[] | undefined;

  if (err instanceof ApiError) {
    // Known operational errors
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;

    if (!err.isOperational) {
      // Unexpected errors — log full details
      logger.error(
        {
          err,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          userId: (req as unknown as Record<string, unknown>).user,
        },
        '🔥 Unhandled error',
      );
    } else {
      // Operational errors — log at warn level
      logger.warn(
        {
          statusCode,
          message,
          method: req.method,
          url: req.originalUrl,
        },
        `⚠️  ${message}`,
      );
    }
  } else {
    // Completely unexpected error
    logger.error(
      {
        err,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
      },
      '🔥 Unexpected error',
    );
  }

  ApiResponse.error(res, message, statusCode, errors);
};

/**
 * 404 handler for unmatched routes.
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction): void => {
  ApiResponse.error(
    res,
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
  );
};
