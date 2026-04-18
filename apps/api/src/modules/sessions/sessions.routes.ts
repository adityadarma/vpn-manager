import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { logAudit, getClientIp } from '../../utils/audit'

const sessionRoutes: FastifyPluginAsync = async (app) => {
  const dbClient = String(app.db.client.config.client || '')
  const durationSecondsExpr = dbClient.includes('pg')
    ? app.db.raw('EXTRACT(EPOCH FROM (NOW() - s.connected_at))::integer as duration_seconds')
    : dbClient.includes('mysql')
      ? app.db.raw('TIMESTAMPDIFF(SECOND, s.connected_at, NOW()) as duration_seconds')
      : app.db.raw("CAST((julianday('now') - julianday(s.connected_at)) * 86400 AS INTEGER) as duration_seconds")

  // GET /api/v1/sessions  — active sessions with enhanced details
  app.get(
    '/sessions',
    { onRequest: [app.authenticate], schema: { tags: ['sessions'], summary: 'List active VPN sessions', security: [{ bearerAuth: [] }] } },
    async () => {
      return app.db('vpn_sessions as s')
        .join('users as u', 's.user_id', 'u.id')
        .join('vpn_nodes as n', 's.node_id', 'n.id')
        .whereNull('s.disconnected_at')
        .select(
          's.id',
          's.user_id',
          'u.username',
          'u.email',
          'n.id as node_id',
          'n.hostname as node_hostname',
          'n.region as node_region',
          's.vpn_ip',
          's.real_ip',
          's.client_version',
          's.device_name',
          's.geo_country',
          's.geo_city',
          's.bytes_sent',
          's.bytes_received',
          's.connected_at',
          's.last_activity_at',
          durationSecondsExpr,
        )
        .orderBy('s.connected_at', 'desc')
    },
  )

  // GET /api/v1/sessions/:id  — session details with activity history
  app.get<{ Params: { id: string } }>(
    '/sessions/:id',
    { onRequest: [app.authenticate], schema: { tags: ['sessions'], summary: 'Get session details', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { id } = request.params

      const session = await app.db('vpn_sessions as s')
        .join('users as u', 's.user_id', 'u.id')
        .join('vpn_nodes as n', 's.node_id', 'n.id')
        .where('s.id', id)
        .select(
          's.*',
          'u.username',
          'u.email',
          'n.hostname as node_hostname',
          'n.region as node_region',
        )
        .first()

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' })
      }

      // Get activity history
      const activities = await app.db('session_activities')
        .where({ session_id: id })
        .orderBy('recorded_at', 'desc')
        .limit(100)

      return {
        ...session,
        activities,
      }
    },
  )

  // GET /api/v1/sessions/history — only completed (disconnected) sessions
  app.get(
    '/sessions/history',
    { onRequest: [app.authenticate], schema: { tags: ['sessions'], summary: 'Session history', security: [{ bearerAuth: [] }] } },
    async (request) => {
      const query = request.query as { page?: string; limit?: string; user_id?: string; node_id?: string }
      const page = parseInt(query.page ?? '1')
      const limit = Math.min(parseInt(query.limit ?? '20'), 100)
      const offset = (page - 1) * limit

      let queryBuilder = app.db('vpn_sessions as s')
        .join('users as u', 's.user_id', 'u.id')
        .join('vpn_nodes as n', 's.node_id', 'n.id')
        .whereNotNull('s.disconnected_at')

      // Filter by user_id if provided
      if (query.user_id) {
        queryBuilder = queryBuilder.where('s.user_id', query.user_id)
      }

      // Filter by node_id if provided
      if (query.node_id) {
        queryBuilder = queryBuilder.where('s.node_id', query.node_id)
      }

      const sessions = await queryBuilder
        .clone()
        .select(
          's.id',
          'u.username',
          'n.hostname as node_hostname',
          's.vpn_ip',
          's.real_ip',
          's.client_version',
          's.device_name',
          's.bytes_sent',
          's.bytes_received',
          's.connected_at',
          's.disconnected_at',
          's.disconnect_reason',
          's.connection_duration_seconds',
        )
        .orderBy('s.connected_at', 'desc')
        .limit(limit)
        .offset(offset)

      // Count only disconnected sessions (match the same filter)
      const countResult = await queryBuilder
        .clone()
        .count('s.id as count')
        .first()

      const total = Number(countResult?.count || 0)

      return {
        sessions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      }
    },
  )

  // GET /api/v1/sessions/stats  — session statistics
  app.get(
    '/sessions/stats',
    { onRequest: [app.authenticate], schema: { tags: ['sessions'], summary: 'Session statistics', security: [{ bearerAuth: [] }] } },
    async () => {
      const last24h = new Date(Date.now() - (24 * 60 * 60 * 1000))
      const last7d = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))

      // Active sessions count
      const activeCount = await app.db('vpn_sessions')
        .whereNull('disconnected_at')
        .count('* as count')
        .first()

      // Total sessions today
      const todayCount = await app.db('vpn_sessions')
        .where('connected_at', '>=', last24h)
        .count('* as count')
        .first()

      // Total bandwidth today
      const todayBandwidth = await app.db('vpn_sessions')
        .where('connected_at', '>=', last24h)
        .sum('bytes_sent as sent')
        .sum('bytes_received as received')
        .first()

      // Average session duration (last 24h)
      const avgDuration = await app.db('vpn_sessions')
        .whereNotNull('disconnected_at')
        .where('connected_at', '>=', last24h)
        .avg('connection_duration_seconds as avg')
        .first()

      // Top users by bandwidth (last 7 days)
      const topUsers = await app.db('vpn_sessions as s')
        .join('users as u', 's.user_id', 'u.id')
        .where('s.connected_at', '>=', last7d)
        .groupBy('s.user_id', 'u.username')
        .select(
          's.user_id',
          'u.username',
          app.db.raw('SUM(s.bytes_sent + s.bytes_received) as total_bytes'),
          app.db.raw('COUNT(*) as session_count'),
        )
        .orderBy('total_bytes', 'desc')
        .limit(10)

      return {
        active_sessions: activeCount?.count || 0,
        sessions_today: todayCount?.count || 0,
        bandwidth_today: {
          sent: todayBandwidth?.sent || 0,
          received: todayBandwidth?.received || 0,
          total: (todayBandwidth?.sent || 0) + (todayBandwidth?.received || 0),
        },
        avg_duration_seconds: Math.round(avgDuration?.avg || 0),
        top_users: topUsers,
      }
    },
  )

  // POST /api/v1/sessions/:id/kick  — admin kick user
  // Body: { permanent?: boolean }  — if true, blocks reconnect via CCD disable
  app.post<{ Params: { id: string }; Body: { permanent?: boolean } }>(
    '/sessions/:id/kick',
    { 
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Kick active session (admin only)',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            permanent: {
              type: 'boolean',
              description: 'If true, write CCD disable file to block reconnection permanently (until unkicked)',
              default: false,
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Check if user is admin
      const user = request.user as { id: string; username: string; role: string }
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
      }

      const { id } = request.params
      const permanent = request.body?.permanent === true
      const adminUser = user

      const session = await app.db('vpn_sessions')
        .where({ id })
        .whereNull('disconnected_at')
        .first()

      if (!session) {
        return reply.status(404).send({ error: 'Active session not found' })
      }

      const now = new Date()
      const connectedAt = new Date(session.connected_at)
      const durationSeconds = Math.floor((now.getTime() - connectedAt.getTime()) / 1000)

      // Close session in DB
      await app.db('vpn_sessions')
        .where({ id })
        .update({
          disconnected_at: now,
          disconnect_reason: permanent ? 'admin_kick_permanent' : 'admin_kick',
          connection_duration_seconds: durationSeconds,
        })

      // Log audit
      await logAudit(app, {
        userId: adminUser.id,
        username: adminUser.username,
        action: permanent ? 'session_kick_permanent' : 'session_kick',
        resourceType: 'vpn_session',
        resourceId: id,
        ipAddress: getClientIp(request),
        metadata: {
          kicked_user_id: session.user_id,
          node_id: session.node_id,
          permanent,
          session_id: id
        }
      })

      // Look up the kicked user's username for the agent payload
      const kickedUser = await app.db('users').where({ id: session.user_id }).first()
      const commonName = kickedUser?.username ?? null

      // Query for additional payload data needed by WireGuard
      let publicKey: string | null = null
      if (session.user_id && session.node_id) {
        const cert = await app.db('user_node_certificates')
          .where({ user_id: session.user_id, node_id: session.node_id })
          .first()
        if (cert && cert.client_cert) {
          publicKey = cert.client_cert.trim()
        }
      }

      // Dispatch kick task to the node agent so the VPN tunnel is actually dropped
      if (commonName) {
        try {
          await app.db('tasks').insert({
            id: uuidv7(),
            node_id: session.node_id,
            action: 'kick_vpn_session',
            payload: JSON.stringify({ 
              common_name: commonName, 
              permanent,
              public_key: publicKey,
              vpn_ip: kickedUser?.vpn_ip
            }),
            status: 'pending',
            result: null,
            error_message: null,
            created_at: new Date(),
            completed_at: null,
          })
          app.log.info(`[sessions/kick] Enqueued kick_vpn_session (permanent=${permanent}) for ${commonName} on node ${session.node_id}`)
        } catch (taskErr) {
          app.log.error(`[sessions/kick] Failed to enqueue disconnect task: ${(taskErr as Error).message}`)
        }
      } else {
        app.log.warn(`[sessions/kick] Could not resolve username for user_id ${session.user_id}`)
      }

      return {
        ok: true,
        message: permanent ? 'Session kicked and reconnection blocked' : 'Session kicked',
        permanent,
      }
    },
  )

  // POST /api/v1/sessions/:id/unkick  — restore reconnect access after permanent kick
  app.post<{ Params: { id: string } }>(
    '/sessions/:id/unkick',
    {
      onRequest: [app.authenticate],
      schema: { tags: ['sessions'], summary: 'Unkick session — restore reconnect access (admin only)', security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      const user = request.user as { id: string; username: string; role: string }
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
      }

      const { id } = request.params

      // Find session (active or historical)
      const session = await app.db('vpn_sessions').where({ id }).first()
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' })
      }

      const kickedUser = await app.db('users').where({ id: session.user_id }).first()
      const commonName = kickedUser?.username ?? null

      if (!commonName) {
        return reply.status(422).send({ error: 'Could not resolve username for this session' })
      }

      // Query for additional payload data needed by WireGuard
      let publicKey: string | null = null
      if (session.user_id && session.node_id) {
        const cert = await app.db('user_node_certificates')
          .where({ user_id: session.user_id, node_id: session.node_id })
          .first()
        if (cert && cert.client_cert) {
          publicKey = cert.client_cert.trim()
        }
      }

      // If user has a group, fetch netmask for restore
      let netmask = '255.255.255.0'
      if (kickedUser?.vpn_group_id) {
        const group = await app.db('groups').where({ id: kickedUser.vpn_group_id }).first()
        if (group && group.vpn_subnet) {
          const { getNetmask } = await import('../../services/ip-pool.service')
          netmask = getNetmask(group.vpn_subnet)
        }
      }

      // Dispatch unkick task to agent on the node
      try {
        await app.db('tasks').insert({
          id: uuidv7(),
          node_id: session.node_id,
          action: 'unkick_vpn_session',
          payload: JSON.stringify({ 
            common_name: commonName,
            public_key: publicKey,
            vpn_ip: kickedUser?.vpn_ip,
            netmask
          }),
          status: 'pending',
          result: null,
          error_message: null,
          created_at: new Date(),
          completed_at: null,
        })
        app.log.info(`[sessions/unkick] Enqueued unkick_vpn_session for ${commonName} on node ${session.node_id}`)
      } catch (taskErr) {
        app.log.error(`[sessions/unkick] Failed to enqueue unkick task: ${(taskErr as Error).message}`)
        return reply.status(500).send({ error: 'Failed to dispatch unkick task' })
      }

      // Log audit
      await logAudit(app, {
        userId: user.id,
        username: user.username,
        action: 'session_unkick',
        resourceType: 'vpn_session',
        resourceId: id,
        ipAddress: getClientIp(request),
        metadata: { unkicked_user: commonName, node_id: session.node_id, session_id: id }
      })

      return { ok: true, message: `Reconnect access restored for ${commonName}` }
    },
  )
}

export default sessionRoutes
