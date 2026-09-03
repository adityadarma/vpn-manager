import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { revokeToken, isTokenRevoked, revokeAllUserTokens, isUserTokenRevoked, stopBlacklistCleanup } from '../src/services/token-blacklist.service'

describe('Token Revocation', () => {
  let app: FastifyInstance

  beforeAll(async () => {
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
    stopBlacklistCleanup()
    await app.close()
  })

  it('should track revoked tokens in blacklist', () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.test.revocation'
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600

    expect(isTokenRevoked(fakeToken)).toBe(false)
    revokeToken(fakeToken, futureExpiry)
    expect(isTokenRevoked(fakeToken)).toBe(true)
  })

  it('should track user-level revocations', () => {
    const userId = 'test-user-revocation-id'
    const tokenIssuedBefore = Date.now() - 1000
    const tokenIssuedAfter = Date.now() + 1000

    expect(isUserTokenRevoked(userId, tokenIssuedBefore)).toBe(false)
    revokeAllUserTokens(userId)
    expect(isUserTokenRevoked(userId, tokenIssuedBefore)).toBe(true)
    expect(isUserTokenRevoked(userId, tokenIssuedAfter)).toBe(false)
  })

  it('should reject token after logout', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin@1234!' },
    })
    expect(loginRes.statusCode).toBe(200)

    const cookie = loginRes.headers['set-cookie']
    const cookieStr = Array.isArray(cookie) ? cookie[0]!.split(';')[0] : cookie!.split(';')[0]

    const meRes1 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Cookie: cookieStr },
    })
    expect(meRes1.statusCode).toBe(200)

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { Cookie: cookieStr },
    })

    const meRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Cookie: cookieStr },
    })
    expect(meRes2.statusCode).toBe(401)
  })
})
