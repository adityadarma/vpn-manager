import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real store persists to localStorage, which does not exist under Node.
const logout = vi.fn()
vi.mock('@/store/auth.store', () => ({
  useAuthStore: { getState: () => ({ logout }) },
}))

import { api } from './api'

type Call = { url: string; init: RequestInit }

let calls: Call[]

function respondWith(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

const headersOf = (call: Call) => (call.init.headers ?? {}) as Record<string, string>

beforeEach(() => {
  calls = []
  logout.mockClear()
  respondWith(200, { ok: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api request framing', () => {
  // A body-less POST has no Content-Type. Reverse proxies forward it as
  // `Transfer-Encoding: chunked`, which the API used to reject with 415
  // (Managed DNS Sync, node Restore).
  it('sends a JSON {} body on POST without a payload', async () => {
    await api.post('/api/v1/nodes/n1/dns/sync')
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.body).toBe('{}')
    expect(headersOf(calls[0]!)['Content-Type']).toBe('application/json')
  })

  it('sends the given payload as JSON on POST', async () => {
    await api.post('/api/v1/tasks', { action: 'x', payload: { a: 1 } })
    expect(calls[0]!.init.body).toBe('{"action":"x","payload":{"a":1}}')
    expect(headersOf(calls[0]!)['Content-Type']).toBe('application/json')
  })

  it.each([
    ['PUT', () => api.put('/api/v1/nodes/n1/config', { port: 1194 })],
    ['PATCH', () => api.patch('/api/v1/groups/g1', { name: 'eng' })],
  ])('sends a JSON body with Content-Type on %s', async (method, call) => {
    await call()
    expect(calls[0]!.init.method).toBe(method)
    expect(typeof calls[0]!.init.body).toBe('string')
    expect(headersOf(calls[0]!)['Content-Type']).toBe('application/json')
  })

  it.each([
    ['GET', () => api.get('/api/v1/nodes')],
    ['DELETE', () => api.delete('/api/v1/nodes/n1')],
  ])('sends no body and no Content-Type on %s', async (_method, call) => {
    await call()
    expect(calls[0]!.init.body).toBeUndefined()
    expect(headersOf(calls[0]!)['Content-Type']).toBeUndefined()
  })

  it('always sends cookies', async () => {
    await api.post('/api/v1/nodes/n1/restore')
    expect(calls[0]!.init.credentials).toBe('include')
  })
})

describe('api responses', () => {
  it('returns undefined for 204 No Content', async () => {
    respondWith(204)
    await expect(api.delete('/api/v1/nodes/n1')).resolves.toBeUndefined()
  })

  it('throws the server message on an error response', async () => {
    respondWith(415, { error: 'Unsupported Media Type', message: 'Unsupported Media Type' })
    await expect(api.post('/api/v1/nodes/n1/dns/sync')).rejects.toThrow('Unsupported Media Type')
  })

  it('falls back to the error field when there is no message', async () => {
    respondWith(409, { error: 'Managed DNS is disabled for this node' })
    await expect(api.post('/api/v1/nodes/n1/dns/sync')).rejects.toThrow(
      'Managed DNS is disabled for this node',
    )
  })

  it('logs out on 401', async () => {
    respondWith(401, { error: 'Unauthorized' })
    await expect(api.get('/api/v1/auth/me')).rejects.toThrow('Unauthorized')
    expect(logout).toHaveBeenCalledOnce()
  })
})
