import { useAuthStore } from '@/store/auth.store'

// Runtime configuration - can be changed without rebuild
function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const runtimeUrl = (window as unknown as { __ENV__?: { VITE_API_URL?: string } }).__ENV__?.VITE_API_URL
    if (runtimeUrl) return runtimeUrl
  }
  return import.meta.env.VITE_API_URL ?? ''
}

export const API_URL = getApiUrl()

// Flag to prevent multiple redirects
let isRedirecting = false

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}

  if (options?.body) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers as Record<string, string>,
    },
    // Send httpOnly cookie on every request (works same-origin in prod,
    // and cross-origin in dev when CORS credentials:true is configured)
    credentials: 'include',
  })

  if (res.status === 401) {
    useAuthStore.getState().logout()
    if (typeof window !== 'undefined' && !isRedirecting && !window.location.pathname.includes('/login')) {
      isRedirecting = true
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
    const error = body as { message?: string; error?: string }
    throw new Error(error.message ?? error.error ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T = void>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
}
