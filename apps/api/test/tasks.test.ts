import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { loginAsAdmin, loginAsUser } from './helpers'

describe('Tasks API', () => {
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

  it('should list tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  describe('POST /tasks action whitelist + payload validation', () => {
    let nodeId: string

    beforeAll(async () => {
      nodeId = uuidv7()
      await app.db('vpn_nodes').insert({
        id: nodeId,
        hostname: 'task-validation-node',
        ip_address: '203.0.113.10',
        port: 1194,
        token: 'task-validation-node-token',
        status: 'online',
        vpn_type: 'openvpn',
      })
    })

    const post = (body: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { Cookie: adminCookie },
        payload: body as Record<string, unknown>,
      })

    it('accepts a valid task and persists the normalised payload', async () => {
      const res = await post({
        node_id: nodeId,
        action: 'write_client_ccd',
        payload: {
          username: 'bob',
          vpn_ip: '10.8.0.5',
          netmask: '255.255.255.0',
          extra_lines: ['push "route 172.31.0.0 255.255.0.0"'],
        },
      })

      expect(res.statusCode).toBe(201)
      const row = await app.db('tasks').where({ id: res.json().id }).first()
      expect(row.action).toBe('write_client_ccd')
      expect(JSON.parse(row.payload).username).toBe('bob')
    })

    it('rejects an unknown action', async () => {
      const res = await post({ node_id: nodeId, action: 'rm_rf_everything', payload: {} })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a misspelled action that no handler implements', async () => {
      // The old `revoke_user` vs `revoke_vpn_user` skew failed silently before.
      const res = await post({
        node_id: nodeId,
        action: 'revoke_user',
        payload: { username: 'bob' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects shell metacharacters in username', async () => {
      const res = await post({
        node_id: nodeId,
        action: 'create_vpn_user',
        payload: { username: 'bob; touch /tmp/pwn' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects path traversal in username', async () => {
      const res = await post({
        node_id: nodeId,
        action: 'delete_client_ccd',
        payload: { username: '../../etc/openvpn/server/crl' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects arbitrary OpenVPN directives in CCD extra_lines', async () => {
      const res = await post({
        node_id: nodeId,
        action: 'write_client_ccd',
        payload: {
          username: 'bob',
          vpn_ip: '10.8.0.5',
          extra_lines: ['up /tmp/evil.sh'],
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a script-executing custom_push_directive', async () => {
      const res = await post({
        node_id: nodeId,
        action: 'update_server_config',
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
          custom_push_directives: 'up /tmp/evil.sh',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a non-IP firewall operand', async () => {
      const res = await post({
        node_id: nodeId,
        action: 'add_firewall_rule',
        payload: { sourceIp: '$(id)', destNetwork: '10.0.0.0/8' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('still requires the node to exist', async () => {
      const res = await post({
        node_id: uuidv7(),
        action: 'reload_openvpn',
        payload: {},
      })
      expect(res.statusCode).toBe(404)
    })

    it('rejects non-admin callers', async () => {
      const userCookie = await loginAsUser(app)
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { Cookie: userCookie },
        payload: { node_id: nodeId, action: 'reload_openvpn', payload: {} },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('payload secret handling', () => {
    const SECRET = 'sup3r-secret-passphrase'
    let secretNodeId: string
    let secretNodeToken: string

    beforeAll(async () => {
      secretNodeId = uuidv7()
      secretNodeToken = 'secret-handling-node-token'
      await app.db('vpn_nodes').insert({
        id: secretNodeId,
        hostname: 'secret-handling-node',
        ip_address: '203.0.113.20',
        port: 1194,
        token: secretNodeToken,
        status: 'online',
        vpn_type: 'openvpn',
      })
    })

    /** Insert a cert task directly, mirroring what users.routes.ts enqueues. */
    const insertCertTask = async () => {
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id: secretNodeId,
        action: 'generate_client_cert',
        payload: JSON.stringify({ username: 'bob', password: SECRET, validDays: 3650 }),
        status: 'pending',
        created_at: new Date(),
      })
      return taskId
    }

    it('masks the passphrase in GET /tasks', async () => {
      await insertCertTask()

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
        headers: { Cookie: adminCookie },
      })
      expect(res.statusCode).toBe(200)

      // The endpoint selects t.*, which used to hand the raw passphrase to any
      // admin. It must never appear anywhere in the response.
      expect(res.body).not.toContain(SECRET)

      const row = res.json().find((t: { action: string }) => t.action === 'generate_client_cert')
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
      expect(payload.password).toBe('[REDACTED]')
      // Non-sensitive fields must survive redaction.
      expect(payload.username).toBe('bob')
      expect(payload.validDays).toBe(3650)
    })

    it('still delivers the real passphrase to the agent that claims the task', async () => {
      await insertCertTask()

      // Redaction must apply to the admin-facing list only — the agent needs
      // the actual value to pass to EasyRSA.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/nodes/${secretNodeId}/tasks`,
        headers: { Authorization: `Bearer ${secretNodeToken}` },
      })
      expect(res.statusCode).toBe(200)

      const claimed = res.json().tasks.find((t: { action: string }) => t.action === 'generate_client_cert')
      expect(claimed).toBeDefined()
      expect(claimed.payload.password).toBe(SECRET)
    })

    it('strips the passphrase from storage once the agent reports a result', async () => {
      const taskId = await insertCertTask()

      const before = await app.db('tasks').where({ id: taskId }).first()
      expect(JSON.parse(before.payload).password).toBe(SECRET)

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/result`,
        headers: { Authorization: `Bearer ${secretNodeToken}` },
        payload: { status: 'success', result: { clientCert: 'CERT', clientKey: 'KEY' } },
      })
      expect(res.statusCode).toBe(200)

      // Consumed, so it must be gone from the row entirely — not masked.
      const after = await app.db('tasks').where({ id: taskId }).first()
      const payload = JSON.parse(after.payload)
      expect(payload.password).toBeUndefined()
      expect(after.payload).not.toContain(SECRET)
      // The rest of the payload is preserved for auditing.
      expect(payload.username).toBe('bob')
      expect(after.status).toBe('done')
    })

    it('strips the passphrase even when the task failed', async () => {
      const taskId = await insertCertTask()

      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/result`,
        headers: { Authorization: `Bearer ${secretNodeToken}` },
        payload: { status: 'failed', errorMessage: 'EasyRSA exploded' },
      })

      const after = await app.db('tasks').where({ id: taskId }).first()
      expect(after.payload).not.toContain(SECRET)
      expect(after.status).toBe('failed')
    })

    it('leaves payloads without secrets untouched', async () => {
      const taskId = uuidv7()
      const original = JSON.stringify({ username: 'bob', vpn_ip: '10.8.0.5' })
      await app.db('tasks').insert({
        id: taskId,
        node_id: secretNodeId,
        action: 'write_client_ccd',
        payload: original,
        status: 'pending',
        created_at: new Date(),
      })

      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/result`,
        headers: { Authorization: `Bearer ${secretNodeToken}` },
        payload: { status: 'success', result: {} },
      })

      const after = await app.db('tasks').where({ id: taskId }).first()
      expect(JSON.parse(after.payload)).toEqual({ username: 'bob', vpn_ip: '10.8.0.5' })
    })
  })
})
