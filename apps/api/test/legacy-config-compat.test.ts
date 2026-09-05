import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { loginAsAdmin } from './helpers'

/**
 * Backwards compatibility with nodes created before task-payload validation
 * existed (v1.0.0 and earlier).
 *
 * Adding strict enums to `update_server_config` locked admins out of editing
 * any node whose stored config fell outside those enums: GET /nodes/:id/config
 * returned the stored value, and PUT rejected that same value with a 400.
 *
 * Two independent routes let a node's config drift outside a fixed list, so
 * this was reachable in normal operation rather than only by editing the DB:
 *
 *  - POST /nodes/sync-config — the agent parses an existing server.conf and
 *    pushes whatever it finds (`auth SHA1`, `comp-lzo yes`, …).
 *  - POST /nodes/heartbeat — writes the agent's own firewall engine, whose
 *    default is `auto`.
 *
 * These tests assert the round trip stays lossless, while still rejecting
 * values that could inject an extra OpenVPN directive.
 */
describe('Legacy node config compatibility', () => {
  let app: FastifyInstance
  let adminCookie: string

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
    adminCookie = await loginAsAdmin(app)
  })

  afterAll(async () => {
    await app.close()
  })

  let ipCounter = 0
  const makeNode = async (overrides: Record<string, unknown> = {}) => {
    const id = uuidv7()
    ipCounter += 1
    await app.db('vpn_nodes').insert({
      id,
      hostname: `legacy-${ipCounter}`,
      ip_address: `10.9.0.${ipCounter}`,
      port: 1194,
      token: `legacy-token-${id}`,
      status: 'online',
      ...overrides,
    })
    return id
  }

  /** GET the node's config and PUT it straight back, unchanged. */
  const roundTrip = async (nodeId: string) => {
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/config`,
      headers: { Cookie: adminCookie },
    })
    expect(get.statusCode).toBe(200)

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/config`,
      headers: { Cookie: adminCookie },
      payload: get.json(),
    })
    return { config: get.json(), put }
  }

  it('a node on pure migration defaults round-trips', async () => {
    const nodeId = await makeNode()
    const { put } = await roundTrip(nodeId)
    expect(put.statusCode).toBe(200)
  })

  it.each([
    ['auth_digest', 'SHA1'],
    ['compression', 'yes'],
    ['compression', 'adaptive'],
    ['cipher', 'BF-CBC'],
    ['cipher', 'AES-256-GCM:AES-128-GCM'],
    ['protocol', 'udp6'],
    ['firewall_engine', 'auto'],
  ])('a node with legacy %s=%s stays editable', async (column, value) => {
    const nodeId = await makeNode({ [column]: value })
    const { config, put } = await roundTrip(nodeId)

    // The stored value is what GET handed back...
    expect(config[column]).toBe(value)
    // ...and PUT must accept it rather than locking the admin out.
    expect(put.statusCode).toBe(200)

    // The value must survive the write unchanged.
    const row = await app.db('vpn_nodes').where({ id: nodeId }).first()
    expect(row[column]).toBe(value)
  })

  it('an agent-synced legacy config remains editable end to end', async () => {
    const nodeId = await makeNode()
    const token = (await app.db('vpn_nodes').where({ id: nodeId }).first()).token

    // Agent reports what it parsed from an older server.conf.
    const sync = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/sync-config',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        port: 1194,
        protocol: 'udp',
        cipher: 'AES-256-CBC',
        auth: 'SHA1',
        vpnNetwork: '10.8.0.0',
        vpnNetmask: '255.255.255.0',
        dnsServers: '8.8.8.8',
        pushRoutes: '',
        compression: 'yes',
        keepalivePing: 10,
        keepaliveTimeout: 60,
        maxClients: 100,
        tunnelMode: 'full',
      },
    })
    expect(sync.statusCode).toBe(200)

    const { put } = await roundTrip(nodeId)
    expect(put.statusCode).toBe(200)
  })

  it('an agent heartbeat with firewall_engine=auto leaves the node editable', async () => {
    const nodeId = await makeNode()
    const token = (await app.db('vpn_nodes').where({ id: nodeId }).first()).token

    // `auto` is the agent's default (apps/agent/src/config/env.ts).
    const hb = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/heartbeat',
      headers: { Authorization: `Bearer ${token}` },
      payload: { nodeId, firewallEngine: 'auto' },
    })
    expect(hb.statusCode).toBe(200)

    const { config, put } = await roundTrip(nodeId)
    expect(config.firewall_engine).toBe('auto')
    expect(put.statusCode).toBe(200)
  })

  describe('permissive does not mean unvalidated', () => {
    const put = (overrides: Record<string, unknown>) =>
      makeNode().then((nodeId) =>
        app.inject({
          method: 'PUT',
          url: `/api/v1/nodes/${nodeId}/config`,
          headers: { Cookie: adminCookie },
          payload: {
            port: 1194,
            protocol: 'udp',
            tunnel_mode: 'full',
            vpn_network: '10.8.0.0',
            vpn_netmask: '255.255.255.0',
            dns_servers: '8.8.8.8',
            cipher: 'AES-256-GCM',
            compression: 'none',
            keepalive_ping: 10,
            keepalive_timeout: 120,
            ...overrides,
          },
        }),
      )

    it.each([
      ['whitespace smuggles an extra argument', { cipher: 'AES-256-GCM foo' }],
      ['newline smuggles a directive', { cipher: 'AES-256-GCM\nup /tmp/x.sh' }],
      ['shell metacharacters', { auth_digest: 'SHA256; id' }],
      ['command substitution', { compression: '$(id)' }],
      ['quotes', { cipher: 'AES-256-GCM"' }],
      ['leading dash looks like a flag', { firewall_engine: '-iptables' }],
      ['empty value', { cipher: '' }],
    ])('still rejects %s', async (_label, overrides) => {
      const res = await put(overrides)
      expect(res.statusCode).toBe(400)
    })
  })
})
