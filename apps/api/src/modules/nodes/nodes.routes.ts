import { v7 as uuidv7 } from 'uuid'
import type { FastifyPluginAsync } from 'fastify'
import crypto from 'node:crypto'
import {
  HeartbeatSchema,
  TrafficTelemetrySchema,
  TunnelModeSchema,
  validateTaskPayload,
} from '@vpn/shared'
import { logAudit, getClientIp } from '../../utils/audit'
import { secretsMatchTrimmed } from '../../utils/secret-compare'
import { enqueueApplyPolicies } from '../policies/policies.routes'
import { enqueueNodeDnsSync } from '../../services/managed-dns'
import { cidrsToPushRoutes } from '../../services/ip-pool'
import { claimPendingTasks, waitForPendingTasks } from '../../services/task-polling'

interface NodeConfig {
  port: number
  protocol: string
  tunnel_mode: string
  vpn_network: string
  vpn_netmask: string
  dns_servers: string
  push_routes: string
  wireguard_allowed_ips?: string
  cipher: string
  auth_digest: string
  compression: string
  keepalive_ping: number
  keepalive_timeout: number
  max_clients: number
  custom_push_directives?: string
  network_push_directives?: string
  managed_dns_directives?: string
  firewall_engine: string
  allow_client_to_client: boolean
}

// Node-token authentication lives in plugins/node-auth.ts as
// app.authenticateNodeToken — a single implementation shared by every agent
// endpoint here and in tasks.routes.ts.

const nodeRoutes: FastifyPluginAsync = async (app) => {
  async function decommissionNode(
    node: Record<string, any>,
    options: { userId?: string; username: string; reason: string; ipAddress?: string },
  ) {
    if (node.decommissioned_at) return

    const now = new Date()
    await app.db.transaction(async (trx) => {
      await trx('user_node_certificates')
        .where({ node_id: node.id })
        .where((query) => query.whereNull('is_revoked').orWhere('is_revoked', false))
        .update({
          is_revoked: true,
          revoked_at: now,
          revoked_by: options.userId ?? null,
          revoke_reason: 'node_decommissioned',
        })

      const certificates = await trx('user_node_certificates')
        .where({ node_id: node.id })
        .whereNotNull('client_cert')
        .select('id', 'user_id', 'client_cert')
      for (const certificate of certificates) {
        const existing = await trx('cert_revocations')
          .where({ node_id: node.id, revoked_cert: certificate.client_cert })
          .first()
        if (!existing) {
          await trx('cert_revocations').insert({
            id: uuidv7(),
            user_id: certificate.user_id,
            node_id: node.id,
            revoked_cert: certificate.client_cert,
            reason: 'node_decommissioned',
            revoked_by: options.userId ?? null,
            revoked_at: now,
          })
        }
      }

      await trx('vpn_sessions').where({ node_id: node.id }).whereNull('disconnected_at').update({
        disconnected_at: now,
        disconnect_reason: 'node_decommissioned',
      })
      await trx('tasks')
        .where({ node_id: node.id })
        .whereIn('status', ['pending', 'running'])
        .update({
          status: 'failed',
          error_message: 'Cancelled because node was decommissioned',
          completed_at: now,
        })
      await trx('vpn_nodes')
        .where({ id: node.id })
        .update({
          status: 'offline',
          decommissioned_at: now,
          decommissioned_by: options.userId ?? null,
          decommission_reason: options.reason,
          token_revoked_at: now,
          // Replace the original agent token and remove private key material.
          token: crypto.randomBytes(32).toString('hex'),
          ca_cert: null,
          ta_key: null,
          private_key: null,
        })
    })

    await logAudit(app, {
      userId: options.userId,
      username: options.username,
      action: 'node_decommissioned',
      resourceType: 'node',
      resourceId: node.id,
      ipAddress: options.ipAddress,
      metadata: { reason: options.reason },
    })
  }

  // GET /api/v1/nodes
  app.get(
    '/nodes',
    {
      onRequest: [app.authenticateAdmin],
      schema: { tags: ['nodes'], summary: 'List all VPN nodes', security: [{ bearerAuth: [] }] },
    },
    async () => {
      // Get all nodes
      const nodes = await app
        .db('vpn_nodes')
        .select(
          'id',
          'hostname',
          'ip_address',
          'port',
          'region',
          'status',
          'version',
          'last_seen',
          'created_at',
          'vpn_type',
          'public_key',
          'endpoint_port',
          'firewall_rules_dump',
          'managed_dns_enabled',
          'managed_dns_capable',
          'dns_config_revision',
          'dns_sync_status',
          'dns_last_sync_error',
          'dns_last_synced_at',
          'dns_config_hash',
          'decommissioned_at',
          'decommission_reason',
          'token_revoked_at',
        )

      // Get active sessions count for each node
      const sessionCounts = await app
        .db('vpn_sessions')
        .select('node_id')
        .count('* as count')
        .whereNull('disconnected_at')
        .groupBy('node_id')

      // Create a map of node_id -> active_sessions count
      const sessionCountMap = new Map<string, number>()
      for (const row of sessionCounts as any[]) {
        sessionCountMap.set(String(row.node_id), Number(row.count))
      }

      // Add active_sessions to each node
      return nodes.map((node) => ({
        ...node,
        status: node.decommissioned_at ? 'decommissioned' : node.status,
        dns_last_sync_error:
          node.dns_last_sync_error === 'MANUAL_OVERRIDE_DISABLED' ? null : node.dns_last_sync_error,
        active_sessions: sessionCountMap.get(node.id) || 0,
      }))
    },
  )

  // GET /api/v1/nodes/me (for agent self-check with node token)
  app.get(
    '/nodes/me',
    {
      schema: {
        tags: ['nodes'],
        summary: 'Get current node info (agent auth)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.authenticateNodeToken(request, reply)
      if (!node) return

      // Return node info without sensitive token or key material
      const { token: _token, private_key: _pk, ca_cert: _ca, ta_key: _ta, ...safeNode } = node
      return safeNode
    },
  )

  // POST /api/v1/nodes/me/decommission (called by node uninstall script)
  app.post(
    '/nodes/me/decommission',
    {
      schema: {
        tags: ['nodes'],
        summary: 'Decommission current node (agent auth)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.authenticateNodeToken(request, reply)
      if (!node) return

      await decommissionNode(node, {
        username: `node:${node.hostname}`,
        reason: 'agent_uninstall',
        ipAddress: getClientIp(request),
      })
      app.log.info(`[node-self-decommission] Node ${node.id} decommissioned via node token`)
      return reply.status(204).send()
    },
  )

  // Kept for uninstaller versions released before the decommission endpoint.
  app.delete(
    '/nodes/me',
    {
      schema: {
        tags: ['nodes'],
        summary: 'Decommission current node (legacy agent auth)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.authenticateNodeToken(request, reply)
      if (!node) return
      await decommissionNode(node, {
        username: `node:${node.hostname}`,
        reason: 'agent_uninstall',
        ipAddress: getClientIp(request),
      })
      return reply.status(204).send()
    },
  )

  // GET /api/v1/nodes/:id
  app.get<{ Params: { id: string }; Querystring: { wait?: string } }>(
    '/nodes/:id',
    {
      onRequest: [app.authenticateAdmin],
      schema: { tags: ['nodes'], summary: 'Get node by ID', security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      // Strip all sensitive material — never expose key material via this route.
      const { token: _token, private_key: _pk, ca_cert: _ca, ta_key: _ta, ...safeNode } = node
      return safeNode
    },
  )

  app.post<{ Params: { id: string } }>(
    '/nodes/:id/dns/sync',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Queue a Managed DNS sync for a node',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Node not found' })
      if (!node.managed_dns_enabled)
        return reply.status(409).send({ error: 'Managed DNS is disabled for this node' })
      const taskId = await enqueueNodeDnsSync(app, node.id)
      if (!taskId) return reply.status(409).send({ error: 'Managed DNS sync could not be queued' })
      return reply.status(202).send({ task_id: taskId })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/nodes/:id/dns/status',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Get Managed DNS status for a node',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Node not found' })
      const listeners = await app
        .db('group_node_dns_settings as s')
        .join('groups as g', 's.group_id', 'g.id')
        .where({ 's.node_id': node.id, 's.enabled': true })
        .select(
          's.group_id',
          'g.name as group_name',
          's.vpn_subnet',
          's.listener_ip',
          's.listener_port',
        )
        .orderBy('g.name')
      const revisions = await app
        .db('node_dns_revisions')
        .where({ node_id: node.id })
        .orderBy('revision', 'desc')
        .limit(10)
      return {
        enabled: Boolean(node.managed_dns_enabled),
        capable: Boolean(node.managed_dns_capable),
        status: node.dns_sync_status,
        revision: node.dns_config_revision,
        config_hash: node.dns_config_hash,
        last_error:
          node.dns_last_sync_error === 'MANUAL_OVERRIDE_DISABLED' ? null : node.dns_last_sync_error,
        last_synced_at: node.dns_last_synced_at,
        listeners,
        revisions,
      }
    },
  )

  // PUT /api/v1/nodes/:id
  app.put<{
    Params: { id: string }
    Body: { hostname?: string; ip_address?: string; region?: string; managed_dns_enabled?: boolean }
  }>(
    '/nodes/:id',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Update node basic information',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            hostname: { type: 'string', description: 'Node hostname' },
            ip_address: { type: 'string', description: 'Node IP address' },
            region: { type: 'string', description: 'Node region/location' },
            managed_dns_enabled: {
              type: 'boolean',
              description: 'Enable optional Managed DNS on this node',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) {
        return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      }

      const updates: any = {}

      if (request.body.hostname !== undefined) {
        // Check if hostname already exists (excluding current node)
        const existing = await app
          .db('vpn_nodes')
          .where({ hostname: request.body.hostname })
          .whereNot({ id: request.params.id })
          .first()

        if (existing) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Hostname already exists',
          })
        }
        updates.hostname = request.body.hostname
      }

      if (request.body.ip_address !== undefined) {
        // Check if IP already exists (excluding current node)
        const existing = await app
          .db('vpn_nodes')
          .where({ ip_address: request.body.ip_address })
          .whereNot({ id: request.params.id })
          .first()

        if (existing) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'IP address already exists',
          })
        }
        updates.ip_address = request.body.ip_address
      }

      if (request.body.region !== undefined) {
        updates.region = request.body.region || null
      }

      if (request.body.managed_dns_enabled !== undefined) {
        updates.managed_dns_enabled = request.body.managed_dns_enabled
        if (!request.body.managed_dns_enabled) {
          updates.managed_dns_capable = false
          updates.dns_sync_status = 'disabled'
          updates.dns_last_sync_error = 'MANUAL_OVERRIDE_DISABLED'
        } else {
          updates.dns_last_sync_error = null
        }
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No valid fields to update',
        })
      }

      await app.db('vpn_nodes').where({ id: request.params.id }).update(updates)

      // OpenVPN pushes node DNS globally from server.conf. Refresh it when
      // Managed DNS changes so public resolvers cannot bypass group listeners.
      if (request.body.managed_dns_enabled !== undefined) {
        const groupSubnets = (await app
          .db('group_node_dns_settings')
          .where({ node_id: request.params.id })
          .whereNotNull('vpn_subnet')
          .pluck('vpn_subnet')) as string[]
        const current = await app.db('vpn_nodes').where({ id: request.params.id }).first()
        await app.db('tasks').insert({
          id: uuidv7(),
          node_id: current.id,
          action: 'update_server_config',
          payload: JSON.stringify({
            port: current.port,
            protocol: current.protocol,
            tunnel_mode: current.tunnel_mode,
            vpn_network: current.vpn_network,
            vpn_netmask: current.vpn_netmask,
            dns_servers: current.dns_servers,
            push_routes: current.push_routes,
            compression: current.compression,
            cipher: current.cipher,
            keepalive_ping: current.keepalive_ping,
            keepalive_timeout: current.keepalive_timeout,
            custom_push_directives: current.custom_push_directives,
            group_subnets: groupSubnets,
            managed_dns_enabled: Boolean(current.managed_dns_enabled),
            allow_client_to_client: Boolean(current.allow_client_to_client),
          }),
          status: 'pending',
          created_at: new Date(),
        })
      }

      const updated = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      const { token: _token, private_key: _pk, ca_cert: _ca, ta_key: _ta, ...safeNode } = updated

      const userObj = request.user as { id: string; name: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.name,
        action: 'node_update',
        resourceType: 'node',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
        metadata: { updated_fields: Object.keys(updates) },
      })

      return safeNode
    },
  )

  // GET /api/v1/nodes/:id/config
  app.get<{ Params: { id: string } }>(
    '/nodes/:id/config',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Get node configuration',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const config = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!config) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })

      const networkCidrs = (await app
        .db('node_networks as nn')
        .join('networks as n', 'nn.network_id', 'n.id')
        .where('nn.node_id', config.id)
        .orderBy('n.name')
        .pluck('n.cidr')) as string[]

      const managedDnsListeners =
        config.managed_dns_enabled && config.dns_sync_status === 'healthy'
          ? ((await app
              .db('group_node_dns_settings as s')
              .join('groups as g', 's.group_id', 'g.id')
              .where({ 's.node_id': config.id, 's.enabled': true })
              .whereNotNull('s.listener_ip')
              .select('g.name as group_name', 's.listener_ip')
              .orderBy('g.name')) as Array<{ group_name: string; listener_ip: string }>)
          : []

      return {
        port: config.port,
        protocol: config.protocol,
        tunnel_mode: config.tunnel_mode,
        vpn_network: config.vpn_network,
        vpn_netmask: config.vpn_netmask,
        dns_servers: config.dns_servers,
        push_routes: config.push_routes,
        wireguard_allowed_ips: config.wireguard_allowed_ips ?? '',
        cipher: config.cipher,
        auth_digest: config.auth_digest,
        compression: config.compression,
        keepalive_ping: config.keepalive_ping,
        keepalive_timeout: config.keepalive_timeout,
        max_clients: config.max_clients,
        custom_push_directives: config.custom_push_directives ?? '',
        // Network routes are managed from the Networks page, not persisted as
        // custom directives, so unassigning a network removes them immediately.
        //
        // Shown in `push "route ..."` form because that is what actually happens:
        // the route is advertised to clients through their CCD and profile. The
        // node reaches these networks through its own NIC, so a bare server-side
        // `route` directive is never written into its server.conf.
        network_push_directives: cidrsToPushRoutes(networkCidrs).join('\n'),
        // Managed DNS is selected per client group during profile generation;
        // never push a group's resolver globally from server.conf.
        managed_dns_directives: managedDnsListeners
          .map(({ group_name, listener_ip }) => `${group_name}: dhcp-option DNS ${listener_ip}`)
          .join('\n'),
        firewall_engine: config.firewall_engine ?? 'iptables',
        allow_client_to_client: Boolean(config.allow_client_to_client),
      }
    },
  )

  // PUT /api/v1/nodes/:id/config
  app.put<{ Params: { id: string }; Body: NodeConfig }>(
    '/nodes/:id/config',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Update node configuration',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })

      // Collect group subnets allocated for this node
      const groupSubnets = (await app
        .db('group_node_dns_settings')
        .where({ node_id: node.id })
        .whereNotNull('vpn_subnet')
        .pluck('vpn_subnet')) as string[]

      // Only VPN address pools belong here. Target network CIDRs are reached
      // through the node's own NIC and are advertised to clients instead (the
      // `route` lines in the .ovpn profile and the CCD `push "route ..."`
      // lines). Writing them into server.conf would install a tunnel route on
      // the node itself and cut it off from that network.
      const managedSubnets = [...new Set(groupSubnets)]

      // This body is written straight into the node's server.conf by the agent,
      // on a server running with `script-security 2`, so directives like `up`
      // or `plugin` would execute commands. Validate with the same schema
      // POST /tasks uses — before touching the database, so an invalid config
      // is never persisted even though the task would have been rejected.
      const validation = validateTaskPayload('update_server_config', {
        ...request.body,
        group_subnets: managedSubnets,
        managed_dns_enabled: Boolean(node.managed_dns_enabled),
      })
      if (!validation.ok) {
        app.log.warn(
          `[api/nodes] Rejected config update for node ${request.params.id} by user ${(request.user as { id?: string })?.id}: ${validation.error}`,
        )
        return reply.status(400).send({ error: 'Bad Request', message: validation.error })
      }

      const config = validation.payload as unknown as NodeConfig

      if (!config.allow_client_to_client && config.firewall_engine === 'none') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'A firewall engine is required when client-to-client traffic is disabled',
        })
      }

      // Check if vpn_network actually changed
      const networkChanged =
        node.vpn_network !== config.vpn_network || node.vpn_netmask !== config.vpn_netmask

      // Update database
      await app
        .db('vpn_nodes')
        .where({ id: request.params.id })
        .update({
          port: config.port,
          protocol: config.protocol,
          tunnel_mode: config.tunnel_mode,
          vpn_network: config.vpn_network,
          vpn_netmask: config.vpn_netmask,
          dns_servers: config.dns_servers,
          push_routes: config.push_routes,
          wireguard_allowed_ips: config.wireguard_allowed_ips ?? null,
          cipher: config.cipher,
          auth_digest: config.auth_digest,
          compression: config.compression,
          keepalive_ping: config.keepalive_ping,
          keepalive_timeout: config.keepalive_timeout,
          max_clients: config.max_clients,
          custom_push_directives: config.custom_push_directives ?? null,
          firewall_engine: config.firewall_engine,
          allow_client_to_client: config.allow_client_to_client,
        })

      // IMPORTANT: Schedule update_server_config FIRST so that OpenVPN reloads
      // with the new network + crl-verify BEFORE revoke tasks kick clients.
      // When kicked clients auto-reconnect, the CRL will already be loaded.
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id: request.params.id,
        action: 'update_server_config',
        payload: JSON.stringify(validation.payload),
        status: 'pending',
        created_at: new Date(),
      })

      // If network changed, schedule revoke tasks AFTER the config update task
      if (networkChanged) {
        const certs = await app
          .db('user_node_certificates')
          .where({ node_id: request.params.id, is_revoked: 0 })

        if (certs.length > 0) {
          app.log.info(
            `[api/nodes] Network changed. Revoking ${certs.length} legacy certificates for node ${request.params.id}`,
          )

          await app.db('user_node_certificates').where({ node_id: request.params.id }).update({
            is_revoked: 1,
            revoked_at: new Date(),
            revoke_reason: 'Network Subnet Changed',
          })

          for (const cert of certs) {
            const userObj = await app.db('users').where({ id: cert.user_id }).first()
            if (!userObj) continue

            await app.db('tasks').insert({
              id: uuidv7(),
              node_id: request.params.id,
              action: 'revoke_vpn_user',
              payload: JSON.stringify({
                username: cert.common_name,
                client_cert: cert.client_cert,
              }),
              status: 'pending',
              created_at: new Date(),
            })

            await app
              .db('vpn_sessions')
              .where({ user_id: userObj.id, node_id: request.params.id })
              .whereNull('disconnected_at')
              .update({
                disconnected_at: new Date(),
                disconnect_reason: 'admin_kick',
              })
          }
        }
      }

      const userObj = request.user as { id: string; name: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.name,
        action: 'node_config_update',
        resourceType: 'node',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })

      return { message: 'Configuration update scheduled', taskId }
    },
  )

  // POST /api/v1/nodes/register  (called by agent or install script)
  // Requires either Admin JWT token OR Registration Key
  app.post<{
    Body: {
      hostname: string
      ip: string
      port?: number
      region?: string
      version?: string
      registrationKey?: string
      vpnType?: 'openvpn' | 'wireguard'
      publicKey?: string
      privateKey?: string
      endpointPort?: number
      managedDnsEnabled?: boolean
      config?: any
    }
  }>(
    '/nodes/register',
    {
      // NODE_REGISTRATION_KEY is a single static shared secret with no TTL or
      // rotation, so this endpoint is the one place an unauthenticated caller
      // can guess a credential. The global limiter (100/min) is far too loose
      // for that. Node registration is a rare, human-driven action, so the
      // tight "sensitive" budget is ample.
      config: { rateLimit: app.rateLimits.sensitive },
      schema: {
        tags: ['nodes'],
        summary: 'Register a new VPN node (requires admin auth or registration key)',
      },
    },
    async (request, reply) => {
      const {
        hostname,
        ip,
        port,
        region,
        version,
        registrationKey,
        vpnType,
        publicKey,
        privateKey,
        endpointPort,
        managedDnsEnabled,
        config,
      } = request.body

      // Check authentication: either JWT token (admin) or registration key
      let isAuthenticated = false

      // Method 1: Check JWT token (admin only) via fastify-jwt (supports both cookie and header)
      // This route can't use the `authenticate` decorator because it also
      // accepts a registration key, so it verifies the JWT itself — which means
      // it must apply the revocation check explicitly. Without it, a logged-out
      // admin token still authorised node registration until its natural expiry.
      try {
        await request.jwtVerify()
        const user = request.user as { role: string }
        if (user?.role === 'admin' && !(await app.isTokenRevokedForRequest(request))) {
          isAuthenticated = true
        }
      } catch (err) {
        // Invalid JWT or missing token, continue to check registration key
      }

      // Method 2: Check registration key from environment
      if (!isAuthenticated) {
        const validRegistrationKey = process.env.NODE_REGISTRATION_KEY

        if (!validRegistrationKey) {
          app.log.warn('[node-register] NODE_REGISTRATION_KEY not set in environment')
          return reply.status(403).send({
            error: 'Forbidden',
            message:
              'Node registration requires admin authentication or registration key. Set NODE_REGISTRATION_KEY in environment variables.',
          })
        }

        if (!registrationKey) {
          app.log.warn('[node-register] No registration key provided in request body')
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Registration key required but not provided',
          })
        }

        // Constant-time comparison. Uses the shared helper, which hashes both
        // sides to a fixed length first — the previous inline version guarded
        // timingSafeEqual with a raw length check, and that guard leaked the
        // expected key length through timing.
        if (!secretsMatchTrimmed(registrationKey, validRegistrationKey)) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Invalid registration key',
          })
        }

        isAuthenticated = true
      }

      if (!isAuthenticated) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required. Provide admin JWT token or valid registration key.',
        })
      }

      // Validate required fields
      if (!hostname || !ip) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'hostname and ip are required',
        })
      }

      if (
        config?.tunnel_mode !== undefined &&
        !TunnelModeSchema.safeParse(config.tunnel_mode).success
      ) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'config.tunnel_mode must be full or split',
        })
      }

      // Check if node already exists
      const existing = await app
        .db('vpn_nodes')
        .where({ hostname })
        .orWhere({ ip_address: ip })
        .first()
      if (existing) {
        if (
          existing.hostname === hostname &&
          existing.ip_address === ip &&
          existing.status === 'offline' &&
          !existing.decommissioned_at
        ) {
          const token = crypto.randomBytes(32).toString('hex')
          await app
            .db('vpn_nodes')
            .where({ id: existing.id })
            .update({
              token,
              token_revoked_at: null,
              last_seen: new Date(),
              version: version ?? existing.version,
              ...(region !== undefined ? { region } : {}),
              ...(vpnType ? { vpn_type: vpnType } : {}),
              ...(publicKey !== undefined ? { public_key: publicKey } : {}),
              ...(privateKey !== undefined ? { private_key: privateKey } : {}),
              ...(endpointPort !== undefined ? { endpoint_port: endpointPort } : {}),
            })
          return reply.status(200).send({
            id: existing.id,
            token,
            message: 'Offline node re-registered successfully',
          })
        }
        return reply.status(409).send({
          error: 'Conflict',
          message: existing.decommissioned_at
            ? 'Node with this hostname or IP is decommissioned; restore it from the dashboard instead'
            : 'Node with this hostname or IP already exists',
        })
      }

      // Generate secure token for agent
      const token = crypto.randomBytes(32).toString('hex')
      const id = uuidv7()

      // Determine dynamic vpn network (10.8.X.0)
      let nextNetwork = '10.8.0.0'
      const existingNodes = await app.db('vpn_nodes').select('vpn_network')
      const usedSubnets = existingNodes
        .map((n: { vpn_network: string | null }) => {
          if (!n.vpn_network) return -1
          const parts = n.vpn_network.split('.')
          if (parts.length === 4 && parts[0] === '10' && parts[1] === '8') {
            return parseInt(parts[2], 10)
          }
          return -1
        })
        .filter((n: number) => !isNaN(n) && n >= 0)

      if (usedSubnets.length > 0) {
        const maxSubnet = Math.max(...usedSubnets)
        // ensure we don't overflow 255
        if (maxSubnet < 254) {
          nextNetwork = `10.8.${maxSubnet + 1}.0`
        }
      }

      // Prepare node data with config if provided
      const nodeData: any = {
        id,
        hostname,
        ip_address: ip,
        port: config?.port || port || (vpnType === 'wireguard' ? 51820 : 1194),
        region: region ?? null,
        token,
        version: version ?? 'auto-registered',
        status: 'offline',
        last_seen: new Date(),
        created_at: new Date(),
        vpn_type: vpnType ?? 'openvpn',
        public_key: publicKey ?? null,
        private_key: privateKey ?? null,
        endpoint_port: endpointPort ?? null,
        managed_dns_enabled: managedDnsEnabled === true,
      }

      if (config) {
        nodeData.protocol = config.protocol || 'udp'
        nodeData.tunnel_mode = config.tunnel_mode || 'split'
        nodeData.vpn_network = config.vpn_network || nextNetwork
        nodeData.vpn_netmask = config.vpn_netmask || '255.255.255.0'
        nodeData.dns_servers = config.dns_servers || '8.8.8.8,1.1.1.1'
        nodeData.push_routes = config.push_routes || ''
        nodeData.cipher = config.cipher || 'AES-256-GCM'
        nodeData.auth_digest = config.auth_digest || 'SHA256'
        nodeData.compression = config.compression || 'lz4-v2'
        nodeData.keepalive_ping = config.keepalive_ping || 10
        nodeData.keepalive_timeout = config.keepalive_timeout || 120
        nodeData.max_clients = config.max_clients || 100
        nodeData.firewall_engine = config.firewall_engine || 'iptables'
      } else {
        // Set defaults if no config provided
        nodeData.protocol = 'udp'
        nodeData.tunnel_mode = 'split'
        nodeData.vpn_network = nextNetwork
        nodeData.vpn_netmask = '255.255.255.0'
        nodeData.dns_servers = '8.8.8.8,1.1.1.1'
        nodeData.push_routes = ''
        nodeData.cipher = 'AES-256-GCM'
        nodeData.auth_digest = 'SHA256'
        nodeData.compression = 'lz4-v2'
        nodeData.keepalive_ping = 10
        nodeData.keepalive_timeout = 60
        nodeData.max_clients = 100
        nodeData.firewall_engine = 'iptables'
      }

      await app.db('vpn_nodes').insert(nodeData)

      return reply.status(201).send({
        id,
        token, // Returned ONCE — agent must store it securely
        message: 'Node registered successfully',
      })
    },
  )

  // POST /api/v1/nodes/heartbeat  (called by agent)
  app.post(
    '/nodes/heartbeat',
    { schema: { tags: ['nodes'], summary: 'Agent heartbeat' } },
    async (request, reply) => {
      const authenticatedNode = await app.authenticateNodeToken(request, reply)
      if (!authenticatedNode) return

      const {
        nodeId,
        agentVersion,
        caCert,
        taKey,
        firewallRules,
        firewallEngine,
        clients,
        startup,
        dns,
      } = HeartbeatSchema.parse(request.body)
      if (authenticatedNode.id !== nodeId) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Token does not match nodeId in heartbeat payload',
        })
      }

      // Get current node status
      const currentNode = await app.db('vpn_nodes').where({ id: nodeId }).first()
      const wasOffline = currentNode?.status === 'offline'
      const activatingManagedDns = Boolean(
        dns?.enabled &&
        dns?.capable &&
        dns?.status === 'healthy' &&
        !currentNode?.managed_dns_enabled,
      )

      const updates: any = { status: 'online', last_seen: new Date() }
      if (agentVersion) updates.version = agentVersion
      if (caCert) updates.ca_cert = caCert
      if (taKey) updates.ta_key = taKey
      if (firewallRules !== undefined) updates.firewall_rules_dump = firewallRules
      if (firewallEngine) updates.firewall_engine = firewallEngine
      updates.managed_dns_capable = Boolean(dns?.capable)

      const isManualOverrideDisabled =
        !currentNode?.managed_dns_enabled &&
        currentNode?.dns_last_sync_error === 'MANUAL_OVERRIDE_DISABLED'

      if (isManualOverrideDisabled) {
        updates.managed_dns_enabled = false
        updates.dns_sync_status = 'disabled'
      } else if (dns?.enabled && dns?.capable && dns?.status === 'healthy') {
        updates.managed_dns_enabled = true
        if (
          currentNode?.dns_sync_status !== 'pending' &&
          currentNode?.dns_sync_status !== 'syncing'
        ) {
          updates.dns_sync_status = 'healthy'
          updates.dns_last_sync_error = null
        }
        if (!currentNode?.managed_dns_enabled) {
          enqueueNodeDnsSync(app, nodeId).catch((err: any) => {
            app.log.warn(
              `[heartbeat] Failed to enqueue initial DNS sync for auto-enabled node ${nodeId}: ${err.message}`,
            )
          })
        }
      } else if (currentNode?.managed_dns_enabled) {
        if (dns) {
          if (
            currentNode?.dns_sync_status !== 'pending' &&
            currentNode?.dns_sync_status !== 'syncing'
          ) {
            updates.dns_sync_status = dns.status
            updates.dns_last_sync_error = dns.lastError ?? null
          }
        } else {
          updates.dns_sync_status = 'degraded'
          updates.dns_last_sync_error = 'Agent did not report Managed DNS status'
        }
      } else {
        updates.dns_sync_status = 'disabled'
        updates.dns_last_sync_error = null
      }
      await app.db('vpn_nodes').where({ id: nodeId }).update(updates)
      app.realtime.publish('node.updated', nodeId)

      if (activatingManagedDns) {
        const groupSubnets = (await app
          .db('group_node_dns_settings')
          .where({ node_id: nodeId })
          .whereNotNull('vpn_subnet')
          .pluck('vpn_subnet')) as string[]
        await app.db('tasks').insert({
          id: uuidv7(),
          node_id: nodeId,
          action: 'update_server_config',
          payload: JSON.stringify({
            port: currentNode.port,
            protocol: currentNode.protocol,
            tunnel_mode: currentNode.tunnel_mode,
            vpn_network: currentNode.vpn_network,
            vpn_netmask: currentNode.vpn_netmask,
            dns_servers: currentNode.dns_servers,
            push_routes: currentNode.push_routes,
            compression: currentNode.compression,
            cipher: currentNode.cipher,
            keepalive_ping: currentNode.keepalive_ping,
            keepalive_timeout: currentNode.keepalive_timeout,
            custom_push_directives: currentNode.custom_push_directives,
            group_subnets: groupSubnets,
            managed_dns_enabled: true,
          }),
          status: 'pending',
          created_at: new Date(),
        })
      }

      if (startup) {
        await enqueueApplyPolicies(app, nodeId)
        app.log.info(`[heartbeat] Queued policy sync for node ${nodeId} after agent startup`)
      }

      // If WireGuard, sync sessions manually via stateless heartbeat poll
      if (currentNode?.vpn_type === 'wireguard') {
        app.log.info(
          `[heartbeat] Processing WireGuard heartbeat. Found ${clients?.length || 0} clients.`,
        )

        // 1. Get all currently active sessions for this node
        const activeSessions = await app
          .db('vpn_sessions')
          .where({ node_id: nodeId })
          .whereNull('disconnected_at')

        const activeSessionMap = new Map(
          activeSessions.map((s: any) => [s.credential_id ?? `legacy:${s.user_id}`, s]),
        )
        const reportedClientMap = new Map()

        if (clients && clients.length > 0) {
          // Fetch certificates for mapping public key -> user
          const nodeCerts = await app
            .db('user_node_certificates')
            .where({ node_id: nodeId })
            .select('id', 'user_id', 'client_cert', 'vpn_ip')

          app.log.info(
            `[heartbeat] Found ${nodeCerts.length} certificates registered for this node.`,
          )

          // Map truncated public key to the credential that owns the peer.
          const pubKeyToUser = new Map(
            nodeCerts
              .filter((c: any) => c.client_cert)
              .map((c: any) => [c.client_cert.trim().substring(0, 16), c]),
          )

          for (const client of clients) {
            const credential = pubKeyToUser.get(client.commonName) as
              { id: string; user_id: string; vpn_ip: string | null } | undefined
            if (!credential) {
              app.log.warn(
                `[heartbeat] Unmapped WG key: ${client.commonName}. Known prefixes: ${Array.from(pubKeyToUser.keys()).join(',')}`,
              )
              continue // skip unknown guests
            }

            const userId = credential.user_id
            reportedClientMap.set(credential.id, client)
            const existingSession = activeSessionMap.get(credential.id)

            if (!existingSession) {
              // Double-check no session was created between our initial query and now
              // (race with vpn/connect endpoint)
              const concurrentSession = await app
                .db('vpn_sessions')
                .where({ user_id: userId, node_id: nodeId, credential_id: credential.id })
                .whereNull('disconnected_at')
                .first()

              if (concurrentSession) {
                // Session was created by connect endpoint in the meantime — just update it
                await app.db('vpn_sessions').where({ id: concurrentSession.id }).update({
                  bytes_sent: client.bytesSent,
                  bytes_received: client.bytesReceived,
                  last_activity_at: new Date(),
                })
                await app
                  .db('user_node_certificates')
                  .where({ id: credential.id })
                  .update({ last_vpn_connect: new Date(client.connectedSince) })
              } else {
                app.log.info(
                  `[heartbeat] Creating new session for user ${userId} via WireGuard heartbeat`,
                )

                // New session! Create it via vpn_sessions
                const newSessionId = uuidv7()
                await app.db('vpn_sessions').insert({
                  id: newSessionId,
                  user_id: userId,
                  node_id: nodeId,
                  credential_id: credential.id,
                  vpn_ip: client.virtualAddress,
                  real_ip: client.realAddress?.split(':')[0] || client.realAddress,
                  client_version: 'WireGuard',
                  device_name: 'WireGuard Client',
                  bytes_sent: client.bytesSent,
                  bytes_received: client.bytesReceived,
                  connected_at: new Date(client.connectedSince),
                })

                // Preserve the peer's actual connection time on its credential.
                await app
                  .db('user_node_certificates')
                  .where({ id: credential.id })
                  .update({ last_vpn_connect: new Date(client.connectedSince) })

                // Get username for audit
                const userObj = await app.db('users').where('id', userId).first()
                await logAudit(app, {
                  userId: userId,
                  username: userObj?.name || 'unknown',
                  action: 'vpn_connect',
                  resourceType: 'vpn_session',
                  resourceId: newSessionId,
                  ipAddress: client.realAddress,
                  metadata: {
                    vpn_ip: client.virtualAddress,
                    node_id: nodeId,
                    client_version: 'WireGuard',
                    session_id: newSessionId,
                  },
                })
              }
            } else {
              // Update existing session bytes
              await app.db('vpn_sessions').where({ id: existingSession.id }).update({
                bytes_sent: client.bytesSent,
                bytes_received: client.bytesReceived,
                last_activity_at: new Date(),
              })

              await app
                .db('user_node_certificates')
                .where({ id: credential.id })
                .update({ last_vpn_connect: new Date(client.connectedSince) })
            }
          }
        }

        // 2. Disconnect sessions that dropped entirely from the wg interface dump
        for (const session of activeSessions) {
          if (!reportedClientMap.has(session.credential_id ?? `legacy:${session.user_id}`)) {
            app.log.info(
              `[heartbeat] Disconnecting stale session for user ${session.user_id} via WG timeout`,
            )
            const now = new Date()
            const duration = Math.floor(
              (now.getTime() - new Date(session.connected_at).getTime()) / 1000,
            )
            await app.db('vpn_sessions').where({ id: session.id }).update({
              disconnected_at: now,
              disconnect_reason: 'normal',
              connection_duration_seconds: duration,
            })

            const userObj = await app.db('users').where('id', session.user_id).first()
            await logAudit(app, {
              userId: session.user_id,
              username: userObj?.name || 'unknown',
              action: 'vpn_disconnect',
              resourceType: 'vpn_session',
              resourceId: session.id,
              ipAddress: session.real_ip,
              metadata: {
                duration_seconds: duration,
                bytes_sent: session.bytes_sent,
                bytes_received: session.bytes_received,
                disconnect_reason: 'timeout',
                session_id: session.id,
              },
            })
          }
        }
      }

      // OpenVPN: sync sessions via the credential common name in the certificate.
      // This is the fallback for when event-monitor misses CLIENT:CONNECT events,
      // e.g. when clients were already connected before the agent started.
      if (currentNode?.vpn_type === 'openvpn' && clients && clients.length >= 0) {
        app.log.info(`[heartbeat] Processing OpenVPN heartbeat. Found ${clients.length} clients.`)

        const activeSessions = await app
          .db('vpn_sessions')
          .where({ node_id: nodeId })
          .whereNull('disconnected_at')

        const activeSessionMap = new Map(
          activeSessions.map((s: any) => [s.credential_id ?? `legacy:${s.user_id}`, s]),
        )
        const reportedUserMap = new Map<string, any>()

        for (const client of clients) {
          const commonName = client.commonName
          if (!commonName) continue

          const credential = await app
            .db('user_node_certificates as c')
            .join('users as u', 'c.user_id', 'u.id')
            .where({ 'c.node_id': nodeId, 'c.common_name': commonName, 'c.is_revoked': false })
            .select('c.id as credential_id', 'c.vpn_ip as credential_vpn_ip', 'u.*')
            .first()
          if (!credential) {
            app.log.warn(`[heartbeat] OpenVPN credential "${commonName}" not found — skipping`)
            continue
          }

          const user = credential
          const sessionKey = credential.credential_id
          reportedUserMap.set(sessionKey, client)
          const existingSession = activeSessionMap.get(sessionKey)

          if (!existingSession) {
            // Double-check no session was created between our initial query and now
            // (race with vpn/connect endpoint or event-monitor)
            const concurrentSession = await app
              .db('vpn_sessions')
              .where({ user_id: user.id, node_id: nodeId })
              .modify((query: any) => {
                query.where({ credential_id: credential.credential_id })
              })
              .whereNull('disconnected_at')
              .first()

            if (concurrentSession) {
              // Session was created concurrently — just update traffic
              await app
                .db('vpn_sessions')
                .where({ id: concurrentSession.id })
                .update({
                  bytes_sent: client.bytesSent ?? concurrentSession.bytes_sent,
                  bytes_received: client.bytesReceived ?? concurrentSession.bytes_received,
                  last_activity_at: new Date(),
                })
              await app
                .db('user_node_certificates')
                .where({ id: credential.credential_id })
                .update({
                  last_vpn_connect: client.connectedSince
                    ? new Date(client.connectedSince)
                    : new Date(),
                })
            } else {
              app.log.info(
                `[heartbeat] Creating OpenVPN session for ${commonName} (${client.virtualAddress})`,
              )

              const newSessionId = uuidv7()
              await app.db('vpn_sessions').insert({
                id: newSessionId,
                user_id: user.id,
                node_id: nodeId,
                credential_id: credential.credential_id,
                vpn_ip: client.virtualAddress || credential.credential_vpn_ip,
                real_ip: client.realAddress?.split(':')[0] ?? null,
                client_version: 'OpenVPN',
                device_name: null,
                bytes_sent: client.bytesSent ?? 0,
                bytes_received: client.bytesReceived ?? 0,
                connected_at: client.connectedSince ? new Date(client.connectedSince) : new Date(),
                last_activity_at: new Date(),
              })
              await app
                .db('user_node_certificates')
                .where({ id: credential.credential_id })
                .update({
                  last_vpn_connect: client.connectedSince
                    ? new Date(client.connectedSince)
                    : new Date(),
                })
              await logAudit(app, {
                userId: user.id,
                username: user.name,
                action: 'vpn_connect',
                resourceType: 'vpn_session',
                resourceId: newSessionId,
                ipAddress: client.realAddress?.split(':')[0] ?? null,
                metadata: { vpn_ip: client.virtualAddress, node_id: nodeId, via: 'heartbeat' },
              })
            }
          } else {
            // Update traffic bytes on existing session
            await app
              .db('vpn_sessions')
              .where({ id: existingSession.id })
              .update({
                bytes_sent: client.bytesSent ?? existingSession.bytes_sent,
                bytes_received: client.bytesReceived ?? existingSession.bytes_received,
                last_activity_at: new Date(),
              })
            await app
              .db('user_node_certificates')
              .where({ id: credential.credential_id })
              .update({
                last_vpn_connect: client.connectedSince
                  ? new Date(client.connectedSince)
                  : new Date(),
              })
          }
        }

        // Close sessions for users no longer in OpenVPN status
        for (const session of activeSessions) {
          if (!reportedUserMap.has(session.credential_id ?? `legacy:${session.user_id}`)) {
            app.log.info(`[heartbeat] Closing stale OpenVPN session for user ${session.user_id}`)
            const now = new Date()
            const duration = Math.floor(
              (now.getTime() - new Date(session.connected_at).getTime()) / 1000,
            )
            await app.db('vpn_sessions').where({ id: session.id }).update({
              disconnected_at: now,
              disconnect_reason: 'normal',
              connection_duration_seconds: duration,
            })
            const userObj = await app.db('users').where('id', session.user_id).first()
            await logAudit(app, {
              userId: session.user_id,
              username: userObj?.name || 'unknown',
              action: 'vpn_disconnect',
              resourceType: 'vpn_session',
              resourceId: session.id,
              ipAddress: session.real_ip,
              metadata: {
                duration_seconds: duration,
                bytes_sent: session.bytes_sent,
                bytes_received: session.bytes_received,
                disconnect_reason: 'heartbeat_timeout',
              },
            })
          }
        }
      }

      app.realtime.publish('vpn_session.updated')

      // If node was offline and now online, trigger syncs
      if (wasOffline) {
        const tasksToCreate = []

        // Sync certificates if missing (OpenVPN only, Wireguard keys are set at registration)
        if (
          currentNode?.vpn_type !== 'wireguard' &&
          (!currentNode?.ca_cert || !currentNode?.ta_key)
        ) {
          app.log.info(`Node ${nodeId} came online without certificates, creating sync task`)
          tasksToCreate.push({
            id: uuidv7(),
            node_id: nodeId,
            action: 'sync_certificates',
            payload: JSON.stringify({}),
            status: 'pending',
            created_at: new Date(),
          })
        }

        // Always sync server config on first connection to ensure database matches actual config
        app.log.info(`Node ${nodeId} came online, creating config sync task`)
        tasksToCreate.push({
          id: uuidv7(),
          node_id: nodeId,
          action: 'sync_server_config',
          payload: JSON.stringify({}),
          status: 'pending',
          created_at: new Date(),
        })

        if (tasksToCreate.length > 0) {
          await app.db('tasks').insert(tasksToCreate)
          return { ok: true, sync_requested: true, tasks_created: tasksToCreate.length }
        }
      }

      return { ok: true }
    },
  )

  // POST /api/v1/nodes/telemetry  (called by agent every 5 seconds)
  // Traffic counters are intentionally separate from heartbeat so frequent UI
  // updates do not repeatedly send certificates, DNS health, or firewall dumps.
  app.post(
    '/nodes/telemetry',
    { schema: { tags: ['nodes'], summary: 'Agent traffic telemetry' } },
    async (request, reply) => {
      const authenticatedNode = await app.authenticateNodeToken(request, reply)
      if (!authenticatedNode) return

      const { nodeId, clients } = TrafficTelemetrySchema.parse(request.body)
      if (authenticatedNode.id !== nodeId) {
        return reply
          .status(403)
          .send({ error: 'Forbidden', message: 'Token does not match nodeId in telemetry payload' })
      }
      if (clients.length === 0) return { ok: true, sessions_updated: 0 }

      const [activeSessions, credentials] = await Promise.all([
        app.db('vpn_sessions').where({ node_id: nodeId }).whereNull('disconnected_at'),
        app
          .db('user_node_certificates')
          .where({ node_id: nodeId, is_revoked: false })
          .select('id', 'common_name', 'client_cert'),
      ])
      const sessionByCredential = new Map(
        activeSessions.map((session: any) => [session.credential_id, session]),
      )
      const credentialByName = new Map(
        credentials.map((credential: any) => [credential.common_name, credential]),
      )
      const credentialByKeyPrefix = new Map(
        credentials
          .filter((credential: any) => credential.client_cert)
          .map((credential: any) => [credential.client_cert.trim().substring(0, 16), credential]),
      )

      const changedSessions: Array<{ id: string; bytesSent: number; bytesReceived: number }> = []
      for (const client of clients) {
        const credential =
          credentialByName.get(client.commonName) ?? credentialByKeyPrefix.get(client.commonName)
        const session = credential && sessionByCredential.get(credential.id)
        if (!session) continue
        if (
          session.bytes_sent === client.bytesSent &&
          session.bytes_received === client.bytesReceived
        )
          continue
        changedSessions.push({
          id: session.id,
          bytesSent: client.bytesSent,
          bytesReceived: client.bytesReceived,
        })
      }

      // SQLite has a bound-parameter limit. Chunking keeps one telemetry report
      // to a small number of atomic CASE updates even for large VPN nodes.
      const chunkSize = 100
      await app.db.transaction(async (trx) => {
        for (let offset = 0; offset < changedSessions.length; offset += chunkSize) {
          const chunk = changedSessions.slice(offset, offset + chunkSize)
          const sentCases = chunk.map(() => 'WHEN ? THEN ?').join(' ')
          const receivedCases = chunk.map(() => 'WHEN ? THEN ?').join(' ')
          const ids = chunk.map(() => '?').join(', ')
          const bindings = [
            ...chunk.flatMap((session) => [session.id, session.bytesSent]),
            ...chunk.flatMap((session) => [session.id, session.bytesReceived]),
            new Date(),
            ...chunk.map((session) => session.id),
          ]
          await trx.raw(
            `UPDATE vpn_sessions
             SET bytes_sent = CASE id ${sentCases} END,
                 bytes_received = CASE id ${receivedCases} END,
                 last_activity_at = ?
             WHERE id IN (${ids})`,
            bindings,
          )
        }
      })

      if (changedSessions.length > 0) app.realtime.publish('vpn_session.updated')
      return { ok: true, sessions_updated: changedSessions.length }
    },
  )

  // GET /api/v1/nodes/:id/tasks  (polled by agent)
  app.get<{ Params: { id: string } }>(
    '/nodes/:id/tasks',
    { schema: { tags: ['nodes'], summary: 'Poll pending tasks for a node (agent)' } },
    async (request, reply) => {
      const authenticatedNode = await app.authenticateNodeToken(request, reply)
      if (!authenticatedNode) return
      if (authenticatedNode.id !== request.params.id) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Token does not match requested node id',
        })
      }

      // Claim immediately when work exists. Otherwise, retain this request for
      // up to 25 seconds so an idle Agent creates far fewer HTTP requests.
      let tasks = await claimPendingTasks(app.db, request.params.id)
      const query = request.query as { wait?: string }
      const requestedWait = Number.parseInt(query.wait ?? '0', 10)
      const waitMs = Math.min(25_000, Math.max(0, requestedWait * 1_000))
      if (tasks.length === 0 && waitMs > 0)
        tasks = await waitForPendingTasks(app.db, request.params.id, waitMs)
      return { tasks }
    },
  )

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/nodes/:id/decommission',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Decommission a VPN node',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })

      const user = request.user as { id: string; name: string }
      await decommissionNode(node, {
        userId: user.id,
        username: user.name,
        reason: request.body?.reason?.trim() || 'admin_decommission',
        ipAddress: getClientIp(request),
      })
      return reply.status(204).send()
    },
  )

  app.post<{ Params: { id: string } }>(
    '/nodes/:id/restore',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Restore a decommissioned node with a new agent token',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      if (!node.decommissioned_at) {
        return reply
          .status(409)
          .send({ error: 'Conflict', message: 'Only decommissioned nodes can be restored' })
      }

      const token = crypto.randomBytes(32).toString('hex')
      await app.db('vpn_nodes').where({ id: node.id }).update({
        status: 'offline',
        token,
        token_revoked_at: null,
        decommissioned_at: null,
        decommissioned_by: null,
        decommission_reason: null,
      })

      const user = request.user as { id: string; name: string }
      await logAudit(app, {
        userId: user.id,
        username: user.name,
        action: 'node_restored',
        resourceType: 'node',
        resourceId: node.id,
        ipAddress: getClientIp(request),
      })
      return {
        id: node.id,
        token,
        message: 'Node restored. Install the agent with this new token.',
      }
    },
  )

  // DELETE /api/v1/nodes/:id permanently removes an already decommissioned node.
  app.delete<{ Params: { id: string } }>(
    '/nodes/:id',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['nodes'],
        summary: 'Permanently remove a decommissioned VPN node',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      if (!node.decommissioned_at) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Decommission the node before permanently deleting it',
        })
      }
      await app.db('vpn_nodes').where({ id: node.id }).delete()

      const userObj = request.user as { id: string; name: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.name,
        action: 'node_permanent_delete',
        resourceType: 'node',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })

      return reply.status(204).send()
    },
  )

  // POST /api/v1/nodes/sync-certs (called by agent or sync script)
  app.post<{
    Body: { ca_cert?: string; ta_key?: string; public_key?: string; private_key?: string }
  }>(
    '/nodes/sync-certs',
    {
      schema: {
        tags: ['nodes'],
        summary: 'Sync node certificates (CA and TLS key) or WireGuard keys',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            ca_cert: { type: 'string', description: 'CA certificate content' },
            ta_key: { type: 'string', description: 'TLS-Crypt or TLS-Auth key content' },
            public_key: { type: 'string', description: 'WireGuard public key' },
            private_key: { type: 'string', description: 'WireGuard private key' },
          },
        },
      },
    },
    async (request, reply) => {
      const node = await app.authenticateNodeToken(request, reply)
      if (!node) return

      const { ca_cert, ta_key, public_key, private_key } = request.body

      // If agent is trying to sync WireGuard keys, it MUST be a WireGuard node.
      // This is crucial because manual registrations via Dashboard currently default to 'openvpn'
      if (public_key && private_key) {
        try {
          await app.db('vpn_nodes').where({ id: node.id }).update({
            vpn_type: 'wireguard',
            public_key: public_key.trim(),
            private_key: private_key.trim(),
            last_seen: new Date(),
          })

          app.log.info(`WireGuard keys synced (engine set to wireguard) for node ${node.id}`)
          return reply.send({
            success: true,
            message: 'WireGuard keys synced successfully',
            node_id: node.id,
          })
        } catch (error: any) {
          app.log.error(`Failed to sync WireGuard keys for node ${node.id}:`, error)
          return reply
            .status(500)
            .send({ error: 'Internal Server Error', message: 'Failed to sync WireGuard keys' })
        }
      }

      // OpenVPN flow
      if (!ca_cert || !ta_key) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Both ca_cert and ta_key are required for OpenVPN nodes',
        })
      }

      // Validate certificate format (basic check)
      const isCaCertValid =
        ca_cert.includes('BEGIN CERTIFICATE') && ca_cert.includes('END CERTIFICATE')
      const isTlsKeyValid =
        ta_key.includes('BEGIN OpenVPN Static key') && ta_key.includes('END OpenVPN Static key')

      if (!isCaCertValid) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid CA certificate format. Must contain BEGIN/END CERTIFICATE markers.',
        })
      }

      if (!isTlsKeyValid) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid TLS key format. Must contain BEGIN/END OpenVPN Static key markers.',
        })
      }

      try {
        // Update node certificates
        await app.db('vpn_nodes').where({ id: node.id }).update({
          ca_cert: ca_cert.trim(),
          ta_key: ta_key.trim(),
          last_seen: new Date(),
        })

        app.log.info(`Certificates synced for node ${node.id}`)

        return reply.send({
          success: true,
          message: 'Certificates synced successfully',
          node_id: node.id,
        })
      } catch (error: any) {
        app.log.error(`Failed to sync certificates for node ${node.id}:`, error)
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to sync certificates',
        })
      }
    },
  )

  // POST /api/v1/nodes/sync-config (called by agent to sync server config)
  app.post<{
    Body: {
      port: number
      protocol: string
      cipher: string
      auth: string
      vpnNetwork: string
      vpnNetmask: string
      dnsServers: string
      pushRoutes: string
      compression: string
      keepalivePing: number
      keepaliveTimeout: number
      maxClients: number
      tunnelMode: string
      firewallEngine?: string
    }
  }>(
    '/nodes/sync-config',
    {
      schema: {
        tags: ['nodes'],
        summary: 'Sync node server configuration',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['port', 'protocol', 'cipher', 'auth', 'vpnNetwork', 'vpnNetmask'],
          properties: {
            port: { type: 'number', description: 'VPN server port' },
            protocol: { type: 'string', description: 'Protocol (udp/tcp)' },
            cipher: { type: 'string', description: 'Encryption cipher' },
            auth: { type: 'string', description: 'Auth digest' },
            vpnNetwork: { type: 'string', description: 'VPN network address' },
            vpnNetmask: { type: 'string', description: 'VPN netmask' },
            dnsServers: { type: 'string', description: 'DNS servers (comma-separated)' },
            pushRoutes: { type: 'string', description: 'Push routes (comma-separated)' },
            compression: { type: 'string', description: 'Compression algorithm' },
            keepalivePing: { type: 'number', description: 'Keepalive ping interval' },
            keepaliveTimeout: { type: 'number', description: 'Keepalive timeout' },
            maxClients: { type: 'number', description: 'Maximum clients' },
            tunnelMode: { type: 'string', description: 'Tunnel mode (full/split)' },
            firewallEngine: { type: 'string', description: 'Firewall backend engine' },
          },
        },
      },
    },
    async (request, reply) => {
      const node = await app.authenticateNodeToken(request, reply)
      if (!node) return

      const config = request.body

      try {
        // Update node configuration
        await app
          .db('vpn_nodes')
          .where({ id: node.id })
          .update({
            port: config.port,
            protocol: config.protocol,
            cipher: config.cipher,
            auth_digest: config.auth,
            vpn_network: config.vpnNetwork,
            vpn_netmask: config.vpnNetmask,
            dns_servers: config.dnsServers,
            push_routes: config.pushRoutes,
            compression: config.compression,
            keepalive_ping: config.keepalivePing,
            keepalive_timeout: config.keepaliveTimeout,
            max_clients: config.maxClients,
            tunnel_mode: config.tunnelMode,
            custom_push_directives: (config as any).customPushDirectives ?? null,
            firewall_engine: config.firewallEngine ?? 'iptables',
            last_seen: new Date(),
          })

        app.log.info(`Server config synced for node ${node.id}`)

        return reply.send({
          success: true,
          message: 'Server config synced successfully',
          node_id: node.id,
        })
      } catch (error: any) {
        app.log.error(`Failed to sync config for node ${node.id}:`, error)
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to sync server config',
        })
      }
    },
  )
}

export default nodeRoutes
