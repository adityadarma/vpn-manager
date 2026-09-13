import { z } from 'zod'

export const CreateUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
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
  if (data.role === 'admin' && !data.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Email is required for admin users', path: ['email'] })
  }
})

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
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
