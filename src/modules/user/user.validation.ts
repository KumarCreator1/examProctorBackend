import { z } from 'zod';
import { USER_ROLES } from '../../utils/constants';

// ─── Update Role ─────────────────────────────────────
export const updateRoleSchema = z.object({
  role: z.enum([USER_ROLES.STUDENT, USER_ROLES.PROCTOR, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
});

// ─── Query Params for listing users ──────────────────
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  role: z
    .enum([USER_ROLES.STUDENT, USER_ROLES.PROCTOR, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN])
    .optional(),
  institution: z.string().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  search: z.string().optional(),
});

// ─── Type Exports ────────────────────────────────────
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
