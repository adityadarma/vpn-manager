import { z } from 'zod'

// Reverse proxies on the same host or a private network (nginx, Docker bridge,
// Cloudflare Tunnel) are trusted. A client connecting from a public address
// cannot set its own IP through X-Forwarded-For.
export const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal'

/**
 * Convert TRUST_PROXY into the value Fastify's `trustProxy` option expects:
 * `true`/`false`, or a list of IPs, CIDRs, and named ranges.
 */
export function parseTrustProxy(value: string | undefined): boolean | string[] {
  const raw = value?.trim() || DEFAULT_TRUST_PROXY
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  WEB_URL: z.string().optional(),
  TRUST_PROXY: z.string().default(DEFAULT_TRUST_PROXY),
})

export type Env = z.infer<typeof EnvSchema>

const PLACEHOLDER_PATTERN = /change[-_ ]?me/i
const SECRET_KEYS = ['JWT_SECRET', 'NODE_REGISTRATION_KEY', 'VPN_TOKEN'] as const

/** Names of secrets that still hold a template value such as `CHANGE_ME_TO...`. */
export function findPlaceholderSecrets(source: NodeJS.ProcessEnv): string[] {
  return SECRET_KEYS.filter((key) => PLACEHOLDER_PATTERN.test(source[key] ?? ''))
}

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env)

  if (!result.success) {
    console.error('❌ Invalid environment variables:')
    console.error(result.error.flatten().fieldErrors)
    process.exit(1)
  }

  const placeholders = findPlaceholderSecrets(process.env)
  if (placeholders.length > 0) {
    const names = placeholders.join(', ')
    if (result.data.NODE_ENV === 'production') {
      console.error(`❌ Placeholder values in production for: ${names}. Replace them with generated secrets.`)
      process.exit(1)
    }
    console.warn(`⚠️  Placeholder values for: ${names}. Replace them before deploying to production.`)
  }

  return result.data
}
