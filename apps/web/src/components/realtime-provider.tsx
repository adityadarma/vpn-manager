import { createContext, useContext, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_URL } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'

interface RealtimeEvent {
  type: string
  entityId?: string
  occurredAt: string
}

const queryKeysByEvent: Record<string, string[]> = {
  vpn_session: ['sessions', 'sessions-stats', 'session-stats', 'nodes', 'tasks'],
  node: ['nodes', 'sessions', 'sessions-stats', 'session-stats', 'tasks'],
  task: ['tasks', 'nodes', 'users', 'dns-zones', 'dns-records', 'dns-policies'],
  audit: ['audit-logs', 'audit-attempts', 'audit-attempt-stats', 'profile-audit-logs'],
  dns: [
    'dns-zones',
    'dns-records',
    'dns-policies',
    'group-allocations',
    'group-dns-zones',
    'nodes',
  ],
  dns_zone: ['dns-zones', 'dns-records', 'dns-policies', 'group-dns-zones'],
  dns_record: ['dns-zones', 'dns-records'],
  dns_policy: ['dns-policies', 'dns-zones', 'groups'],
  user: ['users', 'user', 'profile-certs', 'expiring-certs', 'sessions', 'tasks'],
  certificate: ['users', 'user-certificates', 'profile-certs', 'expiring-certs', 'nodes', 'tasks'],
  network: [
    'networks',
    'group-allocations',
    'group-node-dns',
    'groups',
    'policies',
    'nodes',
    'tasks',
  ],
  group_node_allocation: [
    'networks',
    'group-allocations',
    'group-node-dns',
    'groups',
    'nodes',
    'tasks',
  ],
  policy: ['policies', 'networks', 'groups', 'nodes', 'tasks'],
  group: ['groups', 'users', 'networks', 'policies', 'group-allocations', 'nodes', 'tasks'],
}

const RealtimeConnectionContext = createContext(false)

export function useRealtimeConnected(): boolean {
  return useContext(RealtimeConnectionContext)
}

function keysForEvent(type: string): string[] {
  const domain = type.split('.')[0]
  return [...new Set([...(queryKeysByEvent[domain] ?? []), 'audit-logs'])]
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!user) {
      setIsConnected(false)
      return
    }

    const source = new EventSource(`${API_URL}/api/v1/events`, { withCredentials: true })
    source.onopen = () => setIsConnected(true)
    source.onerror = () => setIsConnected(false)
    source.addEventListener('update', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as RealtimeEvent
      for (const key of keysForEvent(event.type)) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    })
    return () => {
      source.close()
      setIsConnected(false)
    }
  }, [queryClient, user])

  return <RealtimeConnectionContext value={isConnected}>{children}</RealtimeConnectionContext>
}
