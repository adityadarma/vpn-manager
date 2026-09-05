import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'

describe('Nodes API', () => {
  let app: FastifyInstance
  let adminCookie: string
  let nodeId: string
  let nodeToken: string

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

  it('should register a new node', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      headers: { Cookie: adminCookie },
      payload: { hostname: 'Test Node', ip: '10.0.0.1', port: 1194, region: 'us-east', version: '1.0.0' }
    })

    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json.id).toBeDefined()
    expect(json.token).toBeDefined()

    nodeId = json.id
    nodeToken = json.token
  })

  it('should list nodes for admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/nodes',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json.some((n: any) => n.id === nodeId)).toBe(true)
  })

  it('should handle node heartbeat with node token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/heartbeat',
      headers: { Authorization: `Bearer ${nodeToken}` },
      payload: { nodeId }
    })

    expect(res.statusCode).toBe(200)
  })

  describe('PUT /nodes/:id/config validation', () => {
    // What the web UI actually submits (see apps/web/.../nodes.tsx initial state).
    const validConfig = {
      port: 1194,
      protocol: 'udp',
      tunnel_mode: 'full',
      vpn_network: '10.8.0.0',
      vpn_netmask: '255.255.255.0',
      dns_servers: '8.8.8.8,1.1.1.1',
      push_routes: '',
      cipher: 'AES-256-GCM',
      auth_digest: 'SHA256',
      compression: 'lz4-v2',
      keepalive_ping: 10,
      keepalive_timeout: 120,
      max_clients: 100,
      custom_push_directives: '',
      firewall_engine: 'iptables',
    }

    const putConfig = (overrides: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/nodes/${nodeId}/config`,
        headers: { Cookie: adminCookie },
        payload: { ...validConfig, ...overrides },
      })

    it('accepts the config shape the web UI submits', async () => {
      const res = await putConfig({})
      expect(res.statusCode).toBe(200)
      expect(res.json().taskId).toBeDefined()
    })

    it('rejects a script-executing custom_push_directive', async () => {
      const res = await putConfig({ custom_push_directives: 'up /tmp/evil.sh' })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a plugin directive', async () => {
      const res = await putConfig({ custom_push_directives: 'plugin /tmp/evil.so' })
      expect(res.statusCode).toBe(400)
    })

    it('rejects quote-escape smuggling in custom_push_directives', async () => {
      const res = await putConfig({
        custom_push_directives: 'dhcp-option DNS 1.1.1.1"\nup /tmp/x.sh\n"',
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a cipher containing shell metacharacters', async () => {
      const res = await putConfig({ cipher: 'AES-256-GCM; touch /tmp/x' })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a cipher containing whitespace (directive injection)', async () => {
      // Written to server.conf as `cipher <value>`, so embedded whitespace
      // would smuggle an extra argument.
      const res = await putConfig({ cipher: 'AES-256-GCM foo' })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a newline in a config token', async () => {
      const res = await putConfig({ cipher: 'AES-256-GCM\nup /tmp/evil.sh' })
      expect(res.statusCode).toBe(400)
    })

    it('accepts an unlisted but well-formed legacy value', async () => {
      // Not offered by the UI, but a pre-existing node can legitimately hold
      // it (e.g. synced from an older server.conf). It must stay editable.
      const res = await putConfig({ auth_digest: 'SHA1' })
      expect(res.statusCode).toBe(200)
    })

    it('rejects non-IPv4 dns_servers', async () => {
      const res = await putConfig({ dns_servers: '8.8.8.8$(id)' })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a non-IPv4 vpn_network', async () => {
      const res = await putConfig({ vpn_network: 'not-an-ip' })
      expect(res.statusCode).toBe(400)
    })

    it('does not persist a rejected config', async () => {
      const before = await app.db('vpn_nodes').where({ id: nodeId }).first()

      const res = await putConfig({ custom_push_directives: 'up /tmp/persist-check.sh' })
      expect(res.statusCode).toBe(400)

      // Validation runs before the DB write, so nothing should have changed.
      const after = await app.db('vpn_nodes').where({ id: nodeId }).first()
      expect(after.custom_push_directives).toBe(before.custom_push_directives)
    })

    it('does not enqueue a task for a rejected config', async () => {
      const countBefore = await app.db('tasks')
        .where({ node_id: nodeId, action: 'update_server_config' })
        .count({ n: '*' })
        .first()

      const res = await putConfig({ cipher: 'AES-256-GCM; rm -rf /' })
      expect(res.statusCode).toBe(400)

      const countAfter = await app.db('tasks')
        .where({ node_id: nodeId, action: 'update_server_config' })
        .count({ n: '*' })
        .first()
      expect(Number(countAfter?.n)).toBe(Number(countBefore?.n))
    })
  })
})
