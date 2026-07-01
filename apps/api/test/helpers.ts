import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { v7 as uuidv7 } from 'uuid'
import '../src/plugins/db'
function normalizeCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) {
    throw new Error('Missing set-cookie header')
  }

  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const pairs = cookies.map((cookie) => cookie.split(';')[0]).filter(Boolean)
  if (pairs.length === 0) {
    throw new Error('No cookie pairs found in set-cookie header')
  }

  return pairs.join('; ')
}

export async function loginAsAdmin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'Admin@1234!' },
  })

  if (res.statusCode !== 200) {
    throw new Error(`Login failed with status ${res.statusCode}: ${res.body}`)
  }

  return normalizeCookieHeader(res.headers['set-cookie'])
}

/**
 * Create a non-admin user and return their auth cookie.
 * Used to verify admin-only routes reject regular users.
 */
export async function loginAsUser(
  app: FastifyInstance,
  username = 'regular_user',
  password = 'User@1234!',
): Promise<string> {
  const existing = await app.db('users').where({ username }).first()
  if (!existing) {
    await app.db('users').insert({
      id: uuidv7(),
      username,
      email: `${username}@vpn.local`,
      password: await bcrypt.hash(password, 10),
      role: 'user',
      is_active: true,
    })
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  })

  if (res.statusCode !== 200) {
    throw new Error(`User login failed with status ${res.statusCode}: ${res.body}`)
  }

  return normalizeCookieHeader(res.headers['set-cookie'])
}
