/**
 * Custom API Error class for consistent error handling.
 * Extends the native Error with HTTP status codes and operational flags.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors?: Record<string, unknown>[];

  constructor(
    statusCode: number,
    message: string,
    isOperational = true,
    errors?: Record<string, unknown>[],
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;

    // Capture proper stack trace
    Error.captureStackTrace(this, this.constructor);

    Object.setPrototypeOf(this, ApiError.prototype);
  }

  // ─── Factory Methods ────────────────────────────────
  static badRequest(message = 'Bad Request', errors?: Record<string, unknown>[]) {
    return new ApiError(400, message, true, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  static internal(message = 'Internal Server Error') {
    return new ApiError(500, message, false);
  }
}
