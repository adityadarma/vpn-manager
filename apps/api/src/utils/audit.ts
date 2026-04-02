import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Resolve the real client IP from any reverse proxy setup.
 *
 * Header priority (first non-empty value wins):
 *   1. CF-Connecting-IP  — Cloudflare Tunnel / CDN
 *   2. X-Real-IP         — Nginx / Nginx Proxy Manager / HAProxy
 *   3. X-Forwarded-For   — Standard header (all proxies); we take the FIRST hop
 *   4. request.ip        — Fastify socket IP (works when trustProxy:true is set)
 *
 * Works out-of-the-box with: Cloudflare Tunnel, Nginx Proxy Manager, Traefik, Caddy, HAProxy, etc.
 */
export function getClientIp(request: FastifyRequest): string {
  // 1. Cloudflare: sets a single clean IP
  const cfIp = request.headers['cf-connecting-ip']
  if (cfIp && typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim()

  // 2. Nginx / standard proxies: X-Real-IP is a single clean IP
  const realIp = request.headers['x-real-ip']
  if (realIp && typeof realIp === 'string' && realIp.trim()) return realIp.trim()

  // 3. X-Forwarded-For: may be comma-separated chain "clientIp, proxy1, proxy2"
  //    We only trust the FIRST value (leftmost = original client)
  const forwarded = request.headers['x-forwarded-for']
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
    if (first) return first
  }

  // 4. Fallback to socket IP (already resolved by Fastify trustProxy)
  return request.ip
}

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
      id: uuidv7(),
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
