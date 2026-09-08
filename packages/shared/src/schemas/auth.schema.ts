import { z } from 'zod'

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    email: z.string().nullable(),
    role: z.enum(['admin', 'user']),
    lastLogin: z.string().datetime(),
  }),
})

export type LoginInput = z.infer<typeof LoginSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
