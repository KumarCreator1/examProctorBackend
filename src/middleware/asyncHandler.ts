import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler to automatically catch errors
 * and pass them to the global error handler via next().
 *
 * Usage:
 *   router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await UserService.findAll();
 *     ApiResponse.success(res, 'Users fetched', users);
 *   }));
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
