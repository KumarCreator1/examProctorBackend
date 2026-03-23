import { z } from 'zod';
import { USER_ROLES } from '../../utils/constants';

// ─── Register ────────────────────────────────────────
export const registerSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .email('Please provide a valid email address')
    .toLowerCase()
    .trim(),
  password: z
    .string({ error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    ),
  firstName: z
    .string({ error: 'First name is required' })
    .min(1, 'First name is required')
    .max(50, 'First name cannot exceed 50 characters')
    .trim(),
  lastName: z
    .string({ error: 'Last name is required' })
    .min(1, 'Last name is required')
    .max(50, 'Last name cannot exceed 50 characters')
    .trim(),
  role: z
    .enum([USER_ROLES.STUDENT, USER_ROLES.PROCTOR, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN])
    .optional()
    .default(USER_ROLES.STUDENT),
  institution: z.string().max(100).trim().optional().default(''),
  phone: z.string().trim().optional().default(''),
});

// ─── Login ───────────────────────────────────────────
export const loginSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .email('Please provide a valid email address')
    .toLowerCase()
    .trim(),
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required'),
});

// ─── Refresh Token ───────────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ error: 'Refresh token is required' })
    .min(1, 'Refresh token is required'),
});

// ─── Change Password ─────────────────────────────────
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: 'Current password is required' })
    .min(1, 'Current password is required'),
  newPassword: z
    .string({ error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    ),
});

// ─── Update Profile ──────────────────────────────────
export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).trim().optional(),
  lastName: z.string().min(1).max(50).trim().optional(),
  phone: z.string().trim().optional(),
  institution: z.string().max(100).trim().optional(),
  profilePicture: z.string().url().optional(),
});

// ─── Type Exports ────────────────────────────────────
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
