import type { FastifyInstance } from 'fastify'

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
