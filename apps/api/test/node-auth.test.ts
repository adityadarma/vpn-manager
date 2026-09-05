import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'

/**
 * Node-token authentication is a single shared decorator
 * (plugins/node-auth.ts). It used to be copy-pasted in four places, two of
 * which forgot to `.trim()` the token — so an agent whose token picked up a
 * trailing newline from an env file would be rejected by /nodes/sync-certs and
 * /nodes/sync-config while working fine elsewhere.
 *
 * These tests assert every agent endpoint now behaves identically.
 */
describe('Node token authentication (shared decorator)', () => {
  let app: FastifyInstance
  let nodeId: string
  const TOKEN = 'shared-node-auth-token'

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

    nodeId = uuidv7()
    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'shared-auth-node',
      ip_address: '203.0.113.50',
      port: 1194,
      token: TOKEN,
      status: 'online',
      vpn_type: 'openvpn',
    })
  })

  afterAll(async () => {
    await app.close()
  })

  /** Every endpoint that authenticates via a node token. */
  const endpoints: Array<{ name: string; call: (auth?: string) => Promise<{ statusCode: number }> }> = [
    {
      name: 'GET /nodes/me',
      call: (auth) =>
        app.inject({
          method: 'GET',
          url: '/api/v1/nodes/me',
          ...(auth ? { headers: { Authorization: auth } } : {}),
        }),
    },
    {
      name: 'POST /nodes/heartbeat',
      call: (auth) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/nodes/heartbeat',
          ...(auth ? { headers: { Authorization: auth } } : {}),
          payload: { nodeId },
        }),
    },
    {
      name: 'GET /nodes/:id/tasks',
      call: (auth) =>
        app.inject({
          method: 'GET',
          url: `/api/v1/nodes/${nodeId}/tasks`,
          ...(auth ? { headers: { Authorization: auth } } : {}),
        }),
    },
    {
      // Previously missing .trim()
      name: 'POST /nodes/sync-certs',
      call: (auth) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/nodes/sync-certs',
          ...(auth ? { headers: { Authorization: auth } } : {}),
          payload: { ca_cert: 'CA', ta_key: 'TA' },
        }),
    },
    {
      // Previously missing .trim()
      name: 'POST /nodes/sync-config',
      call: (auth) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/nodes/sync-config',
          ...(auth ? { headers: { Authorization: auth } } : {}),
          payload: {
            port: 1194,
            protocol: 'udp',
            cipher: 'AES-256-GCM',
            auth: 'SHA256',
            vpnNetwork: '10.8.0.0',
            vpnNetmask: '255.255.255.0',
            dnsServers: '8.8.8.8',
            pushRoutes: '',
            compression: 'none',
            keepalivePing: 10,
            keepaliveTimeout: 120,
            maxClients: 100,
            tunnelMode: 'full',
          },
        }),
    },
    {
      name: 'POST /tasks/:id/result',
      call: async (auth) => {
        const taskId = uuidv7()
        await app.db('tasks').insert({
          id: taskId,
          node_id: nodeId,
          action: 'reload_openvpn',
          payload: JSON.stringify({}),
          status: 'running',
          created_at: new Date(),
        })
        return app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskId}/result`,
          ...(auth ? { headers: { Authorization: auth } } : {}),
          payload: { status: 'success', result: {} },
        })
      },
    },
  ]

  for (const { name, call } of endpoints) {
    describe(name, () => {
      it('rejects a missing Authorization header with 401', async () => {
        expect((await call()).statusCode).toBe(401)
      })

      it('rejects a non-Bearer scheme with 401', async () => {
        expect((await call(`Basic ${TOKEN}`)).statusCode).toBe(401)
      })

      it('rejects an empty bearer token with 401', async () => {
        expect((await call('Bearer    ')).statusCode).toBe(401)
      })

      it('rejects an unknown token with 401', async () => {
        expect((await call('Bearer not-a-real-token')).statusCode).toBe(401)
      })

      it('accepts a valid token', async () => {
        expect((await call(`Bearer ${TOKEN}`)).statusCode).not.toBe(401)
      })

      it('accepts a token with a trailing newline', async () => {
        // The regression the consolidation fixes: agents read this from an env
        // file, so a stray newline is easy to introduce.
        expect((await call(`Bearer ${TOKEN}\n`)).statusCode).not.toBe(401)
      })

      it('accepts a token with surrounding whitespace', async () => {
        expect((await call(`Bearer   ${TOKEN}  `)).statusCode).not.toBe(401)
      })
    })
  }
})
