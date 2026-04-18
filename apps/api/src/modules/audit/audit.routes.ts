import type { FastifyPluginAsync } from 'fastify'

const auditRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/audit/logs  — audit logs
  app.get(
    '/audit/logs',
    { 
      onRequest: [app.authenticate],
      schema: { tags: ['audit'], summary: 'List audit logs (admin only)', security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      // Check if user is admin
      const user = request.user as { role: string }
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
      }
      const query = request.query as { 
        page?: string
        limit?: string
        user_id?: string
        action?: string
        resource_type?: string
        from_date?: string
        to_date?: string
      }
      
      const page = parseInt(query.page ?? '1')
      const limit = Math.min(parseInt(query.limit ?? '50'), 200)
      const offset = (page - 1) * limit

      let queryBuilder = app.db('audit_logs as a')
        .leftJoin('users as u', 'a.user_id', 'u.id')
        .select(
          'a.*',
          'u.username',
          'u.email',
        )

      // Filters
      if (query.user_id) {
        queryBuilder = queryBuilder.where('a.user_id', query.user_id)
      }
      if (query.action) {
        queryBuilder = queryBuilder.where('a.action', query.action)
      }
      if (query.resource_type) {
        queryBuilder = queryBuilder.where('a.resource_type', query.resource_type)
      }
      if (query.from_date) {
        queryBuilder = queryBuilder.where('a.created_at', '>=', query.from_date)
      }
      if (query.to_date) {
        queryBuilder = queryBuilder.where('a.created_at', '<=', query.to_date)
      }

      const logs = await queryBuilder
        .orderBy('a.created_at', 'desc')
        .limit(limit)
        .offset(offset)

      // Get total count (apply same filters)
      const countResult = await queryBuilder.clone()
        .clearSelect()
        .count('* as count')
        .first()

      const total = Number(countResult?.count || 0)

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      }
    },
  )

  // GET /api/v1/audit/connection-attempts  — failed connection attempts
  app.get(
    '/audit/connection-attempts',
    { 
      onRequest: [app.authenticate],
      schema: { tags: ['audit'], summary: 'List failed connection attempts (admin only)', security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      // Check if user is admin
      const user = request.user as { role: string }
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
      }
      const query = request.query as { 
        page?: string
        limit?: string
        user_id?: string
        real_ip?: string
        failure_reason?: string
        from_date?: string
      }
      
      const page = parseInt(query.page ?? '1')
      const limit = Math.min(parseInt(query.limit ?? '50'), 200)
      const offset = (page - 1) * limit

      let queryBuilder = app.db('connection_attempts as ca')
        .leftJoin('users as u', 'ca.user_id', 'u.id')
        .leftJoin('vpn_nodes as n', 'ca.node_id', 'n.id')
        .select(
          'ca.*',
          'u.username as user_username',
          'u.email as user_email',
          'n.hostname as node_hostname',
        )

      // Filters
      if (query.user_id) {
        queryBuilder = queryBuilder.where('ca.user_id', query.user_id)
      }
      if (query.real_ip) {
        queryBuilder = queryBuilder.where('ca.real_ip', query.real_ip)
      }
      if (query.failure_reason) {
        queryBuilder = queryBuilder.where('ca.failure_reason', query.failure_reason)
      }
      if (query.from_date) {
        queryBuilder = queryBuilder.where('ca.attempted_at', '>=', query.from_date)
      }

      const attempts = await queryBuilder
        .orderBy('ca.attempted_at', 'desc')
        .limit(limit)
        .offset(offset)

      // Get total count
      const countResult = await app.db('connection_attempts')
        .modify((qb: any) => {
          if (query.user_id) qb.where('user_id', query.user_id)
          if (query.real_ip) qb.where('real_ip', query.real_ip)
          if (query.failure_reason) qb.where('failure_reason', query.failure_reason)
          if (query.from_date) qb.where('attempted_at', '>=', query.from_date)
        })
        .count('* as count')
        .first()

      const total = Number(countResult?.count || 0)

      return {
        attempts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      }
    },
  )

  // GET /api/v1/audit/connection-attempts/stats  — failed attempts statistics
  app.get(
    '/audit/connection-attempts/stats',
    { 
      onRequest: [app.authenticate],
      schema: { tags: ['audit'], summary: 'Failed connection attempts statistics (admin only)', security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      // Check if user is admin
      const user = request.user as { role: string }
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
      }
      // Total attempts last 24h
      const last24hDate = new Date(Date.now() - (24 * 60 * 60 * 1000))
      const last7dDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))

      // Total attempts last 24h
      const last24h = await app.db('connection_attempts')
        .where('attempted_at', '>=', last24hDate)
        .count('* as count')
        .first()

      // By failure reason
      const byReason = await app.db('connection_attempts')
        .where('attempted_at', '>=', last7dDate)
        .groupBy('failure_reason')
        .select(
          'failure_reason',
          app.db.raw('COUNT(*) as count'),
        )
        .orderBy('count', 'desc')

      // Top IPs with failed attempts
      const topIPs = await app.db('connection_attempts')
        .where('attempted_at', '>=', last7dDate)
        .groupBy('real_ip')
        .select(
          'real_ip',
          app.db.raw('COUNT(*) as count'),
          app.db.raw('MAX(attempted_at) as last_attempt'),
        )
        .orderBy('count', 'desc')
        .limit(10)

      // Top usernames targeted
      const topUsernames = await app.db('connection_attempts')
        .where('attempted_at', '>=', last7dDate)
        .groupBy('username')
        .select(
          'username',
          app.db.raw('COUNT(*) as count'),
        )
        .orderBy('count', 'desc')
        .limit(10)

      return {
        failed_attempts_24h: last24h?.count || 0,
        by_reason: byReason,
        top_ips: topIPs,
        top_usernames: topUsernames,
      }
    },
  )
}

export default auditRoutes
