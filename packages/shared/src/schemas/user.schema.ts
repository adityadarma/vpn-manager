import { z } from 'zod'

export const CreateUserSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, hyphens'),
  email: z.string().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
  role: z.enum(['admin', 'user']).default('user'),
}).superRefine((data, ctx) => {
  if (data.role === 'admin' && !data.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Password is required for admin users',
      path: ['password'],
    })
  }
})

export const UpdateUserSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional().or(z.literal('')),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
})

export const UserIdParamSchema = z.object({
  id: z.string().uuid(),
})

export type CreateUserInput = z.infer<typeof CreateUserSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
