import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Users,
  Server,
  Activity,
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  MapPin,
  ListTodo,
  Radio,
  ExternalLink,
  Zap,
} from 'lucide-react'
import {
  type User as UserType,
  type VpnNode,
  type VpnSession,
  type Task,
} from '@vpn/shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_layout/')({
  component: DashboardPage,
})

interface SessionStats {
  active_sessions: number
  sessions_today: number
  bandwidth_today: {
    sent: number
    received: number
    total: number
  }
  avg_duration_seconds: number
  top_users: Array<{
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

function formatDurationSeconds(durationSeconds?: number | null) {
  if (durationSeconds === undefined || durationSeconds === null || durationSeconds <= 0) return '0s'
  const m = Math.floor(durationSeconds / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m === 0) return `${durationSeconds}s`
  return `${m}m`
}

function formatConnectedSince(since: string) {
  const start = new Date(since).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - start) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const m = Math.floor(diffSec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function getInitials(name?: string) {
  if (!name) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

// eslint-disable-next-line react-refresh/only-export-components
function DashboardPage() {
  const qc = useQueryClient()

  const { data: users = [], isLoading: isLoadingUsers, isFetching: isFetchingUsers } = useQuery<UserType[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users'),
  })

  const { data: nodes = [], isLoading: isLoadingNodes, isFetching: isFetchingNodes } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  const { data: sessions = [], isLoading: isLoadingSessions, isFetching: isFetchingSessions } = useQuery<VpnSession[]>({
    queryKey: ['sessions'],
    queryFn: () => api.get('/api/v1/sessions'),
  })

  const { data: tasks = [], isLoading: isLoadingTasks, isFetching: isFetchingTasks } = useQuery<Task[]>({
    queryKey: ['tasks', 'pending'],
    queryFn: () => api.get('/api/v1/tasks?status=pending'),
  })

  const { data: stats, isLoading: isLoadingStats, isFetching: isFetchingStats } = useQuery<SessionStats>({
    queryKey: ['session-stats'],
    queryFn: () => api.get('/api/v1/sessions/stats'),
  })

  const isRefreshing =
    isFetchingUsers || isFetchingNodes || isFetchingSessions || isFetchingTasks || isFetchingStats

  const handleRefresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['users'] }),
      qc.invalidateQueries({ queryKey: ['nodes'] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
      qc.invalidateQueries({ queryKey: ['tasks'] }),
      qc.invalidateQueries({ queryKey: ['session-stats'] }),
    ])
  }

  // Node telemetry
  const onlineNodes = nodes.filter((n) => n.status === 'online').length
  const offlineNodes = nodes.filter((n) => n.status === 'offline').length
  const wireguardCount = nodes.filter((n) => n.vpn_type === 'wireguard').length
  const openvpnCount = nodes.filter((n) => n.vpn_type === 'openvpn').length

  // User breakdown
  const adminCount = users.filter((u) => u.role === 'admin').length

  // Bandwidth telemetry
  const totalBandwidth = stats?.bandwidth_today?.total ?? 0
  const sentBandwidth = stats?.bandwidth_today?.sent ?? 0
  const receivedBandwidth = stats?.bandwidth_today?.received ?? 0

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Dashboard</h1>
            <Badge
              variant="outline"
              className={`gap-1.5 px-2.5 py-0.5 text-xs font-semibold ${
                offlineNodes > 0
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  offlineNodes > 0 ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
                }`}
              />
              {offlineNodes > 0 ? `${offlineNodes} Node Offline` : 'System Operational'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time infrastructure overview and network telemetry monitoring
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-9 gap-1.5 border-border/80 bg-card hover:bg-muted text-xs cursor-pointer shadow-xs"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Active Sessions */}
        <Link
          to="/sessions"
          className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xs transition-all hover:border-emerald-500/40 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active Sessions</p>
              {isLoadingSessions ? (
                <Skeleton className="h-8 w-16 mt-2" />
              ) : (
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    {sessions.length}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <Radio className="size-3 animate-pulse" /> Live
                  </span>
                </div>
              )}
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 group-hover:scale-105 transition-transform">
              <Activity className="size-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground/80 border-t border-border/40 pt-2.5">
            <span>{stats?.sessions_today ?? 0} total sessions today</span>
            <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-emerald-600 dark:text-emerald-400" />
          </div>
        </Link>

        {/* 2. VPN Nodes */}
        <Link
          to="/nodes"
          className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xs transition-all hover:border-violet-500/40 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">VPN Nodes</p>
              {isLoadingNodes ? (
                <Skeleton className="h-8 w-20 mt-2" />
              ) : (
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    {onlineNodes}
                    <span className="text-base font-normal text-muted-foreground">/{nodes.length}</span>
                  </span>
                  <span className="text-xs font-medium text-violet-600 dark:text-violet-400">Online</span>
                </div>
              )}
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 group-hover:scale-105 transition-transform">
              <Server className="size-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground/80 border-t border-border/40 pt-2.5">
            <span>
              {wireguardCount} WireGuard &bull; {openvpnCount} OpenVPN
            </span>
            <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-violet-600 dark:text-violet-400" />
          </div>
        </Link>

        {/* 3. Total Users */}
        <Link
          to="/users"
          className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xs transition-all hover:border-blue-500/40 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Accounts</p>
              {isLoadingUsers ? (
                <Skeleton className="h-8 w-16 mt-2" />
              ) : (
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    {users.length}
                  </span>
                  <span className="text-xs text-muted-foreground">users</span>
                </div>
              )}
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 group-hover:scale-105 transition-transform">
              <Users className="size-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground/80 border-t border-border/40 pt-2.5">
            <span>
              {adminCount} Admin &bull; {users.length - adminCount} Standard
            </span>
            <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-blue-600 dark:text-blue-400" />
          </div>
        </Link>

        {/* 4. Task Queue */}
        <Link
          to="/tasks"
          className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xs transition-all hover:border-amber-500/40 hover:shadow-md cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pending Tasks</p>
              {isLoadingTasks ? (
                <Skeleton className="h-8 w-16 mt-2" />
              ) : (
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    {tasks.length}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      tasks.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                    }`}
                  >
                    {tasks.length > 0 ? 'Queued' : 'Clear'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 group-hover:scale-105 transition-transform">
              <ListTodo className="size-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground/80 border-t border-border/40 pt-2.5">
            <span>Background agent sync queue</span>
            <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-amber-600 dark:text-amber-400" />
          </div>
        </Link>
      </div>

      {/* Secondary Telemetry Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Bandwidth Today */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Zap className="size-3.5 text-emerald-500" />
              Bandwidth Today (24h)
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border">
              Total
            </Badge>
          </div>
          {isLoadingStats ? (
            <Skeleton className="h-6 w-24 my-1" />
          ) : (
            <p className="text-xl font-bold font-mono text-foreground">{formatBytes(totalBandwidth)}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs font-mono text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="size-3" /> {formatBytes(sentBandwidth)}
            </span>
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <ArrowDown className="size-3" /> {formatBytes(receivedBandwidth)}
            </span>
          </div>
        </div>

        {/* Avg Duration */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="size-3.5 text-blue-500" />
              Avg Connection Duration
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border">
              24h
            </Badge>
          </div>
          {isLoadingStats ? (
            <Skeleton className="h-6 w-20 my-1" />
          ) : (
            <p className="text-xl font-bold text-foreground">
              {formatDurationSeconds(stats?.avg_duration_seconds)}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2">Calculated across disconnected tunnels</p>
        </div>

        {/* Protocol Breakdown & Quick Access */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-violet-500" />
              Protocol Architecture
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border">
              Active
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              WireGuard ({wireguardCount})
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
              OpenVPN ({openvpnCount})
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40 text-xs">
            <Link to="/policies" className="text-muted-foreground hover:text-foreground transition-colors">
              Policies &rarr;
            </Link>
            <span className="text-muted-foreground/40">&bull;</span>
            <Link to="/dns" className="text-muted-foreground hover:text-foreground transition-colors">
              Managed DNS &rarr;
            </Link>
            <span className="text-muted-foreground/40">&bull;</span>
            <Link to="/audit" className="text-muted-foreground hover:text-foreground transition-colors">
              Audit Logs &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Main Grid: Infrastructure Nodes & Live Sessions Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: VPN Nodes Infrastructure Monitor (7 cols) */}
        <div className="lg:col-span-7 rounded-xl border border-border bg-card shadow-xs flex flex-col">
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border/60">
            <div>
              <h2 className="font-semibold text-foreground text-base">VPN Nodes Infrastructure</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Active server endpoints and agent connectivity status
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground h-8"
            >
              <Link to="/nodes">
                View All <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          </div>

          <div className="p-4 sm:p-5 flex-1">
            {isLoadingNodes ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : nodes.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground/70">
                <Server className="size-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No VPN nodes registered yet</p>
                <p className="text-xs text-muted-foreground mt-1">Deploy an agent node to get started</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {nodes.map((node) => {
                  const nodeActiveSessions = sessions.filter((s) => s.node_id === node.id).length
                  const isOnline = node.status === 'online'
                  const isDecom = node.status === 'decommissioned'

                  return (
                    <div
                      key={node.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Status Indicator */}
                        <div
                          className={`size-2.5 rounded-full shrink-0 ${
                            isOnline
                              ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50'
                              : isDecom
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground truncate" title={node.hostname}>
                              {node.hostname}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-bold uppercase px-1.5 py-0 ${
                                node.vpn_type === 'wireguard'
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                  : 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
                              }`}
                            >
                              {node.vpn_type === 'wireguard' ? 'WG' : 'OVPN'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2.5 mt-0.5 text-xs text-muted-foreground">
                            <span className="font-mono text-[11px]">{node.ip_address}</span>
                            {node.region && (
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3 text-muted-foreground/60" /> {node.region}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-background px-2.5 py-1 rounded-md border border-border/60">
                          <Users className="size-3 text-emerald-600 dark:text-emerald-400" />
                          <span>{nodeActiveSessions}</span>
                        </span>

                        <Badge
                          variant="outline"
                          className={`capitalize text-xs font-medium ${
                            isOnline
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : isDecom
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                              : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                          }`}
                        >
                          {node.status}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Sessions Stream (5 cols) */}
        <div className="lg:col-span-5 rounded-xl border border-border bg-card shadow-xs flex flex-col">
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border/60">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-foreground text-base">Active Sessions</h2>
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs font-semibold px-2 py-0"
                >
                  {sessions.length} Live
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Currently connected client tunnels</p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground h-8"
            >
              <Link to="/sessions">
                View All <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          </div>

          <div className="p-4 sm:p-5 flex-1">
            {isLoadingSessions ? (
              <div className="space-y-1.5">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground/70">
                <Activity className="size-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No active tunnels connected</p>
                <p className="text-xs text-muted-foreground mt-1">Users will appear here when connected</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {sessions.map((s) => {
                  const nodeObj = nodes.find((n) => n.id === s.node_id)
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors"
                      title={`${s.name} · ${s.vpn_ip} · ${nodeObj ? nodeObj.hostname : 'VPN Server'}`}
                    >
                      <span
                        className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                        title="Online"
                      />
                      <div className="size-6 rounded-full bg-linear-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-500/30 flex items-center justify-center font-bold text-[10px] text-emerald-700 dark:text-emerald-300 shrink-0">
                        {getInitials(s.name)}
                      </div>
                      <span className="font-medium text-xs text-foreground truncate min-w-0">
                        {s.name}
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                        {s.vpn_ip}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/80 shrink-0">
                        <span className="truncate max-w-[80px]">
                          {nodeObj ? nodeObj.hostname : 'VPN Server'}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{formatConnectedSince(s.connected_at)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Top Bandwidth Consumers (7 Days) */}
      {stats?.top_users && stats.top_users.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-xs p-5">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/60">
            <div>
              <h2 className="font-semibold text-foreground text-base">Top Data Consumers (7 Days)</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Users generating the highest network traffic across all nodes
              </p>
            </div>
            <Badge variant="outline" className="text-xs px-2 py-0.5 border-border">
              Top {stats.top_users.length} Users
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.top_users.slice(0, 4).map((u, idx) => (
              <div
                key={u.user_id}
                className="p-3.5 rounded-lg border border-border/60 bg-muted/10 hover:bg-muted/25 transition-colors flex items-center gap-3"
              >
                <div className="size-7 rounded-full bg-muted flex items-center justify-center font-bold text-xs text-muted-foreground shrink-0 border border-border">
                  #{idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-xs text-foreground truncate">{u.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {formatBytes(u.total_bytes)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/80">
                      {u.session_count} {u.session_count === 1 ? 'session' : 'sessions'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
