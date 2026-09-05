import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'
import { EventEmitter } from 'node:events'
import { executeTask } from '../../../apps/agent/src/core/executor'
import type {
  VpnDriver,
  VpnClient,
  VpnServerInfo,
  VpnStatus,
  VpnMetrics,
  KickSessionOptions,
} from '../../../apps/agent/src/drivers/vpn-driver.interface'
import type { AgentEnv } from '../../../apps/agent/src/config/env'

describe('End-to-End Orchestration: Manager Node/User/Group/Network -> Agent Execution', () => {
  let app: FastifyInstance
  let adminCookie: string
  let nodeId: string
  let nodeToken: string
  let mockDriverCalls: Array<{ method: string; args: any }> = []

  // Drivers are EventEmitters in production, so the spy preserves that contract.
  const spyDriver: VpnDriver = Object.assign(new EventEmitter(), {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    getServerInfo: async (): Promise<VpnServerInfo> => ({ version: '2.6.0', uptime: 100, mode: 'server' }),
    getClients: async (): Promise<VpnClient[]> => [],
    disconnectClient: async () => {},
    getStatus: async (): Promise<VpnStatus> => ({
      state: 'connected',
      clients: [],
      serverInfo: { version: '2.6.0', uptime: 100, mode: 'server' },
    }),
    getMetrics: async (): Promise<VpnMetrics> => ({
      totalClients: 0,
      totalBytesReceived: 0,
      totalBytesSent: 0,
      uptime: 100,
    }),
    sendCommand: async () => 'OK',
    createUser: async (username: string) => {
      mockDriverCalls.push({ method: 'createUser', args: { username } })
      return { username, stdout: 'Certificate generated' }
    },
    revokeUser: async (username: string) => {
      mockDriverCalls.push({ method: 'revokeUser', args: { username } })
      return { username, stdout: 'Revoked' }
    },
    generateClientCert: async (username: string) => {
      mockDriverCalls.push({ method: 'generateClientCert', args: { username } })
      return { clientCert: 'CERT_DATA', clientKey: 'KEY_DATA', passwordProtected: false, expiresAt: null }
    },
    generateClientConfig: async () => 'client-config',
    kickSession: async (commonName: string, options: KickSessionOptions = {}) => {
      mockDriverCalls.push({ method: 'kickSession', args: { commonName } })
      return {
        kicked: true,
        common_name: commonName,
        permanent: options.permanent ?? false,
        kill_method: 'driver',
        kill_response: 'OK',
      }
    },
    unkickSession: async (commonName: string) => {
      mockDriverCalls.push({ method: 'unkickSession', args: { commonName } })
      return { unkicked: true, common_name: commonName }
    },
    writeClientConfig: async (username: string, vpnIp: string, opts?: any) => {
      mockDriverCalls.push({ method: 'writeClientConfig', args: { username, vpnIp, opts } })
      return { success: true, username, vpnIp }
    },
    deleteClientConfig: async (username: string) => {
      mockDriverCalls.push({ method: 'deleteClientConfig', args: { username } })
      return { success: true, username }
    },
    reload: async () => {},
    syncCertificates: async () => ({ success: true }),
    syncServerConfig: async () => ({ success: true }),
    updateServerConfig: async (params: any) => {
      mockDriverCalls.push({ method: 'updateServerConfig', args: params })
      return { success: true }
    },
  })

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

  it('step 1: registers a new VPN node in Manager', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      headers: { Cookie: adminCookie },
      payload: {
        hostname: 'node-sg-01',
        ip: '203.0.113.50',
        port: 1194,
        region: 'ap-southeast',
        version: '1.1.0',
        vpn_type: 'openvpn',
      },
    })

    expect(res.statusCode).toBe(201)
    const data = res.json()
    expect(data.id).toBeDefined()
    expect(data.token).toBeDefined()

    nodeId = data.id
    nodeToken = data.token

    // Set node to online
    await app.db('vpn_nodes').where({ id: nodeId }).update({ status: 'online' })
  })

  it('step 2: creates a Group and a Network route in Manager', async () => {
    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: { Cookie: adminCookie },
      payload: {
        name: 'DevOps',
        description: 'Operations Team',
        vpn_subnet: '10.8.20.0/24',
      },
    })
    expect(groupRes.statusCode).toBe(201)
    const group = groupRes.json()

    const netRes = await app.inject({
      method: 'POST',
      url: '/api/v1/networks',
      headers: { Cookie: adminCookie },
      payload: {
        name: 'Internal VPC',
        cidr: '172.20.0.0/16',
      },
    })
    expect(netRes.statusCode).toBe(201)
    const network = netRes.json()

    // Associate network with group
    await app.db('group_networks').insert({
      group_id: group.id,
      network_id: network.id,
    })
  })

  it('step 3: creates a VPN user and enqueues task for the agent node', async () => {
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { Cookie: adminCookie },
      payload: {
        username: 'charlie_ops',
        email: 'charlie@example.com',
        role: 'user',
      },
    })
    expect(userRes.statusCode).toBe(201)

    // Enqueue write_client_ccd and create_vpn_user tasks
    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { Cookie: adminCookie },
      payload: {
        node_id: nodeId,
        action: 'write_client_ccd',
        payload: {
          username: 'charlie_ops',
          vpn_ip: '10.8.20.5',
          netmask: '255.255.255.0',
          extra_lines: ['push "route 172.20.0.0 255.255.0.0"'],
        },
      },
    })
    expect(taskRes.statusCode).toBe(201)
  })

  it('step 4: agent polls pending tasks from Manager, executes via driver, and reports success', async () => {
    // 1. Agent polls tasks
    const pollRes = await app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/tasks`,
      headers: { Authorization: `Bearer ${nodeToken}` },
    })

    expect(pollRes.statusCode).toBe(200)
    const { tasks } = pollRes.json()
    expect(tasks.length).toBeGreaterThan(0)

    const ccdTask = tasks.find((t: any) => t.action === 'write_client_ccd')
    expect(ccdTask).toBeDefined()

    // 2. Mock Agent execution cycle
    // We mock fetch inside executeTask to route to app.inject
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url
      const path = url.replace(/https?:\/\/[^/]+/, '')
      const method = init?.method || 'GET'
      const headers = init?.headers || {}
      const payload = init?.body ? JSON.parse(init.body) : undefined

      const res = await app.inject({
        method: method as any,
        url: path,
        headers,
        payload,
      })

      return {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => res.payload,
        json: async () => res.json(),
      } as any
    }

    try {
      const agentEnv: AgentEnv = {
        NODE_ENV: 'test',
        AGENT_PORT: 3_002,
        AGENT_NODE_ID: nodeId,
        AGENT_SECRET_TOKEN: nodeToken,
        AGENT_MANAGER_URL: 'http://localhost:3000',
        AGENT_POLL_INTERVAL_MS: 5_000,
        AGENT_HEARTBEAT_INTERVAL_MS: 30_000,
        VPN_TOKEN: 'test-vpn-token',
        VPN_TYPE: 'openvpn',
        FIREWALL_ENGINE: 'iptables',
      }

      await executeTask(agentEnv, ccdTask, spyDriver)

      // Verify driver was called with the right data from Manager
      const called = mockDriverCalls.find((c) => c.method === 'writeClientConfig')
      expect(called).toBeDefined()
      expect(called?.args.username).toBe('charlie_ops')
      expect(called?.args.vpnIp).toBe('10.8.20.5')
      expect(called?.args.opts.extraLines).toContain('push "route 172.20.0.0 255.255.0.0"')

      // Verify task status in DB is now done
      const dbTask = await app.db('tasks').where({ id: ccdTask.id }).first()
      expect(dbTask.status).toBe('done')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
