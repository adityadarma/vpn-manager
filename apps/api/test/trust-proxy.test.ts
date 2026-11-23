import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { DEFAULT_TRUST_PROXY, parseTrustProxy } from '../src/config/env'
import { getClientIp } from '../src/utils/audit'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * The login limiter is keyed by request.ip, so which X-Forwarded-For values
 * Fastify believes decides whether the limit can be bypassed.
 *
 * Each case uses its own client addresses because the counters are shared
 * across the file, and one app per file (the @vpn/db client is a singleton).
 */
describe('Client IP resolution for rate limiting', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
  })

  afterAll(async () => {
    await app.close()
  })

  const login = (remoteAddress: string, forwardedFor: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
      payload: { email: 'absent@example.test', password: 'wrong-password' },
    })

  const statuses = async (count: number, send: (i: number) => ReturnType<typeof login>) => {
    const codes: number[] = []
    for (let i = 0; i < count; i++) codes.push((await send(i)).statusCode)
    return codes
  }

  it('ignores X-Forwarded-For from a client that is not a trusted proxy', async () => {
    const codes = await statuses(11, (i) => login('198.51.100.7', `203.0.113.${i + 1}`))
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(401))
    expect(codes[10]).toBe(429)
  })

  it('ignores client-supplied hops left of the real client when behind a trusted proxy', async () => {
    const codes = await statuses(11, (i) => login('127.0.0.1', `192.0.2.${i + 1}, 203.0.113.50`))
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(401))
    expect(codes[10]).toBe(429)
  })

  it('keeps a separate budget for each client behind a trusted proxy', async () => {
    const codes = await statuses(11, (i) => login('127.0.0.1', `203.0.113.${100 + i}`))
    expect(codes).toEqual(Array(11).fill(401))
  })
})

describe('getClientIp', () => {
  it('returns request.ip and ignores client-set forwarding headers', () => {
    const request = {
      ip: '203.0.113.9',
      headers: {
        'cf-connecting-ip': '198.51.100.1',
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '198.51.100.3',
      },
    } as unknown as FastifyRequest
    expect(getClientIp(request)).toBe('203.0.113.9')
  })
})

describe('parseTrustProxy', () => {
  it('defaults to loopback and private ranges', () => {
    expect(parseTrustProxy(undefined)).toEqual(DEFAULT_TRUST_PROXY.split(','))
    expect(parseTrustProxy('  ')).toEqual(DEFAULT_TRUST_PROXY.split(','))
  })

  it('accepts booleans and address lists', () => {
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('true')).toBe(true)
    expect(parseTrustProxy('10.0.0.0/8, 192.0.2.1')).toEqual(['10.0.0.0/8', '192.0.2.1'])
  })
})
