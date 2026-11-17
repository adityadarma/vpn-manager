import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { loginAsAdmin } from './helpers'

/**
 * Request framing across every mutating route.
 *
 * Unit tests normally call routes the way `app.inject` frames them, which is
 * not how real clients and reverse proxies do. A body-less POST forwarded as
 * `Transfer-Encoding: chunked` without a Content-Type made Fastify answer
 * 415 Unsupported Media Type on the Managed DNS Sync button, and no test
 * caught it.
 *
 * Routes are discovered from the OpenAPI spec, so a new route is covered
 * automatically. Path parameters use IDs that do not exist: the assertions
 * are about how the request is framed, not what the handler does with it.
 */

const VPN_TOKEN = 'framing-vpn-token'
const MISSING_ID = '01a1e700-0000-7000-8000-000000000000'
const MISSING_BACKUP = 'vpn-manager-20000101-000000.sqlite'

type Route = { method: string; url: string; path: string }
type Framing = {
  name: string
  headers: Record<string, string>
  payload?: string
}

// Framings a well-behaved client or proxy can produce for an empty request.
const ACCEPTED: Framing[] = [
  { name: 'no body (Content-Length: 0)', headers: { 'content-length': '0' } },
  {
    name: 'empty chunked body without Content-Type (reverse proxy)',
    headers: { 'transfer-encoding': 'chunked' },
    payload: '',
  },
  { name: 'JSON {}', headers: { 'content-type': 'application/json' }, payload: '{}' },
  {
    name: 'chunked JSON {}',
    headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    payload: '{}',
  },
]

// Framings that carry content the API cannot interpret.
const REJECTED: Framing[] = [
  {
    name: 'unknown Content-Type',
    headers: { 'content-type': 'application/octet-stream' },
    payload: 'x',
  },
  {
    name: 'non-empty body without Content-Type',
    headers: { 'transfer-encoding': 'chunked' },
    payload: 'x',
  },
]

// Routes authenticated with the agent's node token instead of the admin cookie.
const NODE_AUTH_ROUTES = new Set([
  '/api/v1/nodes/me',
  '/api/v1/nodes/me/decommission',
  '/api/v1/nodes/heartbeat',
  '/api/v1/nodes/telemetry',
  '/api/v1/nodes/sync-certs',
  '/api/v1/nodes/sync-config',
  '/api/v1/tasks/{id}/result',
])

// Writes a real backup file next to the database. Covered by its own tests.
const SKIPPED = new Set(['POST /api/v1/settings/backups'])
// Accepts only `application/vnd.sqlite3` uploads by design.
const SQLITE_UPLOAD = 'POST /api/v1/settings/restore'

describe('request framing on mutating routes', () => {
  let app: FastifyInstance
  let adminCookie: string
  let nodeToken: string
  let routes: Route[]
  let nodeCounter = 0

  const registerNode = async () => {
    nodeCounter += 1
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      headers: { Cookie: adminCookie },
      payload: { hostname: `framing-${nodeCounter}`, ip: `10.99.0.${nodeCounter}`, port: 1194 },
    })
    expect(res.statusCode).toBe(201)
    return res.json().token as string
  }

  beforeAll(async () => {
    process.env.VPN_TOKEN = VPN_TOKEN
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
    await app.db.seed.run()
    await app.ready()
    adminCookie = await loginAsAdmin(app)
    nodeToken = await registerNode()

    const spec = (app as any).swagger() as { paths: Record<string, Record<string, unknown>> }
    routes = Object.entries(spec.paths).flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method) => ['post', 'put', 'patch', 'delete'].includes(method))
        .map((method) => ({
          method: method.toUpperCase(),
          path,
          url: path.replace(/\{name\}/g, MISSING_BACKUP).replace(/\{[^}]+\}/g, MISSING_ID),
        }))
        .filter((route) => !SKIPPED.has(`${route.method} ${route.path}`)),
    )
  })

  afterAll(async () => {
    delete process.env.VPN_TOKEN
    await app.close()
  })

  /**
   * Sends the credential each route checks, so the request is not stopped by
   * authentication before Fastify parses the body. An `Authorization` header
   * takes precedence over the admin cookie, so it is only sent to agent routes.
   * Routes that revoke the caller's own credential get a fresh one each time.
   */
  const send = async (route: Route, framing: Framing) => {
    const credentials: Record<string, string> = { 'X-VPN-Token': VPN_TOKEN }
    if (NODE_AUTH_ROUTES.has(route.path)) {
      const token = route.path.startsWith('/api/v1/nodes/me') ? await registerNode() : nodeToken
      credentials.Authorization = `Bearer ${token}`
    } else {
      // Logout revokes the token it receives, so it gets a throwaway one. Signed
      // directly because repeated logins would hit the login rate limit.
      credentials.Cookie =
        route.path === '/api/v1/auth/logout'
          ? `vpn_token=${app.jwt.sign({ jti: crypto.randomUUID(), id: 'framing-logout', name: 'x', role: 'admin' })}`
          : adminCookie
    }
    return app.inject({
      method: route.method as any,
      url: route.url,
      headers: { ...credentials, ...framing.headers },
      ...(framing.payload !== undefined ? { payload: framing.payload } : {}),
    })
  }

  it('discovers the mutating routes', () => {
    // Guards against the spec silently producing nothing to test.
    expect(routes.length).toBeGreaterThan(50)
  })

  it.each(ACCEPTED)('accepts $name on every route', async (framing) => {
    const failures: string[] = []
    for (const route of routes) {
      const res = await send(route, framing)
      const key = `${route.method} ${route.path}`
      const unsupported = res.statusCode === 415 && key !== SQLITE_UPLOAD
      if (unsupported || res.statusCode === 401 || res.statusCode >= 500) {
        failures.push(`${key} -> ${res.statusCode} ${res.body.slice(0, 160)}`)
      }
    }
    expect(failures.join("\n")).toBe("")
  })

  it.each(REJECTED)('rejects $name with 415 on every route', async (framing) => {
    const failures: string[] = []
    for (const route of routes) {
      const res = await send(route, framing)
      if (res.statusCode !== 415) {
        failures.push(`${route.method} ${route.path} -> ${res.statusCode} ${res.body.slice(0, 160)}`)
      }
    }
    expect(failures.join("\n")).toBe("")
  })
})
