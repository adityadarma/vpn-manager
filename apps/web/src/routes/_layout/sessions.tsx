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
  Clock, Globe, Server, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatBrowserDateTime } from '@vpn/shared'

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
      setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    setOpen((prev) => !prev)
  }

  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="relative inline-flex" ref={ref}>
      <div className="inline-flex items-stretch rounded-lg shadow-sm border border-red-500/30 bg-red-500/10 transition-all hover:border-red-500/50 hover:bg-red-500/15">
        {/* Main kick button */}
        <button
          onClick={() => {
            if (confirm(`Disconnect ${username}?\n\nUser will be able to reconnect after.`)) {
              onKick(sessionId, false)
            }
          }}
          disabled={isPending}
          title="Disconnect session"
          className="h-8 px-2.5 flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserX className="h-3.5 w-3.5" />
          )}
          <span>Kick</span>
        </button>

        {/* Dropdown trigger */}
        <button
          ref={triggerRef}
          onClick={openMenu}
          disabled={isPending}
          title="More options"
          className={`h-8 px-1.5 flex items-center text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border-l border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50 ${open ? 'bg-red-500/25' : ''}`}
        >
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Fixed-position menu — escapes overflow:hidden on the table container */}
      {open && (
        <div
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
          className="w-56 bg-card text-card-foreground rounded-xl shadow-2xl border border-border/80 p-1.5 text-sm animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            className="w-full text-left p-2 rounded-lg hover:bg-muted/70 flex items-center gap-3 text-foreground transition-colors group"
            onClick={() => {
              setOpen(false)
              if (confirm(`Disconnect ${username}?\n\nUser will be able to reconnect after.`)) {
                onKick(sessionId, false)
              }
            }}
          >
            <div className="h-8 w-8 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 group-hover:bg-red-500/20 transition-colors">
              <UserX className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium text-xs text-foreground">Kick (Temporary)</div>
              <div className="text-[11px] text-muted-foreground/80">Disconnect, allow reconnect</div>
            </div>
          </button>

          <div className="my-1 border-t border-border/60" />

          <button
            className="w-full text-left p-2 rounded-lg hover:bg-red-500/10 flex items-center gap-3 text-red-600 dark:text-red-400 transition-colors group"
            onClick={() => {
              setOpen(false)
              if (confirm(`Permanently block ${username}?\n\nUser will NOT be able to reconnect until an admin unkicks them.`)) {
                onKick(sessionId, true)
              }
            }}
          >
            <div className="h-8 w-8 rounded-lg bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 group-hover:bg-red-500/30 transition-colors">
              <ShieldOff className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-xs text-red-600 dark:text-red-400">Kick & Block</div>
              <div className="text-[11px] text-red-500/70">Disconnect + block reconnect</div>
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
    admin_kick:           { label: 'Kicked',          className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
    admin_kick_permanent: { label: 'Blocked',         className: 'bg-red-500/20 text-red-700 dark:text-red-400 font-semibold border border-red-500/20' },
    timeout:              { label: 'Timeout',         className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    reconnect:            { label: 'Reconnected',     className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
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
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="text-left px-5 py-3.5">User</th>
                    <th className="text-left px-5 py-3.5">Device</th>
                    <th className="text-left px-5 py-3.5">Location</th>
                    <th className="text-left px-5 py-3.5 min-w-[11rem]">Node</th>
                    <th className="text-left px-5 py-3.5">VPN IP</th>
                    <th className="text-left px-5 py-3.5">Duration</th>
                    <th className="text-left px-5 py-3.5">Traffic</th>
                    <th className="text-center px-4 py-3.5">Status</th>
                    <th className="text-right px-5 py-3.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs shrink-0 border border-primary/20">
                            {s.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground text-sm tracking-tight">{s.username}</div>
                            {s.real_ip && (
                              <div className="text-[11px] text-muted-foreground font-mono tracking-tight flex items-center gap-1 mt-0.5">
                                <Globe className="h-3 w-3 opacity-60 shrink-0" />
                                {s.real_ip}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground shrink-0 border border-border/40">
                            <Monitor className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-foreground text-xs font-medium">{s.device_name || 'Unknown'}</div>
                            {s.client_version && (
                              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{s.client_version}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        {s.geo_city || s.geo_country ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/40 border border-border/50 text-foreground text-xs font-medium">
                            <MapPin className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                            <span>
                              {s.geo_city && s.geo_country ? `${s.geo_city}, ${s.geo_country}` : s.geo_country || s.geo_city}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4 min-w-[11rem]">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                          <div>
                            <div className="text-foreground text-xs font-medium">{s.node_hostname}</div>
                            {s.node_region && <div className="text-[10px] text-muted-foreground">{s.node_region}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                          {s.vpn_ip}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-muted-foreground text-xs">
                        <div className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 opacity-60 shrink-0" />
                          <span>{formatDuration(s.connected_at, null, s.duration_seconds)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-muted/40 border border-border/40 text-xs font-mono">
                          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                            <ArrowUp className="h-3 w-3" /> {formatBytes(s.bytes_sent)}
                          </span>
                          <span className="text-border">/</span>
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <ArrowDown className="h-3 w-3" /> {formatBytes(s.bytes_received)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          Connected
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <KickDropdown
                          sessionId={s.id}
                          username={s.username}
                          onKick={handleKick}
                          isPending={kickMutation.isPending}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
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
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="text-left px-5 py-3.5">User</th>
                      <th className="text-left px-5 py-3.5">Device</th>
                      <th className="text-left px-5 py-3.5 min-w-[11rem]">Node</th>
                      <th className="text-left px-5 py-3.5">VPN IP</th>
                      <th className="text-left px-5 py-3.5 whitespace-nowrap">Connected</th>
                      <th className="text-left px-5 py-3.5 whitespace-nowrap">Duration</th>
                      <th className="text-left px-5 py-3.5">Traffic</th>
                      <th className="text-right px-5 py-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {history.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/40 transition-colors">
                        <td className="px-5 py-4 min-w-[11rem]">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs shrink-0 border border-primary/20">
                              {s.username.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-foreground text-sm tracking-tight">{s.username}</div>
                              {s.real_ip && (
                                <div className="text-[11px] text-muted-foreground font-mono tracking-tight flex items-center gap-1 mt-0.5">
                                  <Globe className="h-3 w-3 opacity-60 shrink-0" />
                                  {s.real_ip}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground shrink-0 border border-border/40">
                              <Monitor className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-foreground text-xs font-medium">{s.device_name || 'Unknown'}</div>
                              {s.client_version && (
                                <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{s.client_version}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                            <span className="text-foreground text-xs font-medium">{s.node_hostname}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-muted/60 text-foreground border border-border/40 font-medium">
                            {s.vpn_ip}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground text-xs whitespace-nowrap tabular-nums min-w-[140px]">
                          {formatBrowserDateTime(s.connected_at)}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground text-xs whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 opacity-60 shrink-0" />
                            <span>{formatDuration(s.connected_at, s.disconnected_at, s.connection_duration_seconds)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-muted/40 border border-border/40 text-xs font-mono">
                            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                              <ArrowUp className="h-3 w-3" /> {formatBytes(s.bytes_sent)}
                            </span>
                            <span className="text-border">/</span>
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              <ArrowDown className="h-3 w-3" /> {formatBytes(s.bytes_received)}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
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
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/30 transition-all shadow-sm disabled:opacity-50"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
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
              </div>

              {/* Pagination */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
