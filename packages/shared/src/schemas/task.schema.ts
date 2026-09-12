import { z } from 'zod'

export const TaskResultSchema = z.object({
  status: z.enum(['success', 'failed']),
  result: z.record(z.string(), z.unknown()).optional(),
  errorMessage: z.string().nullable().optional(),
})

export type TaskResultInput = z.infer<typeof TaskResultSchema>
