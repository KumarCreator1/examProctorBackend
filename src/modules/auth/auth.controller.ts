import { Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { ApiResponse } from '../../utils/apiResponse';
import { AuthRequest } from '../../types';
import { config } from '../../config';
import { ApiError } from '../../utils/apiError';
import {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
} from './auth.validation';

const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
  const isProd = config.env === 'production';

  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax', 
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/v1/auth', // Only send to auth routes
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
};

class AuthController {
  /**
   * POST /api/v1/auth/register
   */
  async register(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const input = req.body as RegisterInput;
    const { user, tokens } = await authService.register(input);

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    ApiResponse.created(res, 'User registered successfully', {
      user,
      accessToken: tokens.accessToken, // Still returned in body for non-browser clients
      refreshToken: tokens.refreshToken,
    });
  }

  /**
   * POST /api/v1/auth/login
   */
  async login(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const input = req.body as LoginInput;
    const { user, tokens } = await authService.login(input);

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    ApiResponse.success(res, 'Login successful', {
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  }

  /**
   * POST /api/v1/auth/refresh
   */
  async refresh(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    // Extract from cookie first, fallback to body
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
      throw ApiError.unauthorized('Refresh token is required');
    }

    const tokens = await authService.refreshToken(refreshToken);

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    ApiResponse.success(res, 'Token refreshed successfully', {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  }

  /**
   * POST /api/v1/auth/logout
   */
  async logout(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    
    // Extract access token from cookies or auth header
    let accessToken = req.cookies?.accessToken;
    if (!accessToken && req.headers.authorization?.startsWith('Bearer ')) {
      accessToken = req.headers.authorization.split(' ')[1];
    }

    if (refreshToken) {
      await authService.logout(req.user!.id, refreshToken, accessToken || '');
    }

    clearAuthCookies(res);

    ApiResponse.success(res, 'Logged out successfully');
  }

  /**
   * POST /api/v1/auth/logout-all
   */
  async logoutAll(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    await authService.logoutAll(req.user!.id);
    clearAuthCookies(res);

    ApiResponse.success(res, 'Logged out from all devices successfully');
  }

  /**
   * POST /api/v1/auth/change-password
   */
  async changePassword(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const { currentPassword, newPassword } = req.body as ChangePasswordInput;

    await authService.changePassword(req.user!.id, currentPassword, newPassword);
    clearAuthCookies(res);

    ApiResponse.success(res, 'Password changed successfully. Please login again.');
  }

  /**
   * GET /api/v1/auth/me
   */
  async getMe(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    const { User } = await import('../user/user.model');
    const user = await User.findById(req.user!.id);

    if (!user) {
      ApiResponse.error(res, 'User not found', 404);
      return;
    }

    ApiResponse.success(res, 'Profile fetched successfully', { user });
  }
}

export const authController = new AuthController();
