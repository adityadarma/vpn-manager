import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'

export async function logAudit(
  app: FastifyInstance,
  options: {
    userId: string
    username: string
    action: string
    resourceType: string
    resourceId?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, any>
  }
) {
  try {
    await app.db('audit_logs').insert({
      id: crypto.randomUUID(),
      user_id: options.userId,
      username: options.username,
      action: options.action,
      resource_type: options.resourceType,
      resource_id: options.resourceId || null,
      session_id: null,
      ip_address: options.ipAddress || null,
      user_agent: options.userAgent || null,
      metadata: options.metadata ? JSON.stringify(options.metadata) : null,
      created_at: new Date(),
    })
  } catch (err) {
    app.log.error(err, 'Failed to write audit log')
  }
}
