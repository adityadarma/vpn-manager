import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/sessions')({
  component: SessionsPage,
})

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  Activity, ArrowUp, ArrowDown, History, ChevronLeft, ChevronRight,
  Monitor, MapPin, UserX, ShieldOff, ShieldCheck, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Session {
  id: string
  user_id: string
  username: string
  email?: string
  node_id: string
  node_hostname: string
  node_region?: string
  vpn_ip: string
  real_ip?: string
  client_version?: string
  device_name?: string
  geo_country?: string
  geo_city?: string
  bytes_sent: number
  bytes_received: number
  connected_at: string
  disconnected_at?: string | null
  last_activity_at?: string
  disconnect_reason?: string
  connection_duration_seconds?: number
  duration_seconds?: number
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(since: string, until?: string | null, durationSeconds?: number) {
  if (durationSeconds !== undefined && durationSeconds !== null) {
    const m = Math.floor(durationSeconds / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    if (h > 0) return `${h}h ${m % 60}m`
    if (m === 0) return '< 1m'
    return `${m}m`
  }
  const start = new Date(since).getTime()
  const end = until ? new Date(until).getTime() : Date.now()
  const ms = end - start
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m === 0) return '< 1m'
  return `${m}m`
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── KickDropdown ─────────────────────────────────────────────────────────────
interface KickDropdownProps {
  sessionId: string
  username: string
  onKick: (sessionId: string, permanent: boolean) => void
  isPending: boolean
}

function KickDropdown({ sessionId, username, onKick, isPending }: KickDropdownProps) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const ref = useRef<HTMLDivElement>(null)

  function openMenu() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener('mousedown', (e) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    })
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center">
        {/* Main kick button */}
        <button
          onClick={() => {
            if (confirm(`Disconnect ${username}?`)) onKick(sessionId, false)
          }}
          disabled={isPending}
          title="Kick session"
          className="h-8 px-2 flex items-center gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-l-md border border-red-200 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <UserX className="h-3.5 w-3.5" />
          Kick
        </button>

        {/* Dropdown trigger */}
        <button
          ref={triggerRef}
          onClick={openMenu}
          disabled={isPending}
          className="h-8 px-1 flex items-center text-red-600 hover:text-red-700 hover:bg-red-50 rounded-r-md border border-l-0 border-red-200 transition-colors disabled:opacity-50"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Fixed-position menu — escapes overflow:hidden on the table container */}
      {open && (
        <div
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
          className="w-48 bg-card text-card-foreground rounded-lg shadow-xl border border-border py-1 text-sm"
        >
          <button
            className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-foreground"
            onClick={() => {
              setOpen(false)
              if (confirm(`Disconnect ${username}?\n\nUser will be able to reconnect after.`)) {
                onKick(sessionId, false)
              }
            }}
          >
            <UserX className="h-4 w-4 text-red-500" />
            <div>
              <div className="font-medium">Kick</div>
              <div className="text-xs text-muted-foreground/70">Disconnect, allow reconnect</div>
            </div>
          </button>
          <div className="my-1 border-t border-border/50" />
          <button
            className="w-full text-left px-3 py-2 hover:bg-red-50 flex items-center gap-2 text-red-700"
            onClick={() => {
              setOpen(false)
              if (confirm(`Permanently block ${username}?\n\nUser will NOT be able to reconnect until an admin unkicks them.`)) {
                onKick(sessionId, true)
              }
            }}
          >
            <ShieldOff className="h-4 w-4 text-red-600" />
            <div>
              <div className="font-medium">Kick & Block</div>
              <div className="text-xs text-red-400">Disconnect + block reconnect</div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}


// ── DisconnectReasonBadge ────────────────────────────────────────────────────
function DisconnectReasonBadge({ reason }: { reason?: string }) {
  if (!reason) return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">Disconnected</span>

  const map: Record<string, { label: string; className: string }> = {
    normal:               { label: 'Disconnected',   className: 'bg-muted text-muted-foreground' },
    admin_kick:           { label: 'Kicked',          className: 'bg-red-100 text-red-700' },
    admin_kick_permanent: { label: 'Blocked',         className: 'bg-red-200 text-red-800 font-semibold' },
    timeout:              { label: 'Timeout',         className: 'bg-yellow-100 text-yellow-700' },
    reconnect:            { label: 'Reconnected',     className: 'bg-blue-100 text-blue-700' },
  }

  const style = map[reason] ?? { label: reason, className: 'bg-muted text-muted-foreground' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.className}`}>
      {reason === 'admin_kick_permanent' && <ShieldOff className="h-3 w-3" />}
      {style.label}
    </span>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
function SessionsPage() {
  const [page, setPage] = useState(1)
  const limit = 20
  const queryClient = useQueryClient()

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => api.get('/api/v1/sessions'),
    refetchInterval: 15_000,
  })

  const { data: historyData, isLoading: isLoadingHistory } = useQuery<{ sessions: Session[]; pagination: any }>({
    queryKey: ['sessions', 'history', page],
    queryFn: () => api.get(`/api/v1/sessions/history?page=${page}&limit=${limit}`),
  })

  const kickMutation = useMutation({
    mutationFn: ({ sessionId, permanent }: { sessionId: string; permanent: boolean }) =>
      api.post(`/api/v1/sessions/${sessionId}/kick`, { permanent }),
    onSuccess: (_data, { permanent }) => {
      toast.success(permanent ? 'Session kicked and reconnection blocked' : 'Session kicked successfully')
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['sessions', 'history'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to kick session'),
  })

  const unkickMutation = useMutation({
    mutationFn: (sessionId: string) => api.post(`/api/v1/sessions/${sessionId}/unkick`, {}),
    onSuccess: () => {
      toast.success('Reconnect access restored')
      queryClient.invalidateQueries({ queryKey: ['sessions', 'history'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to unkick session'),
  })

  const handleKick = (sessionId: string, permanent: boolean) => {
    kickMutation.mutate({ sessionId, permanent })
  }

  const history = historyData?.sessions || []
  const pagination = historyData?.pagination

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">VPN Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor active connections and view history</p>
      </div>

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList>
          <TabsTrigger value="active" className="gap-2">
            <Activity className="h-4 w-4" />
            Active ({sessions.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Active Sessions Tab */}
        <TabsContent value="active" className="space-y-4">
          <div className="flex items-center justify-end">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted text-muted-foreground text-xs font-medium rounded-full">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              Auto-refresh 15s
            </span>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground/70">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border p-16 text-center">
              <Activity className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="font-medium text-foreground">No active sessions</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Sessions will appear here when users connect</p>
            </div>
          ) : (
            <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Device</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">VPN IP</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Duration</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Traffic</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-4">
                        <div>
                          <div className="font-medium text-foreground">{s.username}</div>
                          {s.real_ip && <div className="text-xs text-muted-foreground/70 font-mono">{s.real_ip}</div>}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-2">
                          <Monitor className="h-4 w-4 text-muted-foreground/70 mt-0.5" />
                          <div>
                            <div className="text-foreground text-xs">{s.device_name || 'Unknown'}</div>
                            {s.client_version && <div className="text-xs text-muted-foreground/70">{s.client_version}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {s.geo_city || s.geo_country ? (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground/70" />
                            <span className="text-xs">
                              {s.geo_city && s.geo_country ? `${s.geo_city}, ${s.geo_country}` : s.geo_country || s.geo_city}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div>
                          <div className="text-foreground">{s.node_hostname}</div>
                          {s.node_region && <div className="text-xs text-muted-foreground/70">{s.node_region}</div>}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-muted-foreground text-xs">{s.vpn_ip}</td>
                      <td className="px-5 py-4 text-muted-foreground">{formatDuration(s.connected_at, null, s.duration_seconds)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="flex items-center gap-1 text-blue-500">
                            <ArrowUp className="h-3 w-3" /> {formatBytes(s.bytes_sent)}
                          </span>
                          <span className="text-gray-300">/</span>
                          <span className="flex items-center gap-1 text-emerald-500">
                            <ArrowDown className="h-3 w-3" /> {formatBytes(s.bytes_received)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                            Connected
                          </span>
                          <KickDropdown
                            sessionId={s.id}
                            username={s.username}
                            onKick={handleKick}
                            isPending={kickMutation.isPending}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          {isLoadingHistory ? (
            <div className="text-center py-12 text-muted-foreground/70">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border p-16 text-center">
              <History className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="font-medium text-foreground">No session history</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Past connections will appear here</p>
            </div>
          ) : (
            <>
              <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Device</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">VPN IP</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connected</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Duration</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Traffic</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-5 py-4">
                          <div>
                            <div className="font-medium text-foreground">{s.username}</div>
                            {s.real_ip && <div className="text-xs text-muted-foreground/70 font-mono">{s.real_ip}</div>}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-2">
                            <Monitor className="h-4 w-4 text-muted-foreground/70 mt-0.5" />
                            <div>
                              <div className="text-foreground text-xs">{s.device_name || 'Unknown'}</div>
                              {s.client_version && <div className="text-xs text-muted-foreground/70">{s.client_version}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">{s.node_hostname}</td>
                        <td className="px-5 py-4 font-mono text-muted-foreground text-xs">{s.vpn_ip}</td>
                        <td className="px-5 py-4 text-muted-foreground text-xs">{formatDateTime(s.connected_at)}</td>
                        <td className="px-5 py-4 text-muted-foreground">
                          {formatDuration(s.connected_at, s.disconnected_at, s.connection_duration_seconds)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="flex items-center gap-1 text-blue-500">
                              <ArrowUp className="h-3 w-3" /> {formatBytes(s.bytes_sent)}
                            </span>
                            <span className="text-gray-300">/</span>
                            <span className="flex items-center gap-1 text-emerald-500">
                              <ArrowDown className="h-3 w-3" /> {formatBytes(s.bytes_received)}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <DisconnectReasonBadge reason={s.disconnect_reason} />
                            {/* Unkick button — only shown for permanently blocked sessions */}
                            {s.disconnect_reason === 'admin_kick_permanent' && (
                              <button
                                onClick={() => {
                                  if (confirm(`Restore reconnect access for ${s.username}?\n\nThey will be able to connect to VPN again.`)) {
                                    unkickMutation.mutate(s.id)
                                  }
                                }}
                                disabled={unkickMutation.isPending}
                                title="Restore reconnect access"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full border border-emerald-200 transition-colors disabled:opacity-50"
                              >
                                <ShieldCheck className="h-3 w-3" />
                                Unkick
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {pagination ? (
                    <>Page {pagination.page} of {pagination.pages} • {pagination.total} total sessions</>
                  ) : (
                    <>Page {page} • Showing {history.length} sessions</>
                  )}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={pagination ? page >= pagination.pages : history.length < limit}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
