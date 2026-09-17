import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  Activity,
  ArrowUp,
  ArrowDown,
  History,
  ChevronLeft,
  ChevronRight,
  Monitor,
  UserX,
  ShieldOff,
  ShieldCheck,
  Clock,
  Globe,
  Server,
  RefreshCw,
  Search,
  X,
  Eye,
  Radio,
  Users,
  Timer,
  AlertTriangle,
  Info,
  Layers,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBrowserDateTime, type VpnNode } from '@vpn/shared'

export const Route = createFileRoute('/_layout/sessions')({
  component: SessionsPage,
})

interface Session {
  id: string
  user_id: string
  name: string
  email?: string
  node_id: string
  node_hostname: string
  node_region?: string
  vpn_ip: string
  real_ip?: string
  client_version?: string
  device_name?: string
  bytes_sent: number
  bytes_received: number
  connected_at: string
  disconnected_at?: string | null
  last_activity_at?: string
  disconnect_reason?: string
  connection_duration_seconds?: number
  duration_seconds?: number
}

interface SessionStats {
  active_sessions: number
  sessions_today: number
  bandwidth_today: {
    sent: number
    received: number
    total: number
  }
  avg_duration_seconds: number
  top_users?: Array<{
    user_id: string
    name: string
    total_bytes: number
    session_count: number
  }>
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(since: string, until?: string | null, durationSeconds?: number) {
  if (durationSeconds !== undefined && durationSeconds !== null) {
    const m = Math.floor(durationSeconds / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    if (h > 0) return `${h}h ${m % 60}m`
    if (m === 0) return `${durationSeconds}s`
    return `${m}m`
  }
  const start = new Date(since).getTime()
  const end = until ? new Date(until).getTime() : Date.now()
  const ms = end - start
  if (ms < 0) return '—'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

function formatDurationFromSeconds(seconds: number) {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m === 0) return `${seconds}s`
  return `${m}m`
}

const disconnectReasonConfig: Record<string, { label: string; description: string; className: string }> = {
  normal: {
    label: 'Disconnected',
    description: 'The client ended the VPN session normally',
    className: 'bg-muted text-muted-foreground border-border/70',
  },
  reconnect: {
    label: 'Reconnected',
    description: 'Replaced by a newer connection from the same credential',
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  timeout: {
    label: 'Timed Out',
    description: 'The VPN connection stopped responding and timed out',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  heartbeat_timeout: {
    label: 'Node Unreachable',
    description: 'The node stopped reporting this active session',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  admin_kick: {
    label: 'Kicked (5m)',
    description: 'Temporarily disconnected and blocked by administrator',
    className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  },
  admin_kick_permanent: {
    label: 'Blocked (Permanent)',
    description: 'Disconnected and blocked until an administrator restores access',
    className: 'bg-red-500/20 text-red-700 dark:text-red-400 font-semibold border-red-500/30',
  },
  node_decommissioned: {
    label: 'Node Archived',
    description: 'Disconnected because the VPN node was archived',
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
  },
  cert_revoked: {
    label: 'Credential Revoked',
    description: 'Disconnected because this VPN credential was revoked',
    className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  },
  cert_expired: {
    label: 'Credential Expired',
    description: 'Disconnected because this VPN credential expired',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  user_disabled: {
    label: 'User Disabled',
    description: 'Disconnected because the user account was disabled',
    className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  },
}

// eslint-disable-next-line react-refresh/only-export-components
function DisconnectReasonBadge({ reason }: { reason?: string }) {
  if (!reason) {
    return (
      <Badge variant="outline" className="text-[11px] font-medium bg-muted text-muted-foreground border-border/70">
        Disconnected
      </Badge>
    )
  }

  const config = disconnectReasonConfig[reason] ?? {
    label: 'Disconnected',
    description: `Disconnect reason: ${reason}`,
    className: 'bg-muted text-muted-foreground border-border/70',
  }

  return (
    <Badge
      variant="outline"
      title={config.description}
      className={`text-[11px] font-medium gap-1 ${config.className}`}
    >
      {reason === 'admin_kick_permanent' && <ShieldOff className="size-3 shrink-0" />}
      {config.label}
    </Badge>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function SessionsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')

  // Search & Node Filter State for Active Tab
  const [activeSearch, setActiveSearch] = useState('')
  const [activeNodeFilter, setActiveNodeFilter] = useState('')

  // History Tab Filter & Pagination State
  const [historyPage, setHistoryPage] = useState(1)
  const [historySearch, setHistorySearch] = useState('')
  const [historyNodeFilter, setHistoryNodeFilter] = useState('')
  const [historyReasonFilter, setHistoryReasonFilter] = useState<string>('all')
  const historyLimit = 10

  // Modals state
  const [inspectSession, setInspectSession] = useState<Session | null>(null)
  const [blockTarget, setBlockTarget] = useState<Session | null>(null)
  const [blockDurationMode, setBlockDurationMode] = useState<'5m' | 'permanent'>('5m')
  const [unkickTarget, setUnkickTarget] = useState<Session | null>(null)

  // 1. Fetch Nodes for filter dropdowns
  const { data: nodes = [] } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  // 2. Fetch High-Level Session Stats
  const { data: stats, isFetching: isFetchingStats, refetch: refetchStats } = useQuery<SessionStats>({
    queryKey: ['sessions-stats'],
    queryFn: () => api.get('/api/v1/sessions/stats'),
    refetchInterval: 15_000,
  })

  // 3. Fetch Active Sessions
  const {
    data: activeSessions = [],
    isLoading: isLoadingActive,
    isFetching: isFetchingActive,
    refetch: refetchActive,
  } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => api.get('/api/v1/sessions'),
    refetchInterval: 15_000,
  })

  // 4. Fetch History Sessions
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    isFetching: isFetchingHistory,
    isPlaceholderData: isPlaceholderHistory,
    refetch: refetchHistory,
  } = useQuery<{ sessions: Session[]; pagination: { page: number; limit: number; total: number; pages: number } }>({
    queryKey: ['sessions', 'history', historyPage, historyNodeFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        page: historyPage.toString(),
        limit: historyLimit.toString(),
      })
      if (historyNodeFilter) {
        params.append('node_id', historyNodeFilter)
      }
      return api.get(`/api/v1/sessions/history?${params}`)
    },
    placeholderData: keepPreviousData,
  })

  const pagination = historyData?.pagination

  // Mutations
  const kickMutation = useMutation({
    mutationFn: ({
      sessionId,
      permanent,
      blockDurationSeconds,
    }: {
      sessionId: string
      permanent: boolean
      blockDurationSeconds?: number
    }) =>
      api.post(`/api/v1/sessions/${sessionId}/kick`, { permanent, blockDurationSeconds }),
    onSuccess: (_data, { permanent }) => {
      toast.success(permanent ? 'Session permanently blocked until Unkick' : 'Session blocked for 5 minutes')
      setBlockTarget(null)
      if (inspectSession) setInspectSession(null)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['sessions', 'history'] })
      queryClient.invalidateQueries({ queryKey: ['sessions-stats'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to block session'),
  })

  const unkickMutation = useMutation({
    mutationFn: (sessionId: string) => api.post(`/api/v1/sessions/${sessionId}/unkick`, {}),
    onSuccess: () => {
      toast.success('Reconnect access restored successfully')
      setUnkickTarget(null)
      if (inspectSession) setInspectSession(null)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['sessions', 'history'] })
      queryClient.invalidateQueries({ queryKey: ['sessions-stats'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to unkick session'),
  })

  // Manual refresh both
  const handleManualRefresh = () => {
    refetchStats()
    refetchActive()
    refetchHistory()
    toast.success('Sessions refreshed')
  }

  const isRefreshing = isFetchingStats || isFetchingActive || isFetchingHistory

  // Filtered Active Sessions
  const filteredActive = useMemo(() => {
    return activeSessions.filter((s) => {
      if (activeNodeFilter && s.node_id !== activeNodeFilter) return false
      if (activeSearch.trim()) {
        const q = activeSearch.toLowerCase()
        const matchName = s.name.toLowerCase().includes(q)
        const matchEmail = (s.email || '').toLowerCase().includes(q)
        const matchVpnIp = s.vpn_ip.toLowerCase().includes(q)
        const matchRealIp = (s.real_ip || '').toLowerCase().includes(q)
        const matchNode = s.node_hostname.toLowerCase().includes(q)
        const matchDevice = (s.device_name || '').toLowerCase().includes(q)
        if (!matchName && !matchEmail && !matchVpnIp && !matchRealIp && !matchNode && !matchDevice) {
          return false
        }
      }
      return true
    })
  }, [activeSessions, activeNodeFilter, activeSearch])

  // Filtered History Sessions (client search + reason filter over current page)
  const filteredHistory = useMemo(() => {
    const list = historyData?.sessions ?? []
    return list.filter((s) => {
      if (historyReasonFilter !== 'all') {
        if (historyReasonFilter === 'normal' && s.disconnect_reason !== 'normal') return false
        if (
          historyReasonFilter === 'blocked' &&
          s.disconnect_reason !== 'admin_kick' &&
          s.disconnect_reason !== 'admin_kick_permanent'
        )
          return false
        if (
          historyReasonFilter === 'timeout' &&
          s.disconnect_reason !== 'timeout' &&
          s.disconnect_reason !== 'heartbeat_timeout'
        )
          return false
        if (
          historyReasonFilter === 'revoked' &&
          s.disconnect_reason !== 'cert_revoked' &&
          s.disconnect_reason !== 'cert_expired' &&
          s.disconnect_reason !== 'user_disabled'
        )
          return false
      }
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase()
        const matchName = s.name.toLowerCase().includes(q)
        const matchEmail = (s.email || '').toLowerCase().includes(q)
        const matchVpnIp = s.vpn_ip.toLowerCase().includes(q)
        const matchRealIp = (s.real_ip || '').toLowerCase().includes(q)
        const matchNode = s.node_hostname.toLowerCase().includes(q)
        const matchDevice = (s.device_name || '').toLowerCase().includes(q)
        if (!matchName && !matchEmail && !matchVpnIp && !matchRealIp && !matchNode && !matchDevice) {
          return false
        }
      }
      return true
    })
  }, [historyData?.sessions, historyReasonFilter, historySearch])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Live Monitoring & History
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">VPN Sessions</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time client telemetry, throughput monitoring, and historical session connection logs
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="cursor-pointer h-9 px-3 text-xs shadow-xs"
            title="Refresh sessions telemetry"
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
            Refresh
          </Button>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 border border-border/70 text-muted-foreground text-xs font-medium rounded-lg">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Auto-refresh 15s
          </span>
        </div>
      </div>

      {/* ─── STAT CARDS ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Active Tunnels */}
        <div className="bg-card text-card-foreground rounded-xl border border-border p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active Tunnels</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Radio className="size-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-foreground">
              {stats?.active_sessions ?? activeSessions.length}
            </span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">Live connected endpoints</p>
        </div>

        {/* Card 2: Sessions Today (24h) */}
        <div className="bg-card text-card-foreground rounded-xl border border-border p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Sessions Today (24h)</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">
            {stats?.sessions_today ?? '—'}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">Total connection events</p>
        </div>

        {/* Card 3: Bandwidth Today */}
        <div className="bg-card text-card-foreground rounded-xl border border-border p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Bandwidth Today</span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <TrendingUp className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2 truncate">
            {formatBytes(stats?.bandwidth_today?.total ?? 0)}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono mt-1 truncate">
            ↑ {formatBytes(stats?.bandwidth_today?.sent ?? 0)} • ↓ {formatBytes(stats?.bandwidth_today?.received ?? 0)}
          </p>
        </div>

        {/* Card 4: Avg Connection Time */}
        <div className="bg-card text-card-foreground rounded-xl border border-border p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Avg Connection Time</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Timer className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">
            {formatDurationFromSeconds(stats?.avg_duration_seconds ?? 0)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">Average session duration</p>
        </div>
      </div>

      {/* ─── TABS: ACTIVE VS HISTORY ─────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as 'active' | 'history')}
        className="space-y-4"
      >
        <TabsList className="bg-muted/60 p-1 border border-border/60">
          <TabsTrigger value="active" className="gap-2 cursor-pointer text-xs font-medium">
            <Activity className="size-3.5" />
            Active Tunnels ({activeSessions.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2 cursor-pointer text-xs font-medium">
            <History className="size-3.5" />
            Session History {pagination ? `(${pagination.total})` : ''}
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: ACTIVE SESSIONS ────────────────────────────────────────── */}
        <TabsContent value="active" className="space-y-4">
          {/* Active Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-xl">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search active by user, IP, device, or node..."
                  value={activeSearch}
                  onChange={(e) => setActiveSearch(e.target.value)}
                  className="pl-9 pr-8 h-9 text-xs"
                />
                {activeSearch && (
                  <button
                    type="button"
                    onClick={() => setActiveSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="min-w-[180px]">
                <select
                  id="active-node-filter"
                  className="h-9 w-full rounded-lg border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                  value={activeNodeFilter}
                  onChange={(e) => setActiveNodeFilter(e.target.value)}
                >
                  <option value="">All VPN Nodes ({nodes.length})</option>
                  {nodes.map((node) => {
                    const count = activeSessions.filter((s) => s.node_id === node.id).length
                    return (
                      <option key={node.id} value={node.id}>
                        {node.hostname} ({count})
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            <div className="text-xs text-muted-foreground font-medium self-end sm:self-center">
              Showing {filteredActive.length} of {activeSessions.length} active
            </div>
          </div>

          {/* Active Table */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                      User & Public IP
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                      Device / Client
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                      Node & Region
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[120px]">
                      VPN IP
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Duration
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Traffic
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-36">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/60">
                  {isLoadingActive ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-4 text-center">
                          <Skeleton className="h-4 w-4 mx-auto" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="space-y-1">
                              <Skeleton className="h-4 w-28" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-5 w-20" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                        <TableCell className="py-4 text-center">
                          <Skeleton className="h-5 w-20 mx-auto rounded-full" />
                        </TableCell>
                        <TableCell className="py-4 text-right pr-5">
                          <Skeleton className="h-8 w-24 ml-auto rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredActive.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={9} className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Activity className="size-6 text-muted-foreground/60" />
                          </div>
                          <h3 className="font-semibold text-foreground text-sm">No active sessions</h3>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {activeSearch || activeNodeFilter
                              ? 'No connected tunnels match your search or filter.'
                              : 'No VPN users are currently connected to any node.'}
                          </p>
                          {(activeSearch || activeNodeFilter) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-4 text-xs cursor-pointer"
                              onClick={() => {
                                setActiveSearch('')
                                setActiveNodeFilter('')
                              }}
                            >
                              Clear all filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredActive.map((s, index) => (
                      <TableRow key={s.id} className="hover:bg-muted/40 transition-colors">
                        <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                          {index + 1}
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs shrink-0 border border-primary/20">
                              {s.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-xs text-foreground truncate">{s.name}</div>
                              {s.real_ip ? (
                                <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1 mt-0.5 truncate">
                                  <Globe className="size-3 text-muted-foreground/70 shrink-0" />
                                  <span className="truncate">{s.real_ip}</span>
                                </div>
                              ) : (
                                <div className="text-[11px] text-muted-foreground/70">Internal</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="p-1 rounded-md bg-muted/60 text-muted-foreground shrink-0 border border-border/40">
                              <Monitor className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-foreground truncate">
                                {s.device_name || 'Generic Device'}
                              </div>
                              {s.client_version && (
                                <div className="text-[10px] font-mono text-muted-foreground truncate">
                                  {s.client_version}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            <Server className="size-3.5 text-muted-foreground/70 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-foreground truncate">{s.node_hostname}</div>
                              {s.node_region && (
                                <div className="text-[10px] text-muted-foreground truncate">{s.node_region}</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 whitespace-nowrap">
                          <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                            {s.vpn_ip}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 whitespace-nowrap text-xs text-muted-foreground">
                          <div className="inline-flex items-center gap-1.5 font-medium">
                            <Clock className="size-3.5 opacity-60 shrink-0" />
                            <span>{formatDuration(s.connected_at, null, s.duration_seconds)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/40 border border-border/60 text-xs font-mono">
                            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                              <ArrowUp className="size-3" /> {formatBytes(s.bytes_sent)}
                            </span>
                            <span className="text-border/80">/</span>
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              <ArrowDown className="size-3" /> {formatBytes(s.bytes_received)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 text-center whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shadow-xs gap-1.5 px-2.5 py-0.5 text-[11px]"
                          >
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Connected
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-right pr-5 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                              onClick={() => setInspectSession(s)}
                            >
                              <Eye className="mr-1.5 size-3.5" />
                              Inspect
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer shadow-xs"
                              title="Block or kick session"
                              onClick={() => setBlockTarget(s)}
                            >
                              <UserX className="mr-1 size-3.5" />
                              Block
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ─── TAB 2: SESSION HISTORY ────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          {/* History Toolbar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search history by user, IP, or node..."
                  value={historySearch}
                  onChange={(e) => {
                    setHistorySearch(e.target.value)
                    setHistoryPage(1)
                  }}
                  className="pl-9 pr-8 h-9 text-xs"
                />
                {historySearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistorySearch('')
                      setHistoryPage(1)
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="min-w-[180px]">
                <select
                  id="history-node-filter"
                  className="h-9 w-full rounded-lg border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                  value={historyNodeFilter}
                  onChange={(e) => {
                    setHistoryNodeFilter(e.target.value)
                    setHistoryPage(1)
                  }}
                >
                  <option value="">All VPN Nodes ({nodes.length})</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.hostname}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Reason Filter Pills */}
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs self-start md:self-auto overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => {
                  setHistoryReasonFilter('all')
                  setHistoryPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  historyReasonFilter === 'all'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Reasons
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryReasonFilter('normal')
                  setHistoryPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  historyReasonFilter === 'normal'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryReasonFilter('blocked')
                  setHistoryPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  historyReasonFilter === 'blocked'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Kicked / Blocked
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryReasonFilter('timedout')
                  setHistoryPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  historyReasonFilter === 'timedout'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Timed Out
              </button>
            </div>
          </div>

          {/* History Table */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                      User & Public IP
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[140px]">
                      Device / Client
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[130px]">
                      Node
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      VPN IP
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                      Connected At
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Duration
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Traffic
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[140px]">
                      Disconnect Reason
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-32">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={`divide-y divide-border/60 transition-opacity duration-150 ${isPlaceholderHistory ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isLoadingHistory && !historyData ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-4 text-center">
                          <Skeleton className="h-4 w-4 mx-auto" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="space-y-1">
                              <Skeleton className="h-4 w-28" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-5 w-20" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-28" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                        <TableCell className="py-4 text-center">
                          <Skeleton className="h-5 w-24 mx-auto rounded-full" />
                        </TableCell>
                        <TableCell className="py-4 text-right pr-5">
                          <Skeleton className="h-8 w-20 ml-auto rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredHistory.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={10} className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <History className="size-6 text-muted-foreground/60" />
                          </div>
                          <h3 className="font-semibold text-foreground text-sm">No session history</h3>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {historySearch || historyNodeFilter || historyReasonFilter !== 'all'
                              ? 'No completed sessions match your filter parameters.'
                              : 'No historical session records found.'}
                          </p>
                          {(historySearch || historyNodeFilter || historyReasonFilter !== 'all') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-4 text-xs cursor-pointer"
                              onClick={() => {
                                setHistorySearch('')
                                setHistoryNodeFilter('')
                                setHistoryReasonFilter('all')
                                setHistoryPage(1)
                              }}
                            >
                              Clear all filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredHistory.map((s, index) => {
                      const rowNumber = (historyPage - 1) * historyLimit + index + 1
                      return (
                        <TableRow key={s.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                            {rowNumber}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-muted text-foreground font-semibold flex items-center justify-center text-xs shrink-0 border border-border/80">
                                {s.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-foreground truncate">{s.name}</div>
                                {s.real_ip ? (
                                  <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1 mt-0.5 truncate">
                                    <Globe className="size-3 text-muted-foreground/70 shrink-0" />
                                    <span className="truncate">{s.real_ip}</span>
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-muted-foreground/70">Internal</div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1 rounded-md bg-muted/60 text-muted-foreground shrink-0 border border-border/40">
                                <Monitor className="size-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-foreground truncate">
                                  {s.device_name || 'Generic Device'}
                                </div>
                                {s.client_version && (
                                  <div className="text-[10px] font-mono text-muted-foreground truncate">
                                    {s.client_version}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-2">
                              <Server className="size-3.5 text-muted-foreground/70 shrink-0" />
                              <span className="text-xs font-medium text-foreground truncate">{s.node_hostname}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 whitespace-nowrap">
                            <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-muted/60 text-foreground border border-border/60 font-medium">
                              {s.vpn_ip}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            {formatBrowserDateTime(s.connected_at)}
                          </TableCell>
                          <TableCell className="py-3 whitespace-nowrap text-xs text-muted-foreground">
                            <div className="inline-flex items-center gap-1.5 font-medium">
                              <Clock className="size-3.5 opacity-60 shrink-0" />
                              <span>
                                {formatDuration(
                                  s.connected_at,
                                  s.disconnected_at,
                                  s.connection_duration_seconds ?? s.duration_seconds
                                )}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/40 border border-border/60 text-xs font-mono">
                              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                                <ArrowUp className="size-3" /> {formatBytes(s.bytes_sent)}
                              </span>
                              <span className="text-border/80">/</span>
                              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                <ArrowDown className="size-3" /> {formatBytes(s.bytes_received)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-center whitespace-nowrap">
                            <DisconnectReasonBadge reason={s.disconnect_reason} />
                          </TableCell>
                          <TableCell className="py-3 text-right pr-5 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {s.disconnect_reason === 'admin_kick_permanent' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer shadow-xs"
                                  title="Restore reconnect access"
                                  onClick={() => setUnkickTarget(s)}
                                  disabled={unkickMutation.isPending}
                                >
                                  <ShieldCheck className="mr-1 size-3.5" />
                                  Unkick
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                                onClick={() => setInspectSession(s)}
                              >
                                <Eye className="mr-1.5 size-3.5" />
                                Inspect
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination && pagination.pages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Showing page <span className="font-semibold text-foreground">{pagination.page}</span> of{' '}
                  <span className="font-semibold text-foreground">{pagination.pages}</span> • {pagination.total} total sessions
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={isPlaceholderHistory || historyPage === 1}
                  >
                    <ChevronLeft className="size-3.5 mr-1" />
                    Previous
                  </Button>
                  <span className="text-xs px-1.5 font-mono text-muted-foreground">
                    {historyPage} / {pagination.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                    onClick={() => setHistoryPage((p) => Math.min(pagination.pages, p + 1))}
                    disabled={isPlaceholderHistory || historyPage >= pagination.pages}
                  >
                    Next
                    <ChevronRight className="size-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── MODAL: INSPECT SESSION ────────────────────────────────────────── */}
      {inspectSession && (
        <Modal open={!!inspectSession} onClose={() => setInspectSession(null)} className="max-w-2xl">
          <ModalHeader
            title="Session Telemetry & Details"
            description="Diagnostic parameters, client information, and network throughput"
            onClose={() => setInspectSession(null)}
          />
          <ModalBody className="space-y-4">
            {/* Top User Card */}
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm shrink-0 border border-primary/20">
                    {inspectSession.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{inspectSession.name}</h4>
                    <p className="text-xs text-muted-foreground">{inspectSession.email || 'User Account'}</p>
                  </div>
                </div>

                {!inspectSession.disconnected_at ? (
                  <Badge
                    variant="outline"
                    className="self-start sm:self-auto bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5 px-3 py-1 text-xs"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Connected Active
                  </Badge>
                ) : (
                  <DisconnectReasonBadge reason={inspectSession.disconnect_reason} />
                )}
              </div>

              {/* Grid Attributes */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Assigned VPN IP
                  </div>
                  <div className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 mt-1">
                    {inspectSession.vpn_ip}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Globe className="size-3" /> Public Real IP
                  </div>
                  <div className="text-xs font-mono font-medium text-foreground mt-1 truncate">
                    {inspectSession.real_ip || 'Internal'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Server className="size-3" /> Target Node
                  </div>
                  <div className="text-xs font-medium text-foreground mt-1 truncate">
                    {inspectSession.node_hostname}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Monitor className="size-3" /> Device / Client
                  </div>
                  <div className="text-xs font-medium text-foreground mt-1 truncate">
                    {inspectSession.device_name || 'Generic Device'}
                  </div>
                </div>
              </div>
            </div>

            {/* Traffic & Bandwidth Card */}
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="size-3.5 text-primary" /> Traffic & Network Telemetry
              </h5>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 text-center">
                  <span className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <ArrowUp className="size-3 text-blue-500" /> Upload (Sent)
                  </span>
                  <div className="text-sm font-mono font-semibold text-blue-600 dark:text-blue-400 mt-1">
                    {formatBytes(inspectSession.bytes_sent)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 text-center">
                  <span className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <ArrowDown className="size-3 text-emerald-500" /> Download (Received)
                  </span>
                  <div className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                    {formatBytes(inspectSession.bytes_received)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 text-center">
                  <span className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <Layers className="size-3 text-purple-500" /> Total Transferred
                  </span>
                  <div className="text-sm font-mono font-semibold text-foreground mt-1">
                    {formatBytes(inspectSession.bytes_sent + inspectSession.bytes_received)}
                  </div>
                </div>
              </div>
            </div>

            {/* Timestamps Card */}
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2.5">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock className="size-3.5 text-primary" /> Connection Timestamps & Duration
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                  <span className="text-[10px] text-muted-foreground">Connected Since</span>
                  <div className="font-medium text-foreground mt-0.5 tabular-nums">
                    {formatBrowserDateTime(inspectSession.connected_at)}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                  <span className="text-[10px] text-muted-foreground">Session Ended</span>
                  <div className="font-medium text-foreground mt-0.5 tabular-nums">
                    {inspectSession.disconnected_at
                      ? formatBrowserDateTime(inspectSession.disconnected_at)
                      : 'Active right now'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                  <span className="text-[10px] text-muted-foreground">Total Lifespan</span>
                  <div className="font-mono font-semibold text-foreground mt-0.5">
                    {formatDuration(
                      inspectSession.connected_at,
                      inspectSession.disconnected_at,
                      inspectSession.connection_duration_seconds ?? inspectSession.duration_seconds
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Disconnect Reason Diagnostics (if applicable) */}
            {inspectSession.disconnect_reason && (
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/70 text-xs space-y-1.5">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Info className="size-3.5 text-primary" /> Termination Explanation
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {disconnectReasonConfig[inspectSession.disconnect_reason]?.description ||
                    inspectSession.disconnect_reason}
                </p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            {!inspectSession.disconnected_at && (
              <Button
                type="button"
                variant="outline"
                className="border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer shadow-xs text-xs"
                onClick={() => {
                  setBlockTarget(inspectSession)
                }}
              >
                <UserX className="mr-1.5 size-3.5" />
                Block / Kick Session
              </Button>
            )}
            {inspectSession.disconnect_reason === 'admin_kick_permanent' && (
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs text-xs"
                onClick={() => {
                  setUnkickTarget(inspectSession)
                }}
              >
                <ShieldCheck className="mr-1.5 size-3.5" />
                Restore Access (Unkick)
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setInspectSession(null)}
              className="cursor-pointer text-xs"
            >
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ─── MODAL: KICK / BLOCK SESSION CONFIRMATION ──────────────────────── */}
      {blockTarget && (
        <Modal open={!!blockTarget} onClose={() => setBlockTarget(null)} className="max-w-md">
          <ModalHeader
            title="Block VPN Session"
            description="Terminate the live connection and manage client reconnect access"
            onClose={() => setBlockTarget(null)}
          />
          <ModalBody className="space-y-4">
            {/* Target Info */}
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-700 dark:text-red-400 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="size-4 shrink-0" /> Target Client Connection
              </div>
              <p className="font-mono">
                {blockTarget.name} • {blockTarget.vpn_ip} on {blockTarget.node_hostname}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">Block Duration Policy</label>
              <div className="grid grid-cols-1 gap-2">
                <label
                  onClick={() => setBlockDurationMode('5m')}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    blockDurationMode === '5m'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="blockDuration"
                    checked={blockDurationMode === '5m'}
                    onChange={() => setBlockDurationMode('5m')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-xs text-foreground">Temporary Block (5 minutes)</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Terminates connection immediately. Reconnect attempts will be rejected for 5 minutes and then
                      automatically restored.
                    </p>
                  </div>
                </label>

                <label
                  onClick={() => setBlockDurationMode('permanent')}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    blockDurationMode === 'permanent'
                      ? 'border-red-500 bg-red-500/5 ring-1 ring-red-500'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="blockDuration"
                    checked={blockDurationMode === 'permanent'}
                    onChange={() => setBlockDurationMode('permanent')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-xs text-red-600 dark:text-red-400">
                      Permanent Block (Until Unkick)
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Terminates connection immediately. The client remains blocked indefinitely until an administrator
                      manually clicks "Unkick".
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBlockTarget(null)}
              className="cursor-pointer text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={kickMutation.isPending}
              onClick={() => {
                kickMutation.mutate({
                  sessionId: blockTarget.id,
                  permanent: blockDurationMode === 'permanent',
                  blockDurationSeconds: blockDurationMode === '5m' ? 300 : undefined,
                })
              }}
              className="bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs text-xs"
            >
              {kickMutation.isPending ? 'Blocking...' : 'Block Connection'}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ─── MODAL: UNKICK SESSION CONFIRMATION ───────────────────────────── */}
      {unkickTarget && (
        <Modal open={!!unkickTarget} onClose={() => setUnkickTarget(null)} className="max-w-md">
          <ModalHeader
            title="Restore Reconnect Access"
            description="Remove the block filter and allow this user to establish VPN sessions again"
            onClose={() => setUnkickTarget(null)}
          />
          <ModalBody className="space-y-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-700 dark:text-emerald-400 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="size-4 shrink-0" /> Target User
              </div>
              <p className="font-mono">
                {unkickTarget.name} ({unkickTarget.vpn_ip})
              </p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to restore reconnect access for <strong>{unkickTarget.name}</strong>? They will be
              permitted to authenticate and reconnect to the VPN network immediately.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnkickTarget(null)}
              className="cursor-pointer text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={unkickMutation.isPending}
              onClick={() => unkickMutation.mutate(unkickTarget.id)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs text-xs"
            >
              {unkickMutation.isPending ? 'Restoring...' : 'Restore Access'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
