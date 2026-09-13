import { z } from 'zod'

export const LoginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
})

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    role: z.literal('admin'),
    lastLogin: z.string().datetime(),
  }),
})

export type LoginInput = z.infer<typeof LoginSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
