import { Response, NextFunction } from 'express';
import { userService } from './user.service';
import { ApiResponse } from '../../utils/apiResponse';
import { AuthRequest } from '../../types';
import { UpdateProfileInput } from '../auth/auth.validation';
import { UpdateRoleInput, ListUsersQuery } from './user.validation';

class UserController {
  /**
   * GET /api/v1/users
   * Admin only: list all users with filtering & pagination.
   */
  async getUsers(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const query = req.query as unknown as ListUsersQuery;
    const { users, meta } = await userService.getUsers(query);

    ApiResponse.paginated(res, 'Users fetched successfully', users, meta);
  }

  /**
   * GET /api/v1/users/:id
   * Get a single user by ID.
   */
  async getUserById(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const user = await userService.getUserById(req.params.id as string);
    ApiResponse.success(res, 'User fetched successfully', { user });
  }

  /**
   * PATCH /api/v1/users/profile
   * Update own profile.
   */
  async updateProfile(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const updates = req.body as UpdateProfileInput;
    const user = await userService.updateProfile(req.user!.id, updates);

    ApiResponse.success(res, 'Profile updated successfully', { user });
  }

  /**
   * PATCH /api/v1/users/:id/role
   * Admin only: update a user's role.
   */
  async updateRole(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const { role } = req.body as UpdateRoleInput;
    const user = await userService.updateUserRole(req.params.id as string, role);

    ApiResponse.success(res, 'User role updated successfully', { user });
  }

  /**
   * PATCH /api/v1/users/:id/deactivate
   * Admin only: deactivate a user.
   */
  async deactivateUser(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const user = await userService.deactivateUser(req.params.id as string);
    ApiResponse.success(res, 'User deactivated successfully', { user });
  }

  /**
   * PATCH /api/v1/users/:id/reactivate
   * Admin only: reactivate a user.
   */
  async reactivateUser(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const user = await userService.reactivateUser(req.params.id as string);
    ApiResponse.success(res, 'User reactivated successfully', { user });
  }

  /**
   * DELETE /api/v1/users/:id
   * Superadmin only: permanently delete a user.
   */
  async deleteUser(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    await userService.deleteUser(req.params.id as string);
    ApiResponse.noContent(res);
  }
}

export const userController = new UserController();
