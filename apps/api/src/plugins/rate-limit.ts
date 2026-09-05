import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'

interface RateLimitPluginOptions {
  nodeEnv: string
}

interface RateLimitConfig {
  max: number
  timeWindow: string
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Named rate-limit budgets for per-route `config.rateLimit`.
     *
     * Centralised so the values are visible in one place and can be relaxed
     * under test, where every request arrives from the same loopback IP and
     * would otherwise trip the limiter across unrelated cases.
     */
    rateLimits: {
      /**
       * For endpoints where an unauthenticated caller can guess a credential
       * (login, node registration). Deliberately much tighter than the global
       * default — these are rare, human-driven actions.
       */
      sensitive: RateLimitConfig
    }
  }
}

const GLOBAL_MAX = 100
const SENSITIVE_MAX = 5

export default fp(async (app, options: RateLimitPluginOptions) => {
  const isTest = options.nodeEnv === 'test'

  // Tests share one client IP, so the real budget would leak between cases.
  // An explicit override lets a test opt back into a tight limit to verify
  // enforcement, rather than leaving rate limiting untested entirely.
  const override = Number(process.env['RATE_LIMIT_SENSITIVE_MAX'])
  const sensitiveMax = Number.isInteger(override) && override > 0
    ? override
    : isTest
      ? 10_000
      : SENSITIVE_MAX

  app.decorate('rateLimits', {
    sensitive: { max: sensitiveMax, timeWindow: '1 minute' },
  })

  await app.register(rateLimit, {
    max: isTest ? 10_000 : GLOBAL_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again in a minute.',
    }),
  })
})
