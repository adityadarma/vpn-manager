import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  Shield,
  Search,
  User,
  FileText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  Eye,
  Globe,
  Copy,
  Check,
  ShieldAlert,
  Server,
  Activity,
  Users,
  Info,
  Clock,
  FileCode,
  CheckCircle2,
  Settings,
  Trash2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
import { formatBrowserDateTime } from '@vpn/shared'

export const Route = createFileRoute('/_layout/audit')({
  component: AuditPage,
})

interface AuditLog {
  id: string
  user_id: string | null
  name: string | null
  email?: string | null
  action: string
  resource_type: string
  resource_id: string | null
  metadata: string | Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

interface ConnectionAttempt {
  id: string
  user_id: string | null
  user_name: string | null
  user_email: string | null
  node_id: string | null
  node_hostname: string | null
  username: string
  real_ip: string
  failure_reason: string
  attempted_at: string
  error_details: string | null
}

interface AttemptStats {
  failed_attempts_24h: number
  by_reason: Array<{ failure_reason: string; count: number }>
  top_ips: Array<{ real_ip: string; count: number; last_attempt: string }>
  top_usernames: Array<{ username: string; count: number }>
}

function parseJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return String(value)
}

function getActionMeta(action: string) {
  const lower = action.toLowerCase()
  if (lower.includes('create') || lower.includes('issue') || lower.includes('add') || lower.includes('register')) {
    return {
      type: 'create',
      label: action,
      badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      icon: CheckCircle2,
    }
  }
  if (lower.includes('update') || lower.includes('sync') || lower.includes('edit') || lower.includes('modify')) {
    return {
      type: 'update',
      label: action,
      badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
      icon: Settings,
    }
  }
  if (lower.includes('delete') || lower.includes('revoke') || lower.includes('remove') || lower.includes('block') || lower.includes('kick')) {
    return {
      type: 'delete',
      label: action,
      badgeClass: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
      icon: Trash2,
    }
  }
  return {
    type: 'other',
    label: action,
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    icon: Activity,
  }
}

const resourceTypes = [
  { value: 'all', label: 'All Resources' },
  { value: 'user', label: 'Users' },
  { value: 'group', label: 'Groups' },
  { value: 'network', label: 'Networks' },
  { value: 'node', label: 'VPN Nodes' },
  { value: 'policy', label: 'Policies' },
  { value: 'dns', label: 'DNS Zones & Rules' },
  { value: 'session', label: 'Sessions' },
  { value: 'certificate', label: 'Certificates' },
]

// eslint-disable-next-line react-refresh/only-export-components
function AuditPage() {
  const [activeTab, setActiveTab] = useState<'logs' | 'attempts'>('logs')

  // Tab 1 (Admin Logs) filters & pagination
  const [logPage, setLogPage] = useState(1)
  const [logSearch, setLogSearch] = useState('')
  const [actionCategory, setActionCategory] = useState<'all' | 'create' | 'update' | 'delete'>('all')
  const [resourceFilter, setResourceFilter] = useState<string>('all')
  const logLimit = 10

  // Tab 2 (Failed Attempts) filters & pagination
  const [attemptPage, setAttemptPage] = useState(1)
  const [attemptSearch, setAttemptSearch] = useState('')
  const attemptLimit = 10

  // Inspect modals state
  const [inspectLog, setInspectLog] = useState<AuditLog | null>(null)
  const [inspectAttempt, setInspectAttempt] = useState<ConnectionAttempt | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // 1. Fetch Admin Logs with server pagination
  const {
    data: logsData,
    isLoading: isLoadingLogs,
    isFetching: isFetchingLogs,
    isPlaceholderData: isPlaceholderLogs,
    refetch: refetchLogs,
  } = useQuery<{
    logs: AuditLog[]
    pagination: { page: number; limit: number; total: number; pages: number }
  }>({
    queryKey: ['audit-logs', logPage, resourceFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        page: logPage.toString(),
        limit: logLimit.toString(),
      })
      if (resourceFilter !== 'all') {
        params.append('resource_type', resourceFilter)
      }
      return api.get(`/api/v1/audit/logs?${params}`)
    },
    placeholderData: keepPreviousData,
  })

  // 2. Fetch Failed Connection Attempts
  const {
    data: attemptsData,
    isLoading: isLoadingAttempts,
    isFetching: isFetchingAttempts,
    isPlaceholderData: isPlaceholderAttempts,
    refetch: refetchAttempts,
  } = useQuery<{
    attempts: ConnectionAttempt[]
    pagination: { page: number; limit: number; total: number; pages: number }
  }>({
    queryKey: ['audit-attempts', attemptPage],
    queryFn: () => {
      const params = new URLSearchParams({
        page: attemptPage.toString(),
        limit: attemptLimit.toString(),
      })
      return api.get(`/api/v1/audit/connection-attempts?${params}`)
    },
    placeholderData: keepPreviousData,
  })

  // 3. Fetch Failed Attempt Stats
  const {
    data: attemptStats,
    isFetching: isFetchingStats,
    refetch: refetchStats,
  } = useQuery<AttemptStats>({
    queryKey: ['audit-attempt-stats'],
    queryFn: () => api.get('/api/v1/audit/connection-attempts/stats'),
  })

  const isRefreshing = isFetchingLogs || isFetchingAttempts || isFetchingStats

  const handleManualRefresh = () => {
    refetchLogs()
    refetchAttempts()
    refetchStats()
    toast.success('Audit data refreshed')
  }

  // Filtered logs (client-side search and category filtering over current page)
  const filteredLogs = useMemo(() => {
    const list = logsData?.logs ?? []
    return list.filter((log) => {
      const meta = getActionMeta(log.action)
      if (actionCategory !== 'all' && meta.type !== actionCategory) {
        return false
      }
      if (logSearch.trim()) {
        const q = logSearch.toLowerCase()
        const matchUser = (log.name || '').toLowerCase().includes(q)
        const matchEmail = (log.email || '').toLowerCase().includes(q)
        const matchAction = log.action.toLowerCase().includes(q)
        const matchResource = log.resource_type.toLowerCase().includes(q)
        const matchResourceId = (log.resource_id || '').toLowerCase().includes(q)
        const matchIp = (log.ip_address || '').toLowerCase().includes(q)
        const matchMetadata =
          typeof log.metadata === 'string'
            ? log.metadata.toLowerCase().includes(q)
            : JSON.stringify(log.metadata || '').toLowerCase().includes(q)

        if (
          !matchUser &&
          !matchEmail &&
          !matchAction &&
          !matchResource &&
          !matchResourceId &&
          !matchIp &&
          !matchMetadata
        ) {
          return false
        }
      }
      return true
    })
  }, [logsData?.logs, actionCategory, logSearch])

  // Filtered attempts (client-side search over current page)
  const filteredAttempts = useMemo(() => {
    const list = attemptsData?.attempts ?? []
    if (!attemptSearch.trim()) return list
    const q = attemptSearch.toLowerCase()
    return list.filter((att) => {
      const matchUser = att.username.toLowerCase().includes(q)
      const matchRealIp = att.real_ip.toLowerCase().includes(q)
      const matchReason = att.failure_reason.toLowerCase().includes(q)
      const matchNode = (att.node_hostname || '').toLowerCase().includes(q)
      return matchUser || matchRealIp || matchReason || matchNode
    })
  }, [attemptsData?.attempts, attemptSearch])

  const copyToClipboard = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success(`${label} copied to clipboard`)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Calculate unique admins on current page
  const uniqueActorsCount = useMemo(() => {
    const set = new Set((logsData?.logs ?? []).map((l) => l.user_id || l.name).filter(Boolean))
    return set.size
  }, [logsData?.logs])

  const totalLogsCount = logsData?.pagination?.total ?? 0
  const totalAttemptsCount = attemptsData?.pagination?.total ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Security & Compliance
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">Audit Logs</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Immutable administrative change logs, authentication telemetry, and access security monitoring
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="cursor-pointer h-9 px-3 text-xs shadow-xs"
            title="Refresh audit logs"
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
            Refresh
          </Button>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 border border-border/70 text-muted-foreground text-xs font-medium rounded-lg">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            Audit Immutable
          </span>
        </div>
      </div>

      {/* ─── STAT CARDS ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Total Audit Events */}
        <div
          onClick={() => {
            setActiveTab('logs')
            setActionCategory('all')
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            activeTab === 'logs' && actionCategory === 'all'
              ? 'bg-card border-primary ring-2 ring-primary/20 shadow-md'
              : 'bg-card border-border hover:border-primary/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Audit Events</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Shield className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{totalLogsCount}</div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">Recorded admin operations</p>
        </div>

        {/* Card 2: Modifications / Changes */}
        <div
          onClick={() => {
            setActiveTab('logs')
            setActionCategory('update')
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            activeTab === 'logs' && actionCategory === 'update'
              ? 'bg-card border-blue-500 ring-2 ring-blue-500/20 shadow-md'
              : 'bg-card border-border hover:border-blue-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Config Updates</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Settings className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">
            {(logsData?.logs ?? []).filter((l) => l.action.includes('update')).length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">System modifications</p>
        </div>

        {/* Card 3: Failed Auth Events (24h) */}
        <div
          onClick={() => setActiveTab('attempts')}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            activeTab === 'attempts'
              ? 'bg-card border-red-500 ring-2 ring-red-500/20 shadow-md'
              : 'bg-card border-border hover:border-red-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Failed Auth (24h)</span>
            <div className="p-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <ShieldAlert className="size-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-foreground">
              {attemptStats?.failed_attempts_24h ?? totalAttemptsCount}
            </span>
            {(attemptStats?.failed_attempts_24h ?? 0) > 0 && (
              <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Alert</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">Rejected connection attempts</p>
        </div>

        {/* Card 4: Active Administrators */}
        <div className="bg-card text-card-foreground rounded-xl border border-border p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active Actors</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Users className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{uniqueActorsCount || 1}</div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">Authorized admin users</p>
        </div>
      </div>

      {/* ─── TABS ────────────────────────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'logs' | 'attempts')}
        className="space-y-4"
      >
        <TabsList className="bg-muted/60 p-1 border border-border/60">
          <TabsTrigger value="logs" className="gap-2 cursor-pointer text-xs font-medium">
            <FileText className="size-3.5" />
            Administrative Logs ({totalLogsCount})
          </TabsTrigger>
          <TabsTrigger value="attempts" className="gap-2 cursor-pointer text-xs font-medium">
            <ShieldAlert className="size-3.5" />
            Failed Connection Attempts ({totalAttemptsCount})
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: ADMINISTRATIVE LOGS ──────────────────────────────────── */}
        <TabsContent value="logs" className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search logs by actor, action, resource, or IP..."
                  value={logSearch}
                  onChange={(e) => {
                    setLogSearch(e.target.value)
                    setLogPage(1)
                  }}
                  className="pl-9 pr-8 h-9 text-xs"
                />
                {logSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogSearch('')
                      setLogPage(1)
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
                  id="log-resource-filter"
                  className="h-9 w-full rounded-lg border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                  value={resourceFilter}
                  onChange={(e) => {
                    setResourceFilter(e.target.value)
                    setLogPage(1)
                  }}
                >
                  {resourceTypes.map((rt) => (
                    <option key={rt.value} value={rt.value}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action Type Filter Pills */}
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs self-start md:self-auto overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => {
                  setActionCategory('all')
                  setLogPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  actionCategory === 'all'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Actions
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionCategory('create')
                  setLogPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  actionCategory === 'create'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionCategory('update')
                  setLogPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  actionCategory === 'update'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Update
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionCategory('delete')
                  setLogPage(1)
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
                  actionCategory === 'delete'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Delete / Revoke
              </button>
            </div>
          </div>

          {/* Admin Logs Table */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                      Timestamp
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[180px]">
                      Actor / Admin
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                      Action
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                      Resource Target
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Origin IP
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-28">
                      Details
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={`divide-y divide-border/60 transition-opacity duration-150 ${isPlaceholderLogs ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isLoadingLogs && !logsData ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-4 text-center">
                          <Skeleton className="h-4 w-4 mx-auto" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-28" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-7 w-7 rounded-full" />
                            <Skeleton className="h-4 w-28" />
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-5 w-24 rounded-full" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell className="py-4 text-right pr-5">
                          <Skeleton className="h-8 w-16 ml-auto rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredLogs.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Shield className="size-6 text-muted-foreground/60" />
                          </div>
                          <h3 className="font-semibold text-foreground text-sm">No audit logs found</h3>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {logSearch || actionCategory !== 'all' || resourceFilter !== 'all'
                              ? 'No events match your current filter parameters.'
                              : 'No administrative audit events recorded yet.'}
                          </p>
                          {(logSearch || actionCategory !== 'all' || resourceFilter !== 'all') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-4 text-xs cursor-pointer"
                              onClick={() => {
                                setLogSearch('')
                                setActionCategory('all')
                                setResourceFilter('all')
                                setLogPage(1)
                              }}
                            >
                              Clear all filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log, index) => {
                      const meta = getActionMeta(log.action)
                      const ActionIcon = meta.icon
                      const rowNumber = (logPage - 1) * logLimit + index + 1

                      return (
                        <TableRow key={log.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                            {rowNumber}
                          </TableCell>
                          <TableCell className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatBrowserDateTime(log.created_at)}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs shrink-0 border border-primary/20">
                                {log.name ? log.name.slice(0, 2).toUpperCase() : <User className="size-3.5" />}
                              </div>
                              <div className="min-w-0">
                                <span className="font-semibold text-xs text-foreground truncate block">
                                  {log.name ?? 'System Administrator'}
                                </span>
                                {log.email && (
                                  <span className="text-[10px] text-muted-foreground truncate block font-mono">
                                    {log.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 whitespace-nowrap">
                            <Badge
                              variant="outline"
                              className={`gap-1 px-2.5 py-0.5 text-[11px] font-mono font-medium ${meta.badgeClass}`}
                            >
                              <ActionIcon className="size-3 shrink-0" />
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-xs text-foreground capitalize">
                                {log.resource_type}
                              </span>
                              {log.resource_id && (
                                <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.2 rounded border border-border/50 truncate max-w-[120px]">
                                  {log.resource_id.slice(0, 8)}...
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 whitespace-nowrap">
                            {log.ip_address ? (
                              <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                                <Globe className="size-3 text-muted-foreground/60 shrink-0" />
                                {log.ip_address}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/60 font-mono">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3 text-right pr-5 whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                              onClick={() => setInspectLog(log)}
                            >
                              <Eye className="mr-1.5 size-3.5" />
                              Inspect
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {logsData?.pagination && logsData.pagination.pages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Showing page <span className="font-semibold text-foreground">{logsData.pagination.page}</span> of{' '}
                  <span className="font-semibold text-foreground">{logsData.pagination.pages}</span> • {logsData.pagination.total} audit logs
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                    onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                    disabled={isPlaceholderLogs || logPage === 1}
                  >
                    <ChevronLeft className="size-3.5 mr-1" />
                    Previous
                  </Button>
                  <span className="text-xs px-1.5 font-mono text-muted-foreground">
                    {logPage} / {logsData.pagination.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                    onClick={() => setLogPage((p) => Math.min(logsData.pagination.pages, p + 1))}
                    disabled={isPlaceholderLogs || logPage >= logsData.pagination.pages}
                  >
                    Next
                    <ChevronRight className="size-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── TAB 2: FAILED CONNECTION ATTEMPTS ─────────────────────────────── */}
        <TabsContent value="attempts" className="space-y-4">
          {/* Attempts Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search failed attempts by username, IP, reason, or node..."
                value={attemptSearch}
                onChange={(e) => {
                  setAttemptSearch(e.target.value)
                  setAttemptPage(1)
                }}
                className="pl-9 pr-8 h-9 text-xs"
              />
              {attemptSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setAttemptSearch('')
                    setAttemptPage(1)
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="text-xs text-muted-foreground font-medium self-end sm:self-center">
              Showing {filteredAttempts.length} of {totalAttemptsCount} recorded attempts
            </div>
          </div>

          {/* Failed Attempts Table */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                      Timestamp
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                      Targeted Username
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[130px]">
                      Client Real IP
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[130px]">
                      Target Node
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[180px]">
                      Failure Diagnostic Reason
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-28">
                      Details
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={`divide-y divide-border/60 transition-opacity duration-150 ${isPlaceholderAttempts ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isLoadingAttempts && !attemptsData ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-4 text-center">
                          <Skeleton className="h-4 w-4 mx-auto" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-28" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell className="py-4">
                          <Skeleton className="h-5 w-32 rounded-full" />
                        </TableCell>
                        <TableCell className="py-4 text-right pr-5">
                          <Skeleton className="h-8 w-16 ml-auto rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredAttempts.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                            <CheckCircle2 className="size-6" />
                          </div>
                          <h3 className="font-semibold text-foreground text-sm">No failed connection attempts</h3>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {attemptSearch
                              ? 'No failed attempts match your search query.'
                              : 'No unauthorized or failed VPN connection attempts detected.'}
                          </p>
                          {attemptSearch && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-4 text-xs cursor-pointer"
                              onClick={() => setAttemptSearch('')}
                            >
                              Clear search
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAttempts.map((att, index) => {
                      const rowNumber = (attemptPage - 1) * attemptLimit + index + 1
                      return (
                        <TableRow key={att.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                            {rowNumber}
                          </TableCell>
                          <TableCell className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatBrowserDateTime(att.attempted_at)}
                          </TableCell>
                          <TableCell className="py-3">
                            <span className="font-mono text-xs font-semibold text-foreground">
                              {att.username}
                            </span>
                          </TableCell>
                          <TableCell className="py-3">
                            <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                              <Globe className="size-3 text-muted-foreground/70 shrink-0" />
                              {att.real_ip}
                            </span>
                          </TableCell>
                          <TableCell className="py-3">
                            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                              <Server className="size-3.5 text-muted-foreground/70 shrink-0" />
                              {att.node_hostname || 'Unassigned'}
                            </span>
                          </TableCell>
                          <TableCell className="py-3">
                            <Badge
                              variant="outline"
                              className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 text-[11px] font-medium"
                            >
                              {att.failure_reason}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 text-right pr-5 whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                              onClick={() => setInspectAttempt(att)}
                            >
                              <Eye className="mr-1.5 size-3.5" />
                              Inspect
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Attempts Pagination */}
            {attemptsData?.pagination && attemptsData.pagination.pages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Showing page <span className="font-semibold text-foreground">{attemptsData.pagination.page}</span> of{' '}
                  <span className="font-semibold text-foreground">{attemptsData.pagination.pages}</span> • {attemptsData.pagination.total} attempts
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                    onClick={() => setAttemptPage((p) => Math.max(1, p - 1))}
                    disabled={isPlaceholderAttempts || attemptPage === 1}
                  >
                    <ChevronLeft className="size-3.5 mr-1" />
                    Previous
                  </Button>
                  <span className="text-xs px-1.5 font-mono text-muted-foreground">
                    {attemptPage} / {attemptsData.pagination.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                    onClick={() => setAttemptPage((p) => Math.min(attemptsData.pagination.pages, p + 1))}
                    disabled={isPlaceholderAttempts || attemptPage >= attemptsData.pagination.pages}
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

      {/* ─── MODAL: INSPECT AUDIT LOG ──────────────────────────────────────── */}
      {inspectLog && (
        <Modal open={!!inspectLog} onClose={() => setInspectLog(null)} className="max-w-2xl">
          <ModalHeader
            title="Audit Event Details"
            description="Complete tamper-evident administrative action record"
            onClose={() => setInspectLog(null)}
          />
          <ModalBody className="space-y-4">
            {/* Header Banner */}
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg border bg-background flex items-center justify-center shrink-0">
                    {(() => {
                      const Icon = getActionMeta(inspectLog.action).icon
                      return <Icon className="size-4 text-primary" />
                    })()}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground font-mono">{inspectLog.action}</h4>
                    <p className="text-xs text-muted-foreground capitalize">Target: {inspectLog.resource_type}</p>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={`self-start sm:self-auto px-2.5 py-1 text-xs font-mono font-medium ${
                    getActionMeta(inspectLog.action).badgeClass
                  }`}
                >
                  {inspectLog.action}
                </Badge>
              </div>

              {/* Attributes Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <User className="size-3" /> Performed By
                  </div>
                  <div className="text-xs font-semibold text-foreground mt-1 truncate">
                    {inspectLog.name ?? 'System Administrator'}
                  </div>
                  {inspectLog.email && (
                    <div className="text-[11px] text-muted-foreground truncate font-mono">{inspectLog.email}</div>
                  )}
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Globe className="size-3" /> Client IP Address
                  </div>
                  <div className="text-xs font-mono font-medium text-foreground mt-1">
                    {inspectLog.ip_address || 'Internal API'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" /> Executed At
                  </div>
                  <div className="text-xs font-medium text-foreground mt-1 tabular-nums">
                    {formatBrowserDateTime(inspectLog.created_at)}
                  </div>
                </div>
              </div>

              {/* Event ID with copy */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border/60 text-xs">
                <span className="text-muted-foreground font-mono truncate">Event ID: {inspectLog.id}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(inspectLog.id, 'logId', 'Event ID')}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer ml-2 shrink-0"
                >
                  {copiedKey === 'logId' ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copiedKey === 'logId' ? 'Copied' : 'Copy ID'}
                </button>
              </div>
            </div>

            {/* Resource Info */}
            <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 text-xs">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Target Resource
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize font-medium">
                  {inspectLog.resource_type}
                </Badge>
                {inspectLog.resource_id && (
                  <span className="font-mono text-xs text-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/60 truncate">
                    ID: {inspectLog.resource_id}
                  </span>
                )}
              </div>
            </div>

            {/* User Agent info if present */}
            {inspectLog.user_agent && (
              <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  User Agent Client String
                </span>
                <p className="font-mono text-[11px] text-muted-foreground break-all">{inspectLog.user_agent}</p>
              </div>
            )}

            {/* Metadata JSON Viewer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileCode className="size-3.5 text-primary" /> Event Payload & Parameters
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => {
                    const content = JSON.stringify(parseJsonSafe(inspectLog.metadata), null, 2)
                    copyToClipboard(content, 'metadata', 'Metadata JSON')
                  }}
                >
                  {copiedKey === 'metadata' ? (
                    <Check className="mr-1 size-3 text-emerald-500" />
                  ) : (
                    <Copy className="mr-1 size-3" />
                  )}
                  {copiedKey === 'metadata' ? 'Copied' : 'Copy JSON'}
                </Button>
              </div>

              <div className="relative rounded-xl border border-border bg-background p-3">
                <pre className="font-mono text-xs overflow-x-auto text-foreground leading-relaxed max-h-64 whitespace-pre-wrap">
                  {inspectLog.metadata
                    ? JSON.stringify(parseJsonSafe(inspectLog.metadata), null, 2)
                    : 'No additional metadata payload attached.'}
                </pre>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInspectLog(null)}
              className="cursor-pointer text-xs"
            >
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ─── MODAL: INSPECT CONNECTION ATTEMPT ─────────────────────────────── */}
      {inspectAttempt && (
        <Modal open={!!inspectAttempt} onClose={() => setInspectAttempt(null)} className="max-w-xl">
          <ModalHeader
            title="Failed Connection Diagnostics"
            description="Security telemetry for rejected VPN handshake attempt"
            onClose={() => setInspectAttempt(null)}
          />
          <ModalBody className="space-y-4">
            {/* Warning card */}
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 space-y-2 text-xs text-red-700 dark:text-red-400">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="size-4 shrink-0" />
                <span>Rejected Connection Handshake</span>
              </div>
              <p className="leading-relaxed">
                A client attempted to initiate a VPN tunnel with username <strong>{inspectAttempt.username}</strong> from IP{' '}
                <strong>{inspectAttempt.real_ip}</strong>, but was rejected by the node security verification.
              </p>
            </div>

            {/* Diagnostic Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-card border border-border">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">Target Username</span>
                <div className="font-mono font-semibold text-foreground text-sm mt-1">{inspectAttempt.username}</div>
              </div>

              <div className="p-3 rounded-lg bg-card border border-border">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">Client Real IP</span>
                <div className="font-mono font-semibold text-foreground text-sm mt-1">{inspectAttempt.real_ip}</div>
              </div>

              <div className="p-3 rounded-lg bg-card border border-border">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">Target Node</span>
                <div className="font-semibold text-foreground text-sm mt-1">
                  {inspectAttempt.node_hostname || 'Unassigned Node'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-card border border-border">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">Attempted At</span>
                <div className="font-medium text-foreground text-sm mt-1 tabular-nums">
                  {formatBrowserDateTime(inspectAttempt.attempted_at)}
                </div>
              </div>
            </div>

            {/* Failure Reason Alert */}
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/70 text-xs space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Info className="size-3 text-primary" /> Failure Diagnostic Reason
              </span>
              <div className="font-mono text-red-600 dark:text-red-400 font-semibold bg-background p-2 rounded border border-red-500/20">
                {inspectAttempt.failure_reason}
              </div>
              {inspectAttempt.error_details && (
                <pre className="font-mono text-[11px] text-muted-foreground mt-2 p-2 bg-background rounded border border-border/60 overflow-x-auto whitespace-pre-wrap">
                  {inspectAttempt.error_details}
                </pre>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInspectAttempt(null)}
              className="cursor-pointer text-xs"
            >
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
