import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from '../../config';
import { User, IUser } from '../user/user.model';
import { getRedisClient } from '../../config/redis';
import { ApiError } from '../../utils/apiError';
import { logger } from '../../utils/logger';
import { RegisterInput, LoginInput } from './auth.validation';
import { generateToken } from '../../utils/crypto';

// ─── Token Payload ───────────────────────────────────
interface TokenPayload {
  id: string;
  email: string;
  role: string;
}

// ─── Token Response ──────────────────────────────────
interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

class AuthService {
  /**
   * Generate JWT access token (short-lived: 15m).
   */
  private generateAccessToken(user: IUser): string {
    const payload: TokenPayload = {
      id: String(user._id),
      email: user.email,
      role: user.role,
    };
    return jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiry,
    } as jwt.SignOptions);
  }

  /**
   * Generate opaque refresh token (long-lived: 7d).
   * Stored in the database for revocation support.
   */
  private generateRefreshToken(): string {
    return generateToken(40);
  }

  /**
   * Generate both access and refresh tokens.
   */
  private async generateTokenPair(user: IUser): Promise<AuthTokens> {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken();

    // Store refresh token in the user's document
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: refreshToken },
      $set: { lastLoginAt: new Date() },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Register a new user.
   */
  async register(input: RegisterInput): Promise<{ user: IUser; tokens: AuthTokens }> {
    // Check if user already exists
    const existingUser = await User.findByEmail(input.email);
    if (existingUser) {
      throw ApiError.conflict('A user with this email already exists');
    }

    // Create user
    const user = await User.create({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      institution: input.institution,
      phone: input.phone,
    });

    // Generate tokens
    const tokens = await this.generateTokenPair(user);

    logger.info({ userId: user._id, role: user.role }, 'User registered successfully');

    return { user, tokens };
  }

  /**
   * Login with email and password.
   */
  async login(input: LoginInput): Promise<{ user: IUser; tokens: AuthTokens }> {
    // Find user with password field included
    const user = await User.findOne({ email: input.email.toLowerCase() }).select('+password');
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    // Check if account is active
    if (!user.isActive) {
      throw ApiError.forbidden('Your account has been deactivated. Contact an administrator.');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(input.password);
    if (!isPasswordValid) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    // Generate tokens
    const tokens = await this.generateTokenPair(user);

    logger.info({ userId: user._id }, 'User logged in successfully');

    return { user, tokens };
  }

  /**
   * Refresh the access token using a valid refresh token.
   * Implements refresh token rotation for security.
   */
  async refreshToken(oldRefreshToken: string): Promise<AuthTokens> {
    // Find the user who owns this refresh token
    const user = await User.findOne({
      refreshTokens: oldRefreshToken,
    }).select('+refreshTokens');

    if (!user) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }

    // Remove the old refresh token (rotation)
    await User.findByIdAndUpdate(user._id, {
      $pull: { refreshTokens: oldRefreshToken },
    });

    // Generate new token pair
    const tokens = await this.generateTokenPair(user);

    logger.info({ userId: user._id }, 'Token refreshed successfully');

    return tokens;
  }

  /**
   * Logout — revoke refresh token & blacklist access token.
   */
  async logout(userId: string, refreshToken: string, accessToken: string): Promise<void> {
    // Remove refresh token from user document
    await User.findByIdAndUpdate(userId, {
      $pull: { refreshTokens: refreshToken },
    });

    // Blacklist the access token in Redis (if Redis is available)
    const redis = getRedisClient();
    if (redis) {
      try {
        // Decode the token to get its expiry
        const decoded = jwt.decode(accessToken) as JwtPayload;
        if (decoded?.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await redis.setex(`bl:${accessToken}`, ttl, '1');
          }
        }
      } catch {
        // Redis blacklisting is best-effort
        logger.warn('Failed to blacklist access token in Redis');
      }
    }

    logger.info({ userId }, 'User logged out successfully');
  }

  /**
   * Logout from all devices — revoke all refresh tokens.
   */
  async logoutAll(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, {
      $set: { refreshTokens: [] },
    });

    logger.info({ userId }, 'User logged out from all devices');
  }

  /**
   * Change password.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await User.findById(userId).select('+password');
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw ApiError.badRequest('Current password is incorrect');
    }

    user.password = newPassword;
    await user.save(); // Triggers pre-save hook for hashing

    // Revoke all refresh tokens (force re-login on all devices)
    await User.findByIdAndUpdate(userId, {
      $set: { refreshTokens: [] },
    });

    logger.info({ userId }, 'Password changed successfully');
  }

  /**
   * Verify access token (used by middleware).
   */
  async verifyAccessToken(token: string): Promise<TokenPayload> {
    // Check if token is blacklisted
    const redis = getRedisClient();
    if (redis) {
      try {
        const isBlacklisted = await redis.get(`bl:${token}`);
        if (isBlacklisted) {
          throw ApiError.unauthorized('Token has been revoked');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        // Redis check failed — continue without blacklist check
      }
    }

    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
      return decoded;
    } catch {
      throw ApiError.unauthorized('Invalid or expired access token');
    }
  }
}

export const authService = new AuthService();
