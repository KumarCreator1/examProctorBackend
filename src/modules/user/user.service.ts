import { User, IUser } from './user.model';
import { ApiError } from '../../utils/apiError';
import { logger } from '../../utils/logger';
import { UpdateProfileInput } from '../auth/auth.validation';
import { UserRole } from '../../utils/constants';

interface UserQuery {
  page?: number;
  limit?: number;
  role?: UserRole;
  institution?: string;
  isActive?: boolean;
  search?: string;
}

class UserService {
  /**
   * Get all users with filtering and pagination (Admin only).
   */
  async getUsers(query: UserQuery) {
    const {
      page = 1,
      limit = 20,
      role,
      institution,
      isActive,
      search,
    } = query;

    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (institution) filter.institution = { $regex: institution, $options: 'i' };
    if (isActive !== undefined) filter.isActive = isActive;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return {
      users,
      meta: { page, limit, total },
    };
  }

  /**
   * Get a single user by ID.
   */
  async getUserById(userId: string): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    return user;
  }

  /**
   * Update user profile.
   */
  async updateProfile(userId: string, updates: UpdateProfileInput): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    logger.info({ userId }, 'Profile updated successfully');
    return user;
  }

  /**
   * Update user role (Admin/Superadmin only).
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { role: newRole } },
      { new: true, runValidators: true },
    );

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    logger.info({ userId, newRole }, 'User role updated');
    return user;
  }

  /**
   * Deactivate a user account (Admin only).
   */
  async deactivateUser(userId: string): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: { isActive: false, refreshTokens: [] },
      },
      { new: true },
    );

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    logger.info({ userId }, 'User deactivated');
    return user;
  }

  /**
   * Reactivate a user account (Admin only).
   */
  async reactivateUser(userId: string): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { isActive: true } },
      { new: true },
    );

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    logger.info({ userId }, 'User reactivated');
    return user;
  }

  /**
   * Delete user permanently (Superadmin only).
   */
  async deleteUser(userId: string): Promise<void> {
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    logger.info({ userId }, 'User permanently deleted');
  }
}

export const userService = new UserService();
