import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { logAudit, getClientIp } from '../../utils/audit'

/**
 * VPN Hooks API — called by vpn-client agent living on the VPN server.
 * All endpoints are protected by X-VPN-Token header (vpn_token from env).
 *
 * Flow (Certificate-only authentication):
 *   1. vpn-connect→ POST /vpn/connect     (client-connect script, validates user)
 *   2. vpn-disconnect → POST /vpn/disconnect (client-disconnect script)
 */

const vpnRoutes: FastifyPluginAsync = async (app) => {
  // Middleware: validate X-VPN-Token header for all /vpn/* routes
  app.addHook('preHandler', async (request, reply) => {
    const token = request.headers['x-vpn-token'] as string | undefined
    const expected = process.env['VPN_TOKEN']
    if (!expected) {
      app.log.warn('[vpn] VPN_TOKEN env not set — rejecting all VPN auth requests')
      return reply.status(503).send({ error: 'VPN_TOKEN not configured on server' })
    }
    if (!token || token !== expected) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid X-VPN-Token' })
    }
  })

  /**
   * POST /api/v1/vpn/connect
   * Called by: vpn-connect script (client-connect hook)
   * Body: { username, vpn_ip, node_id, common_name, real_ip, client_version, device_name }
   * Opens a new session row in vpn_sessions.
   * Also validates user is active and within validity period.
   */
  app.post<{
    Body: { 
      username?: string    // OpenVPN: common_name = username
      public_key?: string  // WireGuard: first 16 chars of peer public key
      vpn_ip?: string      // optional — may be absent when client uses static CCD ifconfig-push
      node_id: string
      common_name?: string
      real_ip?: string
      client_version?: string
      device_name?: string
      connected_at?: string // ISO string — actual connection time from VPN status (for sync)
    }
  }>(
    '/vpn/connect',
    { schema: { tags: ['vpn'], summary: 'Record VPN client connect event' } },
    async (request, reply) => {
      const { node_id, real_ip, client_version, device_name } = request.body
      const connectedAtOverride = request.body.connected_at ? new Date(request.body.connected_at) : null
      let { vpn_ip } = request.body

      if (!node_id) {
        return reply.status(400).send({ error: 'node_id required' })
      }
      if (!request.body.username && !request.body.public_key) {
        return reply.status(400).send({ error: 'username or public_key required' })
      }

      // Resolve user — OpenVPN sends username, WireGuard sends public_key prefix
      let user: any
      if (request.body.username) {
        user = await app.db('users').where({ username: request.body.username }).first()
      }
      if (!user && request.body.public_key) {
        // WireGuard: lookup via user_node_certificates using public key prefix (16 chars)
        const keyPrefix = request.body.public_key.substring(0, 16)
        const cert = await app.db('user_node_certificates as c')
          .join('users as u', 'c.user_id', 'u.id')
          .where('c.node_id', node_id)
          .whereRaw(`substr(c.client_cert, 1, 16) = ?`, [keyPrefix])
          .select('u.*')
          .first()
        user = cert
      }
      if (!user) return reply.status(404).send({ error: 'User not found' })

      // Resolve vpn_ip — absent for static CCD (OpenVPN) or static WG peers
      if (!vpn_ip) vpn_ip = user.vpn_ip
      if (!vpn_ip) {
        return reply.status(400).send({ error: 'vpn_ip could not be determined for this user' })
      }

      const node = await app.db('vpn_nodes').where({ id: node_id }).first()
      if (!node) return reply.status(404).send({ error: 'Node not found' })

      const clientIp = real_ip ?? getClientIp(request)

      // Validate user is active
      if (!user.is_active) {
        app.log.warn(`[vpn/connect] Inactive user attempted connection: ${user.username} from ${clientIp}`)
        
        await app.db('connection_attempts').insert({
          id: uuidv7(),
          user_id: user.id,
          node_id: node_id ?? null,
          username: user.username,
          real_ip: clientIp,
          failure_reason: 'account_disabled',
          error_details: 'User account is disabled',
          attempted_at: new Date(),
        }).catch(() => { /* non-fatal */ })
        
        return reply.status(403).send({ error: 'Account disabled' })
      }
      
      // Check validity window (valid_from / valid_to)
      const now = new Date()
      if (user.valid_from && new Date(user.valid_from) > now) {
        await app.db('connection_attempts').insert({
          id: uuidv7(),
          user_id: user.id,
          node_id: node_id ?? null,
          username: user.username,
          real_ip: clientIp,
          failure_reason: 'account_not_active',
          error_details: `Account not active until ${user.valid_from}`,
          attempted_at: new Date(),
        }).catch(() => { /* non-fatal */ })
        
        return reply.status(403).send({ error: 'Account not yet active' })
      }
      
      if (user.valid_to && new Date(user.valid_to) < now) {
        await app.db('connection_attempts').insert({
          id: uuidv7(),
          user_id: user.id,
          node_id: node_id ?? null,
          username: user.username,
          real_ip: clientIp,
          failure_reason: 'account_expired',
          error_details: `Account expired on ${user.valid_to}`,
          attempted_at: new Date(),
        }).catch(() => { /* non-fatal */ })
        
        return reply.status(403).send({ error: 'Account expired' })
      }

      // Close any previously open session for this user (defensive)
      const previousSessions = await app.db('vpn_sessions')
        .where({ user_id: user.id })
        .whereNull('disconnected_at')
      
      if (previousSessions.length > 0) {
        const now = new Date()
        for (const session of previousSessions) {
          const connectedAt = new Date(session.connected_at)
          const durationSeconds = Math.floor((now.getTime() - connectedAt.getTime()) / 1000)
          
          await app.db('vpn_sessions')
            .where({ id: session.id })
            .update({
              disconnected_at: now,
              disconnect_reason: 'reconnect',
              connection_duration_seconds: durationSeconds,
            })
        }
      }

      const sessionId = uuidv7()
      await app.db('vpn_sessions').insert({
        id: sessionId,
        user_id: user.id,
        node_id: node.id,
        vpn_ip,
        real_ip: clientIp,
        client_version: client_version ?? null,
        device_name: device_name ?? null,
        bytes_sent: 0,
        bytes_received: 0,
        connected_at: connectedAtOverride ?? new Date(),
        last_activity_at: new Date(),
      })

      app.log.info(`[vpn/connect] ${user.username} connected — session ${sessionId}, IP ${vpn_ip}, device: ${device_name ?? 'unknown'}`)

      // Log successful connection audit
      await logAudit(app, {
        userId: user.id,
        username: user.username,
        action: 'vpn_connect',
        resourceType: 'vpn_session',
        resourceId: sessionId,
        ipAddress: clientIp,
        metadata: {
          vpn_ip,
          node_hostname: node.hostname,
          client_version,
          device_name,
          session_id: sessionId
        }
      })

      // Get user's policy networks for route push (response to agent)
      const networks = await app.db('vpn_policies as p')
        .join('users as u', 'p.user_id', 'u.id')
        .where('p.user_id', user.id)
        .where('p.action', 'allow')
        .select('p.target_network')

      return reply.status(201).send({
        session_id: sessionId,
        push_routes: networks.map((n: { target_network: string }) => n.target_network),
      })
    },
  )

  /**
   * POST /api/v1/vpn/disconnect
   * Called by: vpn-disconnect script (client-disconnect hook)
   * Body: { username, node_id, bytes_sent, bytes_received, disconnect_reason }
   * Closes the open session and records traffic stats.
   */
  app.post<{
    Body: { 
      username: string
      node_id: string
      bytes_sent?: number
      bytes_received?: number
      disconnect_reason?: string
    }
  }>(
    '/vpn/disconnect',
    { schema: { tags: ['vpn'], summary: 'Record VPN client disconnect event' } },
    async (request, reply) => {
      const { username, node_id, bytes_sent = 0, bytes_received = 0, disconnect_reason = 'normal' } = request.body

      if (!username || !node_id) {
        return reply.status(400).send({ error: 'username and node_id required' })
      }

      const user = await app.db('users').where({ username }).first()
      if (!user) return reply.status(404).send({ error: 'User not found' })

      // Get session to calculate duration
      const session = await app.db('vpn_sessions')
        .where({ user_id: user.id, node_id })
        .whereNull('disconnected_at')
        .first()

      if (session) {
        const now = new Date()
        const connectedAt = new Date(session.connected_at)
        const durationSeconds = Math.floor((now.getTime() - connectedAt.getTime()) / 1000)

        await app.db('vpn_sessions')
          .where({ id: session.id })
          .update({
            disconnected_at: now,
            bytes_sent,
            bytes_received,
            disconnect_reason,
            connection_duration_seconds: durationSeconds,
          })

        app.log.info(`[vpn/disconnect] ${username} disconnected — session ${session.id}, duration: ${durationSeconds}s, reason: ${disconnect_reason}`)

        // Log audit
        await logAudit(app, {
          userId: user.id,
          username: user.username,
          action: 'vpn_disconnect',
          resourceType: 'vpn_session',
          resourceId: session.id,
          ipAddress: session.real_ip,
          metadata: {
            duration_seconds: durationSeconds,
            bytes_sent,
            bytes_received,
            disconnect_reason,
            session_id: session.id
          }
        })
      }

      return reply.status(200).send({ ok: true, sessions_closed: session ? 1 : 0 })
    },
  )

  /**
   * POST /api/v1/vpn/activity
   * Called by: agent periodically to update session activity
   * Body: { session_id, bytes_sent, bytes_received, latency_ms, packet_loss_percent }
   * Records bandwidth and connection quality metrics
   */
  app.post<{
    Body: {
      session_id: string
      bytes_sent: number
      bytes_received: number
      latency_ms?: number
      packet_loss_percent?: number
    }
  }>(
    '/vpn/activity',
    { schema: { tags: ['vpn'], summary: 'Update session activity metrics' } },
    async (request, reply) => {
      const { session_id, bytes_sent, bytes_received, latency_ms, packet_loss_percent } = request.body

      if (!session_id) {
        return reply.status(400).send({ error: 'session_id required' })
      }

      // Update session last_activity_at and totals
      const session = await app.db('vpn_sessions')
        .where({ id: session_id })
        .whereNull('disconnected_at')
        .first()

      if (!session) {
        return reply.status(404).send({ error: 'Active session not found' })
      }

      const now = new Date()
      
      // Calculate deltas
      const bytesSentDelta = bytes_sent - (session.bytes_sent || 0)
      const bytesReceivedDelta = bytes_received - (session.bytes_received || 0)

      // Update session
      await app.db('vpn_sessions')
        .where({ id: session_id })
        .update({
          last_activity_at: now,
          bytes_sent,
          bytes_received,
        })

      // Record activity snapshot
      await app.db('session_activities').insert({
        id: uuidv7(),
        session_id,
        recorded_at: now,
        bytes_sent_delta: bytesSentDelta,
        bytes_received_delta: bytesReceivedDelta,
        bytes_sent_total: bytes_sent,
        bytes_received_total: bytes_received,
        latency_ms: latency_ms ?? null,
        packet_loss_percent: packet_loss_percent ?? null,
      })

      return reply.status(200).send({ ok: true })
    },
  )
}

export default vpnRoutes
