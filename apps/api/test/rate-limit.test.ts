import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'

/**
 * Rate limiting on POST /nodes/register.
 *
 * This lives in its own file for two reasons:
 *
 *  - the limiter is keyed by client IP, and every `app.inject()` call shares
 *    the same loopback address, so a counter set here would leak into
 *    unrelated cases in another suite;
 *  - the suites elsewhere run with a deliberately relaxed budget (see
 *    plugins/rate-limit.ts), so enforcement has to be checked against an
 *    instance built with an explicit tight override.
 *
 * Note the whole sequence is a single test: one app per file (the @vpn/db
 * client is a singleton), and one shared counter, so the budget can only be
 * exercised once.
 */
describe('Node registration rate limiting', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.RATE_LIMIT_SENSITIVE_MAX = '3'
    process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'

    app = await buildApp({
      DATABASE_TYPE: 'sqlite',
      DATABASE_SQLITE_PATH: ':memory:',
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)

    await app.db.migrate.latest()
    await app.db.seed.run()
  })

  afterAll(async () => {
    delete process.env.RATE_LIMIT_SENSITIVE_MAX
    delete process.env.NODE_REGISTRATION_KEY
    await app.close()
  })

  it('throttles repeated registration attempts with 429', async () => {
    const attempt = (key: string, n: number) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/nodes/register',
        payload: {
          hostname: `rl-node-${n}`,
          ip: `192.168.9.${n + 1}`,
          registrationKey: key,
        },
      })

    // Within budget (max = 3): each request is judged on the key itself.
    // A wrong key gets 403 from the credential check, not from the limiter.
    expect((await attempt('wrong-key-1', 1)).statusCode).toBe(403)
    expect((await attempt('wrong-key-2', 2)).statusCode).toBe(403)
    // A correct key still registers while under the limit.
    expect((await attempt('correct-key-12345', 3)).statusCode).toBe(201)

    // Budget exhausted: the limiter now short-circuits everything, including
    // requests carrying a valid key. This is what bounds brute-force guessing
    // of NODE_REGISTRATION_KEY, which is a static secret with no TTL.
    const blocked = await attempt('correct-key-12345', 4)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error).toBe('Too Many Requests')

    // And the throttled request must not have created a node.
    const leaked = await app.db('vpn_nodes').where({ hostname: 'rl-node-4' }).first()
    expect(leaked).toBeUndefined()
  })
})
