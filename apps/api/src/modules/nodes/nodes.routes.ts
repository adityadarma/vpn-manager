import { v7 as uuidv7 } from 'uuid'
import type { FastifyPluginAsync } from 'fastify'
import crypto from 'node:crypto'
import { HeartbeatSchema } from '@vpn/shared'
import { logAudit, getClientIp } from '../../utils/audit'
import geoip from 'geoip-lite'

interface NodeConfig {
  port: number
  protocol: string
  tunnel_mode: string
  vpn_network: string
  vpn_netmask: string
  dns_servers: string
  push_routes: string
  cipher: string
  auth_digest: string
  compression: string
  keepalive_ping: number
  keepalive_timeout: number
  max_clients: number
  custom_push_directives?: string
  firewall_engine: string
}

const nodeRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/nodes
  app.get(
    '/nodes',
    { onRequest: [app.authenticate], schema: { tags: ['nodes'], summary: 'List all VPN nodes', security: [{ bearerAuth: [] }] } },
    async () => {
      // Get all nodes
      const nodes = await app.db('vpn_nodes')
        .select('id', 'hostname', 'ip_address', 'port', 'region', 'status', 'version', 'last_seen', 'created_at', 'vpn_type', 'public_key', 'endpoint_port', 'firewall_rules_dump')
      
      // Get active sessions count for each node
      const sessionCounts = await app.db('vpn_sessions')
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
      return nodes.map(node => ({
        ...node,
        active_sessions: sessionCountMap.get(node.id) || 0
      }))
    },
  )

  // GET /api/v1/nodes/me (for agent self-check with node token)
  app.get(
    '/nodes/me',
    { schema: { tags: ['nodes'], summary: 'Get current node info (agent auth)', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      // Extract node token from Authorization header
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Node token required' })
      }

      const token = authHeader.substring(7)
      
      // Find node by token
      const node = await app.db('vpn_nodes').where({ token }).first()
      
      if (!node) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid node token' })
      }

      // Return node info without sensitive token
      const { token: _token, ...safeNode } = node
      return safeNode
    },
  )

  // GET /api/v1/nodes/:id
  app.get<{ Params: { id: string } }>(
    '/nodes/:id',
    { onRequest: [app.authenticate], schema: { tags: ['nodes'], summary: 'Get node by ID', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      const { token: _token, ...safeNode } = node
      return safeNode
    },
  )

  // PUT /api/v1/nodes/:id
  app.put<{ Params: { id: string }; Body: { hostname?: string; ip_address?: string; region?: string } }>(
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
            region: { type: 'string', description: 'Node region/location' }
          }
        }
      } 
    },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) {
        return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      }

      const updates: any = {}
      
      if (request.body.hostname !== undefined) {
        // Check if hostname already exists (excluding current node)
        const existing = await app.db('vpn_nodes')
          .where({ hostname: request.body.hostname })
          .whereNot({ id: request.params.id })
          .first()
        
        if (existing) {
          return reply.status(409).send({ 
            error: 'Conflict', 
            message: 'Hostname already exists' 
          })
        }
        updates.hostname = request.body.hostname
      }
      
      if (request.body.ip_address !== undefined) {
        // Check if IP already exists (excluding current node)
        const existing = await app.db('vpn_nodes')
          .where({ ip_address: request.body.ip_address })
          .whereNot({ id: request.params.id })
          .first()
        
        if (existing) {
          return reply.status(409).send({ 
            error: 'Conflict', 
            message: 'IP address already exists' 
          })
        }
        updates.ip_address = request.body.ip_address
      }
      
      if (request.body.region !== undefined) {
        updates.region = request.body.region || null
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ 
          error: 'Bad Request', 
          message: 'No valid fields to update' 
        })
      }

      await app.db('vpn_nodes').where({ id: request.params.id }).update(updates)

      const updated = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      const { token: _token, ...safeNode } = updated

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'node_update',
        resourceType: 'node',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
        metadata: { updated_fields: Object.keys(updates) }
      })

      return safeNode
    },
  )

  // GET /api/v1/nodes/:id/config
  app.get<{ Params: { id: string } }>(
    '/nodes/:id/config',
    { onRequest: [app.authenticate], schema: { tags: ['nodes'], summary: 'Get node configuration', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const config = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!config) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      
      return {
        port: config.port,
        protocol: config.protocol,
        tunnel_mode: config.tunnel_mode,
        vpn_network: config.vpn_network,
        vpn_netmask: config.vpn_netmask,
        dns_servers: config.dns_servers,
        push_routes: config.push_routes,
        cipher: config.cipher,
        auth_digest: config.auth_digest,
        compression: config.compression,
        keepalive_ping: config.keepalive_ping,
        keepalive_timeout: config.keepalive_timeout,
        max_clients: config.max_clients,
        custom_push_directives: config.custom_push_directives ?? '',
        firewall_engine: config.firewall_engine ?? 'iptables',
      }
    },
  )

  // PUT /api/v1/nodes/:id/config
  app.put<{ Params: { id: string }; Body: NodeConfig }>(
    '/nodes/:id/config',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['nodes'], summary: 'Update node configuration', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const node = await app.db('vpn_nodes').where({ id: request.params.id }).first()
      if (!node) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })

      const config = request.body as NodeConfig
      
      // Check if vpn_network actually changed
      const networkChanged = node.vpn_network !== config.vpn_network || node.vpn_netmask !== config.vpn_netmask

      // Update database
      await app.db('vpn_nodes').where({ id: request.params.id }).update({
        port: config.port,
        protocol: config.protocol,
        tunnel_mode: config.tunnel_mode,
        vpn_network: config.vpn_network,
        vpn_netmask: config.vpn_netmask,
        dns_servers: config.dns_servers,
        push_routes: config.push_routes,
        cipher: config.cipher,
        auth_digest: config.auth_digest,
        compression: config.compression,
        keepalive_ping: config.keepalive_ping,
        keepalive_timeout: config.keepalive_timeout,
        max_clients: config.max_clients,
        custom_push_directives: config.custom_push_directives ?? null,
        firewall_engine: config.firewall_engine,
      })

      // Collect all group subnets so the agent can generate route directives
      const allGroups = await app.db('groups').whereNotNull('vpn_subnet').select('name', 'vpn_subnet')
      const groupSubnets = allGroups
        .map((g: { name: string; vpn_subnet: string }) => g.vpn_subnet)
        .filter(Boolean)

      // IMPORTANT: Schedule update_server_config FIRST so that OpenVPN reloads
      // with the new network + crl-verify BEFORE revoke tasks kick clients.
      // When kicked clients auto-reconnect, the CRL will already be loaded.
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id: request.params.id,
        action: 'update_server_config',
        payload: JSON.stringify({ ...config, group_subnets: groupSubnets }),
        status: 'pending',
        created_at: new Date(),
      })

      // If network changed, schedule revoke tasks AFTER the config update task
      if (networkChanged) {
        const certs = await app.db('user_node_certificates').where({ node_id: request.params.id, is_revoked: 0 })
        
        if (certs.length > 0) {
          app.log.info(`[api/nodes] Network changed. Revoking ${certs.length} legacy certificates for node ${request.params.id}`)
          
          await app.db('user_node_certificates')
            .where({ node_id: request.params.id })
            .update({ 
               is_revoked: 1, 
               revoked_at: new Date(), 
               revoke_reason: 'Network Subnet Changed' 
            })
            
          for (const cert of certs) {
            const userObj = await app.db('users').where({ id: cert.user_id }).first()
            if (!userObj) continue
            
            await app.db('tasks').insert({
              id: uuidv7(),
              node_id: request.params.id,
              action: 'revoke_user',
              payload: JSON.stringify({ 
                username: userObj.username,
                client_cert: cert.client_cert 
              }),
              status: 'pending',
              created_at: new Date(),
            })
            
            await app.db('vpn_sessions')
               .where({ user_id: userObj.id, node_id: request.params.id })
               .whereNull('disconnected_at')
               .update({
                 disconnected_at: new Date(),
                 disconnect_reason: 'admin_kick'
               })
          }
        }
      }


      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
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
  app.post<{ Body: { hostname: string; ip: string; port?: number; region?: string; version?: string; registrationKey?: string; vpnType?: 'openvpn' | 'wireguard'; publicKey?: string; privateKey?: string; endpointPort?: number; config?: any } }>(
    '/nodes/register',
    { schema: { tags: ['nodes'], summary: 'Register a new VPN node (requires admin auth or registration key)' } },
    async (request, reply) => {
      const { hostname, ip, port, region, version, registrationKey, vpnType, publicKey, privateKey, endpointPort, config } = request.body

      // Check authentication: either JWT token (admin) or registration key
      let isAuthenticated = false

      // Method 1: Check JWT token (admin only) via fastify-jwt (supports both cookie and header)
      try {
        await request.jwtVerify()
        const user = request.user as { role: string }
        if (user?.role === 'admin') {
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
            message: 'Node registration requires admin authentication or registration key. Set NODE_REGISTRATION_KEY in environment variables.',
          })
        }

        if (!registrationKey) {
          app.log.warn('[node-register] No registration key provided in request body')
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Registration key required but not provided',
          })
        }

        // Trim whitespace from both keys before comparison
        const trimmedProvidedKey = registrationKey.trim()
        const trimmedValidKey = validRegistrationKey.trim()

        if (trimmedProvidedKey !== trimmedValidKey) {
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

      // Check if node already exists
      const existing = await app.db('vpn_nodes').where({ hostname }).orWhere({ ip_address: ip }).first()
      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Node with this hostname or IP already exists',
        })
      }

      // Generate secure token for agent
      const token = crypto.randomBytes(32).toString('hex')
      const id = uuidv7()

      // Determine dynamic vpn network (10.8.X.0)
      let nextNetwork = '10.8.0.0'
      const existingNodes = await app.db('vpn_nodes').select('vpn_network')
      const usedSubnets = existingNodes.map((n: { vpn_network: string | null }) => {
        if (!n.vpn_network) return -1
        const parts = n.vpn_network.split('.')
        if (parts.length === 4 && parts[0] === '10' && parts[1] === '8') {
          return parseInt(parts[2], 10)
        }
        return -1
      }).filter((n: number) => !isNaN(n) && n >= 0)

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
      }

      if (config) {
        nodeData.protocol = config.protocol || 'udp'
        nodeData.tunnel_mode = config.tunnel_mode || 'split'
        nodeData.vpn_network = config.vpn_network || nextNetwork
        nodeData.vpn_netmask = config.vpn_netmask || '255.255.255.0'
        nodeData.dns_servers = config.dns_servers || '8.8.8.8,1.1.1.1'
        nodeData.push_routes = config.push_routes || ''
        nodeData.cipher = config.cipher || 'AES-128-GCM'
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
        nodeData.cipher = 'AES-128-GCM'
        nodeData.auth_digest = 'SHA256'
        nodeData.compression = 'lz4-v2'
        nodeData.keepalive_ping = 10
        nodeData.keepalive_timeout = 120
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
    async (request) => {
      const { nodeId, caCert, taKey, firewallRules, clients } = HeartbeatSchema.parse(request.body)
      
      // Get current node status
      const currentNode = await app.db('vpn_nodes').where({ id: nodeId }).first()
      const wasOffline = currentNode?.status === 'offline'
      
      const updates: any = { status: 'online', last_seen: new Date() }
      if (caCert) updates.ca_cert = caCert
      if (taKey) updates.ta_key = taKey
      if (firewallRules !== undefined) updates.firewall_rules_dump = firewallRules
      await app.db('vpn_nodes').where({ id: nodeId }).update(updates)
      
      // If WireGuard, sync sessions manually via stateless heartbeat poll
      if (currentNode?.vpn_type === 'wireguard') {
        app.log.info(`[heartbeat] Processing WireGuard heartbeat. Found ${clients?.length || 0} clients.`)
        
        // 1. Get all currently active sessions for this node
        const activeSessions = await app.db('vpn_sessions')
          .where({ node_id: nodeId })
          .whereNull('disconnected_at')
        
        const activeSessionMap = new Map(activeSessions.map((s: any) => [s.user_id, s]))
        const reportedClientMap = new Map()

        if (clients && clients.length > 0) {
          // Fetch certificates for mapping public key -> user
          const nodeCerts = await app.db('user_node_certificates')
            .where({ node_id: nodeId })
            .select('user_id', 'client_cert')
          
          app.log.info(`[heartbeat] Found ${nodeCerts.length} certificates registered for this node.`)
          
          // Map truncated public key (16 chars) to user_id
          const pubKeyToUser = new Map(
            nodeCerts
              .filter((c: any) => c.client_cert)
              .map((c: any) => [c.client_cert.trim().substring(0, 16), c.user_id])
          )

          for (const client of clients) {
            const userId = pubKeyToUser.get(client.commonName)
            if (!userId) {
              app.log.warn(`[heartbeat] Unmapped WG key: ${client.commonName}. Known prefixes: ${Array.from(pubKeyToUser.keys()).join(',')}`)
              continue // skip unknown guests
            }
            
            reportedClientMap.set(userId, client)
            const existingSession = activeSessionMap.get(userId)
            
            if (!existingSession) {
              app.log.info(`[heartbeat] Creating new session for user ${userId} via WireGuard heartbeat`)
              
              let geoCity = null
              let geoCountry = null
              if (client.realAddress) {
                // Remove port if present: e.g. "1.2.3.4:51820" -> "1.2.3.4"
                const cleanIp = client.realAddress.split(':')[0]
                const geo = geoip.lookup(cleanIp)
                if (geo) {
                  geoCity = geo.city || null
                  geoCountry = geo.country || null
                }
              }

              // New session! Create it via vpn_sessions
              const newSessionId = uuidv7()
              await app.db('vpn_sessions').insert({
                id: newSessionId,
                user_id: userId,
                node_id: nodeId,
                vpn_ip: client.virtualAddress,
                real_ip: client.realAddress?.split(':')[0] || client.realAddress,
                client_version: 'WireGuard',
                device_name: 'WireGuard Client',
                bytes_sent: client.bytesSent,
                bytes_received: client.bytesReceived,
                connected_at: new Date(client.connectedSince),
                geo_city: geoCity,
                geo_country: geoCountry,
              })
              
              // Update user's last_vpn_connect time to reflect VPN usage
              await app.db('users').where({ id: userId }).update({ last_vpn_connect: new Date() })

              // Get username for audit
              const userObj = await app.db('users').where('id', userId).first()
              await logAudit(app, {
                userId: userId,
                username: userObj?.username || 'unknown',
                action: 'vpn_connect',
                resourceType: 'vpn_session',
                resourceId: newSessionId,
                ipAddress: client.realAddress,
                metadata: {
                  vpn_ip: client.virtualAddress,
                  node_id: nodeId,
                  client_version: 'WireGuard',
                  session_id: newSessionId
                }
              })
            } else {
              // Update existing session bytes
              await app.db('vpn_sessions').where({ id: existingSession.id }).update({
                bytes_sent: client.bytesSent,
                bytes_received: client.bytesReceived,
                last_activity_at: new Date(),
              })
              
              // Ensure last_vpn_connect is populated if it was null before our update
              await app.db('users')
                .where({ id: userId })
                .whereNull('last_vpn_connect')
                .update({ last_vpn_connect: new Date(client.connectedSince) })
            }
          }
        }
        
        // 2. Disconnect sessions that dropped entirely from the wg interface dump
        for (const session of activeSessions) {
          if (!reportedClientMap.has(session.user_id)) {
            app.log.info(`[heartbeat] Disconnecting stale session for user ${session.user_id} via WG timeout`)
            const now = new Date()
            const duration = Math.floor((now.getTime() - new Date(session.connected_at).getTime()) / 1000)
            await app.db('vpn_sessions').where({ id: session.id }).update({
              disconnected_at: now,
              disconnect_reason: 'normal',
              connection_duration_seconds: duration
            })

            const userObj = await app.db('users').where('id', session.user_id).first()
            await logAudit(app, {
              userId: session.user_id,
              username: userObj?.username || 'unknown',
              action: 'vpn_disconnect',
              resourceType: 'vpn_session',
              resourceId: session.id,
              ipAddress: session.real_ip,
              metadata: {
                duration_seconds: duration,
                bytes_sent: session.bytes_sent,
                bytes_received: session.bytes_received,
                disconnect_reason: 'timeout',
                session_id: session.id
              }
            })
          }
        }
      }

      // OpenVPN: sync sessions via heartbeat (commonName = username in certificate)
      // This is the fallback for when event-monitor misses CLIENT:CONNECT events,
      // e.g. when clients were already connected before the agent started.
      if (currentNode?.vpn_type === 'openvpn' && clients && clients.length >= 0) {
        app.log.info(`[heartbeat] Processing OpenVPN heartbeat. Found ${clients.length} clients.`)

        const activeSessions = await app.db('vpn_sessions')
          .where({ node_id: nodeId })
          .whereNull('disconnected_at')

        const activeSessionMap = new Map(activeSessions.map((s: any) => [s.user_id, s]))
        const reportedUserMap = new Map<string, any>()

        for (const client of clients) {
          const username = client.commonName
          if (!username) continue

          const user = await app.db('users').where({ username }).first()
          if (!user) {
            app.log.warn(`[heartbeat] OpenVPN client "${username}" not found in users table — skipping`)
            continue
          }

          reportedUserMap.set(user.id, client)
          const existingSession = activeSessionMap.get(user.id)

          if (!existingSession) {
            app.log.info(`[heartbeat] Creating OpenVPN session for ${username} (${client.virtualAddress})`)
            
            let geoCity = null
            let geoCountry = null
            if (client.realAddress) {
              const cleanIp = client.realAddress.split(':')[0]
              const geo = geoip.lookup(cleanIp)
              if (geo) {
                geoCity = geo.city || null
                geoCountry = geo.country || null
              }
            }

            const newSessionId = uuidv7()
            await app.db('vpn_sessions').insert({
              id: newSessionId,
              user_id: user.id,
              node_id: nodeId,
              vpn_ip: client.virtualAddress || user.vpn_ip,
              real_ip: client.realAddress?.split(':')[0] ?? null,
              client_version: 'OpenVPN',
              device_name: null,
              bytes_sent: client.bytesSent ?? 0,
              bytes_received: client.bytesReceived ?? 0,
              connected_at: client.connectedSince ? new Date(client.connectedSince) : new Date(),
              last_activity_at: new Date(),
              geo_city: geoCity,
              geo_country: geoCountry,
            })
            await logAudit(app, {
              userId: user.id,
              username,
              action: 'vpn_connect',
              resourceType: 'vpn_session',
              resourceId: newSessionId,
              ipAddress: client.realAddress?.split(':')[0] ?? null,
              metadata: { vpn_ip: client.virtualAddress, node_id: nodeId, via: 'heartbeat' }
            })
          } else {
            // Update traffic bytes on existing session
            await app.db('vpn_sessions').where({ id: existingSession.id }).update({
              bytes_sent: client.bytesSent ?? existingSession.bytes_sent,
              bytes_received: client.bytesReceived ?? existingSession.bytes_received,
              last_activity_at: new Date(),
            })
          }
        }

        // Close sessions for users no longer in OpenVPN status
        for (const session of activeSessions) {
          if (!reportedUserMap.has(session.user_id)) {
            app.log.info(`[heartbeat] Closing stale OpenVPN session for user ${session.user_id}`)
            const now = new Date()
            const duration = Math.floor((now.getTime() - new Date(session.connected_at).getTime()) / 1000)
            await app.db('vpn_sessions').where({ id: session.id }).update({
              disconnected_at: now,
              disconnect_reason: 'normal',
              connection_duration_seconds: duration,
            })
            const userObj = await app.db('users').where('id', session.user_id).first()
            await logAudit(app, {
              userId: session.user_id,
              username: userObj?.username || 'unknown',
              action: 'vpn_disconnect',
              resourceType: 'vpn_session',
              resourceId: session.id,
              ipAddress: session.real_ip,
              metadata: {
                duration_seconds: duration,
                bytes_sent: session.bytes_sent,
                bytes_received: session.bytes_received,
                disconnect_reason: 'heartbeat_timeout',
              }
            })
          }
        }
      }


      // If node was offline and now online, trigger syncs
      if (wasOffline) {
        const tasksToCreate = []
        
        // Sync certificates if missing (OpenVPN only, Wireguard keys are set at registration)
        if (currentNode?.vpn_type !== 'wireguard' && (!currentNode?.ca_cert || !currentNode?.ta_key)) {
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

  // GET /api/v1/nodes/:id/tasks  (polled by agent)
  app.get<{ Params: { id: string } }>(
    '/nodes/:id/tasks',
    { schema: { tags: ['nodes'], summary: 'Poll pending tasks for a node (agent)' } },
    async (request) => {
      const tasks = await app.db('tasks')
        .where({ node_id: request.params.id, status: 'pending' })
        .orderBy('created_at', 'asc')
        .select('id', 'action', 'payload', 'created_at')

      // Mark as running
      const ids = tasks.map((t: { id: string }) => t.id)
      if (ids.length > 0) {
        await app.db('tasks').whereIn('id', ids).update({ status: 'running' })
      }

      // Parse payload JSON strings
      const parsedTasks = tasks.map((task: any) => ({
        ...task,
        payload: typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload
      }))

      return { tasks: parsedTasks }
    },
  )

  // DELETE /api/v1/nodes/:id
  app.delete<{ Params: { id: string } }>(
    '/nodes/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['nodes'], summary: 'Remove a VPN node', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const deleted = await app.db('vpn_nodes').where({ id: request.params.id }).delete()
      if (!deleted) return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'node_delete',
        resourceType: 'node',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })

      return reply.status(204).send()
    },
  )

  // POST /api/v1/nodes/sync-certs (called by agent or sync script)
  app.post<{ Body: { ca_cert?: string; ta_key?: string; public_key?: string; private_key?: string } }>(
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
            private_key: { type: 'string', description: 'WireGuard private key' }
          }
        }
      } 
    },
    async (request, reply) => {
      // Extract node token from Authorization header
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Node token required' })
      }

      const token = authHeader.substring(7)
      
      // Find node by token
      const node = await app.db('vpn_nodes').where({ token }).first()
      if (!node) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid node token' })
      }

      const { ca_cert, ta_key, public_key, private_key } = request.body

      // If agent is trying to sync WireGuard keys, it MUST be a WireGuard node.
      // This is crucial because manual registrations via Dashboard currently default to 'openvpn'
      if (public_key && private_key) {
        try {
          await app.db('vpn_nodes')
            .where({ id: node.id })
            .update({
              vpn_type: 'wireguard',
              public_key: public_key.trim(),
              private_key: private_key.trim(),
              last_seen: new Date()
            })

          app.log.info(`WireGuard keys synced (engine set to wireguard) for node ${node.id}`)
          return reply.send({ success: true, message: 'WireGuard keys synced successfully', node_id: node.id })
        } catch (error: any) {
          app.log.error(`Failed to sync WireGuard keys for node ${node.id}:`, error)
          return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to sync WireGuard keys' })
        }
      }

      // OpenVPN flow
      if (!ca_cert || !ta_key) {
        return reply.status(400).send({ 
          error: 'Bad Request', 
          message: 'Both ca_cert and ta_key are required for OpenVPN nodes' 
        })
      }

      // Validate certificate format (basic check)
      const isCaCertValid = ca_cert.includes('BEGIN CERTIFICATE') && ca_cert.includes('END CERTIFICATE')
      const isTlsKeyValid = (ta_key.includes('BEGIN OpenVPN Static key') && ta_key.includes('END OpenVPN Static key'))
      
      if (!isCaCertValid) {
        return reply.status(400).send({ 
          error: 'Bad Request', 
          message: 'Invalid CA certificate format. Must contain BEGIN/END CERTIFICATE markers.' 
        })
      }
      
      if (!isTlsKeyValid) {
        return reply.status(400).send({ 
          error: 'Bad Request', 
          message: 'Invalid TLS key format. Must contain BEGIN/END OpenVPN Static key markers.' 
        })
      }

      try {
        // Update node certificates
        await app.db('vpn_nodes')
          .where({ id: node.id })
          .update({
            ca_cert: ca_cert.trim(),
            ta_key: ta_key.trim(),
            last_seen: new Date()
          })

        app.log.info(`Certificates synced for node ${node.id}`)

        return reply.send({ 
          success: true, 
          message: 'Certificates synced successfully',
          node_id: node.id
        })
      } catch (error: any) {
        app.log.error(`Failed to sync certificates for node ${node.id}:`, error)
        return reply.status(500).send({ 
          error: 'Internal Server Error', 
          message: 'Failed to sync certificates' 
        })
      }
    },
  )

  // POST /api/v1/nodes/sync-config (called by agent to sync server config)
  app.post<{ Body: { port: number; protocol: string; cipher: string; auth: string; vpnNetwork: string; vpnNetmask: string; dnsServers: string; pushRoutes: string; compression: string; keepalivePing: number; keepaliveTimeout: number; maxClients: number; tunnelMode: string; firewallEngine?: string } }>(
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
            firewallEngine: { type: 'string', description: 'Firewall backend engine' }
          }
        }
      }
    },
    async (request, reply) => {
      // Extract node token from Authorization header
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Node token required' })
      }

      const token = authHeader.substring(7)
      
      // Find node by token
      const node = await app.db('vpn_nodes').where({ token }).first()
      if (!node) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid node token' })
      }

      const config = request.body

      try {
        // Update node configuration
        await app.db('vpn_nodes')
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
            last_seen: new Date()
          })

        app.log.info(`Server config synced for node ${node.id}`)

        return reply.send({
          success: true,
          message: 'Server config synced successfully',
          node_id: node.id
        })
      } catch (error: any) {
        app.log.error(`Failed to sync config for node ${node.id}:`, error)
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to sync server config'
        })
      }
    },
  )
}

export default nodeRoutes
