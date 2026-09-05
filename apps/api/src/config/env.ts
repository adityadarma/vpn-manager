import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  WEB_URL: z.string().optional(),
  DATABASE_TYPE: z.enum(['postgres', 'mysql', 'sqlite']).default('sqlite'),
  DATABASE_URL: z.string().optional(),
  // SQLite path is resolved in @vpn/db via import.meta.url — no config needed here
  // Optional override: set DATABASE_SQLITE_PATH env var and it will be forwarded
  DATABASE_SQLITE_PATH: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env)

  if (!result.success) {
    console.error('❌ Invalid environment variables:')
    console.error(result.error.flatten().fieldErrors)
    process.exit(1)
  }

  return result.data
}
