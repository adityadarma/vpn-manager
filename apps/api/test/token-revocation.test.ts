import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import {
  revokeToken,
  isTokenRevoked,
  revokeAllUserTokens,
  isUserTokenRevoked,
  TokenRevocationSweeper,
} from '../src/services/token-revocation'

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
    await app.close()
  })

  it('should track revoked tokens in blacklist', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.test.revocation'
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600

    expect(await isTokenRevoked(app.db, fakeToken)).toBe(false)
    await revokeToken(app.db, fakeToken, futureExpiry)
    expect(await isTokenRevoked(app.db, fakeToken)).toBe(true)
  })

  it('should store tokens hashed, never in plaintext', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.hash-check.token'
    await revokeToken(app.db, fakeToken, Math.floor(Date.now() / 1000) + 3600)

    const rows = await app.db('revoked_tokens').select('token_hash')
    const hashes = rows.map((r: { token_hash: string }) => r.token_hash)
    expect(hashes).not.toContain(fakeToken)
    // sha256 hex is 64 chars
    expect(hashes.every((h: string) => /^[a-f0-9]{64}$/.test(h))).toBe(true)
  })

  it('should issue a unique token per login, even within the same second', async () => {
    const login = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'Admin@1234!' },
      })
      expect(res.statusCode).toBe(200)
      const cookie = res.headers['set-cookie']
      const raw = Array.isArray(cookie) ? cookie[0]! : cookie!
      return raw.split(';')[0]!.replace('vpn_token=', '')
    }

    // Back-to-back logins land in the same second. Without a `jti` the signed
    // payload was identical, so both tokens were byte-identical — and because
    // revocation is keyed on the token hash, logging out of one session would
    // have revoked the other too.
    const first = await login()
    const second = await login()
    expect(first).not.toBe(second)

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { Cookie: `vpn_token=${first}` },
    })

    // The other session must survive.
    expect(await isTokenRevoked(app.db, first)).toBe(true)
    expect(await isTokenRevoked(app.db, second)).toBe(false)

    const stillAlive = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Cookie: `vpn_token=${second}` },
    })
    expect(stillAlive.statusCode).toBe(200)
  })

  it('should record the owning user_id on logout', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin@1234!' },
    })
    const cookie = loginRes.headers['set-cookie']
    const cookieStr = Array.isArray(cookie) ? cookie[0]!.split(';')[0] : cookie!.split(';')[0]

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { Cookie: cookieStr },
    })

    // user_id is audit-only, but it must actually be populated — it was
    // declared in the migration yet never written at first.
    const adminUser = await app.db('users').where({ username: 'admin' }).first()
    const rows = await app.db('revoked_tokens').whereNotNull('user_id').select('user_id')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r: { user_id: string }) => r.user_id === adminUser.id)).toBe(true)
  })

  it('should be idempotent when revoking the same token twice', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.idempotent.token'
    const exp = Math.floor(Date.now() / 1000) + 3600

    await revokeToken(app.db, fakeToken, exp)
    await expect(revokeToken(app.db, fakeToken, exp)).resolves.not.toThrow()
    expect(await isTokenRevoked(app.db, fakeToken)).toBe(true)
  })

  it('should not treat an already-expired revocation as revoked', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.expired.token'
    // exp already in the past — the JWT is invalid on its own merits
    await revokeToken(app.db, fakeToken, Math.floor(Date.now() / 1000) - 10)
    expect(await isTokenRevoked(app.db, fakeToken)).toBe(false)
  })

  it('should track user-level revocations', async () => {
    const userId = 'test-user-revocation-id'
    const tokenIssuedBefore = Date.now() - 1000
    const tokenIssuedAfter = Date.now() + 1000

    expect(await isUserTokenRevoked(app.db, userId, tokenIssuedBefore)).toBe(false)
    await revokeAllUserTokens(app.db, userId)
    expect(await isUserTokenRevoked(app.db, userId, tokenIssuedBefore)).toBe(true)
    expect(await isUserTokenRevoked(app.db, userId, tokenIssuedAfter)).toBe(false)
  })

  it('should upsert rather than duplicate a user-level revocation', async () => {
    const userId = 'test-user-upsert-id'
    await revokeAllUserTokens(app.db, userId)
    await revokeAllUserTokens(app.db, userId)

    const rows = await app.db('user_token_revocations').where({ user_id: userId })
    expect(rows).toHaveLength(1)
  })

  it('should survive a simulated restart (persisted in DB)', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.persistence.token'
    await revokeToken(app.db, fakeToken, Math.floor(Date.now() / 1000) + 3600)

    // The old implementation kept this in a module-level Map, so a fresh import
    // lost it. Re-importing the module must still see the revocation.
    const freshModule = await import('../src/services/token-revocation?restart')
    expect(await freshModule.isTokenRevoked(app.db, fakeToken)).toBe(true)
  })

  describe('TokenRevocationSweeper', () => {
    it('should prune expired rows but keep live ones', async () => {
      const liveToken = 'eyJhbGciOiJIUzI1NiJ9.sweeper.live'
      const deadToken = 'eyJhbGciOiJIUzI1NiJ9.sweeper.dead'

      await revokeToken(app.db, liveToken, Math.floor(Date.now() / 1000) + 3600)
      await revokeToken(app.db, deadToken, Math.floor(Date.now() / 1000) - 3600)

      const before = await app.db('revoked_tokens').count({ n: '*' }).first()
      expect(Number(before?.n)).toBeGreaterThan(0)

      const sweeper = new TokenRevocationSweeper(app.db)
      const { tokens } = await sweeper.sweep()
      expect(tokens).toBeGreaterThan(0)

      // Live revocation must remain enforced; dead row is gone.
      expect(await isTokenRevoked(app.db, liveToken)).toBe(true)
      const deadRows = await app.db('revoked_tokens').whereRaw('1=1').select('expires_at')
      expect(
        deadRows.every((r: { expires_at: string | Date }) => new Date(r.expires_at).getTime() > Date.now()),
      ).toBe(true)
    })

    it('should prune expired user-level revocations', async () => {
      const userId = 'test-user-sweep-id'
      await app.db('user_token_revocations').insert({
        user_id: userId,
        revoked_at: new Date(Date.now() - 10_000),
        expires_at: new Date(Date.now() - 5_000),
      })

      const sweeper = new TokenRevocationSweeper(app.db)
      const { users } = await sweeper.sweep()
      expect(users).toBeGreaterThan(0)

      const rows = await app.db('user_token_revocations').where({ user_id: userId })
      expect(rows).toHaveLength(0)
    })

    it('should not throw when the sweep query fails', async () => {
      const brokenDb = (() => {
        throw new Error('db is down')
      }) as unknown as typeof app.db

      const sweeper = new TokenRevocationSweeper(brokenDb)
      await expect(sweeper.sweep()).resolves.toEqual({ tokens: 0, users: 0 })
    })
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
