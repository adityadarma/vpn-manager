import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Resolve the client IP for audit logs and connection records.
 *
 * Uses `request.ip`, which Fastify derives from X-Forwarded-For only when the
 * connection comes from a trusted proxy (see TRUST_PROXY). Reading the
 * forwarded headers directly would let any client write an IP of its choice
 * into the audit log.
 *
 * Proxies that terminate the client connection (nginx, Caddy, Traefik,
 * Cloudflare Tunnel) all set X-Forwarded-For, so no provider-specific header
 * is needed.
 */
export function getClientIp(request: FastifyRequest): string {
  return request.ip
}

export async function logAudit(
  app: FastifyInstance,
  options: {
    userId?: string | null
    username: string
    action: string
    resourceType: string
    resourceId?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, any>
  },
) {
  try {
    // Skip stale user references, but retain system and node lifecycle events.
    const userExists = options.userId
      ? await app.db('users').where({ id: options.userId }).first()
      : true
    if (!userExists) {
      app.log.warn(
        `[audit] Skipping audit log — user_id '${options.userId}' not found in users table`,
      )
      return
    }

    await app.db('audit_logs').insert({
      id: uuidv7(),
      user_id: options.userId || null,
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
    app.realtime.publish(`${options.resourceType}.updated`, options.resourceId)
    app.realtime.publish('audit.created')
  } catch (err) {
    app.log.error(err, 'Failed to write audit log')
  }
}
