import type { FastifyRequest } from 'fastify'

/**
 * The one place that decides which credential a request carries.
 *
 * Signature verification, the revocation check, and logout must all look at the
 * same token. They used to disagree: @fastify/jwt prefers the `Authorization`
 * header over the cookie, while the revocation check preferred the cookie. A
 * request holding a revoked token in the header plus any other value in the
 * cookie therefore passed verification and skipped the revocation lookup.
 *
 * Order matches @fastify/jwt: a `Bearer` header wins, otherwise the cookie.
 * A malformed `Bearer` header yields no token instead of falling back to the
 * cookie.
 */
export function extractRequestToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization
  if (authorization && /^Bearer\s/i.test(authorization)) {
    const parts = authorization.split(' ')
    return parts.length === 2 && parts[1] ? parts[1] : undefined
  }
  return request.cookies?.['vpn_token'] || undefined
}
