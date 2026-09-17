import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'

describe('Sessions API', () => {
  let app: FastifyInstance
  let adminCookie: string

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)

    await app.db.migrate.latest()
    await app.db.seed.run()
    adminCookie = await loginAsAdmin(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('should list active sessions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('should list session history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/history',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    const json = res.json() as { sessions: unknown[] }
    expect(Array.isArray(json.sessions)).toBe(true)
  })

  describe('stats "today" boundary', () => {
    const nodeId = 'tz-stats-node'
    const userId = 'tz-stats-user'

    /**
     * Seed one session at a fixed UTC instant that falls on different calendar
     * days depending on the viewer's timezone.
     *
     * 2026-01-01T20:00:00Z is:
     *   - still 1 Jan in UTC
     *   - already 2 Jan in Asia/Jakarta (UTC+7 → 03:00)
     *   - still 1 Jan in America/New_York (UTC-5 → 15:00)
     */
    const sessionAt = Date.UTC(2026, 0, 1, 20, 0, 0)

    beforeAll(async () => {
      await app.db('vpn_nodes').insert({
        id: nodeId,
        hostname: 'tz-stats-node',
        ip_address: '198.51.100.90',
        token: 'tz-stats-token',
      })
      await app.db('users').insert({
        id: userId,
        name: 'tz-stats-user',
        email: 'tz-stats@vpn.local',
        password: 'x',
        role: 'user',
        is_active: true,
      })
      await app.db('vpn_sessions').insert({
        id: 'tz-stats-session',
        user_id: userId,
        node_id: nodeId,
        vpn_ip: '10.90.0.10',
        bytes_sent: 1000,
        bytes_received: 500,
        connected_at: new Date(sessionAt),
        disconnected_at: new Date(sessionAt + 60_000),
        connection_duration_seconds: 60,
      })
    })

    async function statsFor(tz?: string) {
      const url = tz
        ? `/api/v1/sessions/stats?tz=${encodeURIComponent(tz)}`
        : '/api/v1/sessions/stats'
      const res = await app.inject({ method: 'GET', url, headers: { Cookie: adminCookie } })
      expect(res.statusCode).toBe(200)
      return res.json() as {
        sessions_today: number
        bandwidth_today: { total: number }
        today_starts_at: string
        time_zone: string
      }
    }

    it('reports the timezone it used and defaults to UTC', async () => {
      const json = await statsFor()
      expect(json.time_zone).toBe('UTC')
      expect(new Date(json.today_starts_at).getUTCHours()).toBe(0)
    })

    it('resolves "today" at local midnight, not UTC midnight', async () => {
      const utc = await statsFor('UTC')
      const jakarta = await statsFor('Asia/Jakarta')

      // Jakarta is UTC+7, so its midnight lands 7h earlier in UTC terms.
      expect(new Date(utc.today_starts_at).getTime()).toBeGreaterThan(
        new Date(jakarta.today_starts_at).getTime(),
      )
      expect(
        new Date(utc.today_starts_at).getTime() - new Date(jakarta.today_starts_at).getTime(),
      ).toBe(7 * 60 * 60 * 1000)
    })

    it('handles a non-hour offset zone', async () => {
      // Asia/Kathmandu is UTC+05:45.
      const kathmandu = await statsFor('Asia/Kathmandu')
      const utc = await statsFor('UTC')
      expect(
        new Date(utc.today_starts_at).getTime() - new Date(kathmandu.today_starts_at).getTime(),
      ).toBe(5 * 60 * 60 * 1000 + 45 * 60 * 1000)
    })

    it('falls back to UTC for an unresolvable zone instead of failing', async () => {
      const bogus = await statsFor('Not/AZone')
      const utc = await statsFor('UTC')
      expect(bogus.today_starts_at).toBe(utc.today_starts_at)
    })

    it('counts a session on the calendar day local to the caller', async () => {
      // Freeze "now" to an instant where the two zones disagree about which
      // calendar day the seeded session belongs to.
      //
      // At 2026-01-02T10:00:00Z the session (2026-01-01T20:00:00Z) is:
      //   - UTC          → now is 2 Jan 10:00, day started 2 Jan 00:00Z, session was yesterday
      //   - Asia/Jakarta → now is 2 Jan 17:00, day started 1 Jan 17:00Z, session is today
      const fixedNow = Date.UTC(2026, 0, 2, 10, 0, 0)
      const spy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      try {
        const utc = await statsFor('UTC')
        expect(utc.today_starts_at).toBe('2026-01-02T00:00:00.000Z')
        expect(utc.sessions_today).toBe(0)
        expect(utc.bandwidth_today.total).toBe(0)

        const jakarta = await statsFor('Asia/Jakarta')
        expect(jakarta.today_starts_at).toBe('2026-01-01T17:00:00.000Z')
        expect(jakarta.sessions_today).toBe(1)
        expect(jakarta.bandwidth_today.total).toBe(1500)
      } finally {
        spy.mockRestore()
      }
    })
  })
})
