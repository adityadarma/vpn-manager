import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useRealtimeConnected } from '@/components/realtime-provider'
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Server,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  Copy,
  Check,
  Eye,
  Shield,
  Key,
  Settings,
  Globe,
  PowerOff,
  RotateCcw,
  FileCode,
  Radio,
  AlertTriangle,
  Layers,
  Activity,
  Calendar,
  Timer,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
import { toast } from 'sonner'

export const Route = createFileRoute('/_layout/tasks')({
  component: TasksPage,
})

interface TaskItem {
  id: string
  node_id: string
  node_hostname: string
  action: string
  payload: string | Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'failed'
  result: string | Record<string, unknown> | null
  error_message: string | null
  created_at: string
  completed_at: string | null
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

function formatDuration(start: string, end: string | null) {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return '—'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  return remSec > 0 ? `${minutes}m ${remSec}s` : `${minutes}m`
}

function getActionMeta(action: string) {
  switch (action) {
    case 'generate_client_cert':
      return {
        label: 'Generate Certificate',
        icon: Key,
        color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20',
      }
    case 'revoke_vpn_user':
    case 'delete_client_ccd':
      return {
        label: 'Revoke User / Certificate',
        icon: AlertTriangle,
        color: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20',
      }
    case 'sync_group_dns':
      return {
        label: 'Sync Group DNS',
        icon: Globe,
        color: 'text-teal-600 dark:text-teal-400 bg-teal-500/10 border-teal-500/20',
      }
    case 'update_server_config':
    case 'sync_server_config':
      return {
        label: 'Update Server Config',
        icon: Settings,
        color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
      }
    case 'apply_network_policy':
    case 'add_firewall_rule':
    case 'remove_firewall_rule':
      return {
        label: 'Apply Network Policy',
        icon: Shield,
        color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      }
    case 'kick_vpn_session':
    case 'unkick_vpn_session':
      return {
        label: 'Kick / Unblock Session',
        icon: PowerOff,
        color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
      }
    case 'reload_openvpn':
      return {
        label: 'Reload OpenVPN Service',
        icon: RotateCcw,
        color: 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20',
      }
    case 'write_client_ccd':
      return {
        label: 'Write Client CCD',
        icon: FileCode,
        color: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
      }
    default:
      return {
        label: action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        icon: Radio,
        color: 'text-muted-foreground bg-muted/60 border-border/60',
      }
  }
}

const statusBadgeConfig = {
  pending: {
    icon: Clock,
    label: 'Pending',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  running: {
    icon: RefreshCw,
    label: 'Running',
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse',
  },
  done: {
    icon: CheckCircle2,
    label: 'Completed',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  },
}

// eslint-disable-next-line react-refresh/only-export-components
function TasksPage() {
  const qc = useQueryClient()
  const realtimeConnected = useRealtimeConnected()
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done' | 'failed'>('all')
  const [selectedNodeId, setSelectedNodeId] = useState<string>('')
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const [inspectTab, setInspectTab] = useState<'payload' | 'result' | 'raw'>('payload')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const pageSize = 10

  // Fetch nodes for node filter
  const { data: nodes = [] } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  // Fetch tasks
  const { data, isLoading, isFetching, isPlaceholderData, refetch } = useQuery<{
    tasks: TaskItem[]
    pagination: { page: number; pages: number; total: number }
    status_counts: Record<string, number>
  }>({
    queryKey: ['tasks', statusFilter, selectedNodeId, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
      })
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }
      if (selectedNodeId) {
        params.append('nodeId', selectedNodeId)
      }
      return api.get(`/api/v1/tasks?${params}`)
    },
    placeholderData: keepPreviousData,
    refetchInterval: realtimeConnected ? false : 60_000,
  })

  const pagination = data?.pagination
  const statusCounts = data?.status_counts ?? {}

  const pendingCount = statusCounts.pending ?? 0
  const doneCount = statusCounts.done ?? 0
  const failedCount = statusCounts.failed ?? 0
  const totalTasks = pendingCount + doneCount + failedCount
  const successRate = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 100

  // Retry mutation
  const retryTask = useMutation({
    mutationFn: (taskId: string) =>
      api.post<{ reused: boolean }>(`/api/v1/tasks/${taskId}/retry`, {}),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success(
        result.reused ? 'An equivalent task is already queued' : 'Task queued for retry',
      )
      if (selectedTask) {
        setSelectedTask((prev) => (prev ? { ...prev, status: 'pending' } : null))
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Client search filter across current page items
  const filteredTasks = useMemo(() => {
    const list = data?.tasks ?? []
    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase()
    return list.filter((t) => {
      const meta = getActionMeta(t.action)
      return (
        t.action.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q) ||
        t.node_hostname.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.error_message && t.error_message.toLowerCase().includes(q))
      )
    })
  }, [data?.tasks, searchQuery])

  const copyToClipboard = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success(`${label} copied to clipboard`)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Operations & Automation
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">Task Queue</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {totalTasks} total task{totalTasks !== 1 ? 's' : ''} recorded • {pendingCount} pending
            execution across {nodes.length} nodes
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="cursor-pointer h-9 px-3 text-xs shadow-xs"
            title="Refresh tasks immediately"
          >
            <RefreshCw
              className={`mr-1.5 size-3.5 ${isFetching ? 'animate-spin text-emerald-600' : ''}`}
            />
            Refresh
          </Button>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 border border-border/70 text-muted-foreground text-xs font-medium rounded-lg">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Auto-refresh 10s
          </span>
        </div>
      </div>

      {/* Interactive Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Total Tasks Card */}
        <div
          onClick={() => {
            setStatusFilter('all')
            setPage(1)
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            statusFilter === 'all'
              ? 'bg-card border-primary ring-2 ring-primary/20 shadow-md'
              : 'bg-card border-border hover:border-primary/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Tasks</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Layers className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{totalTasks}</div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">All queue operations</p>
        </div>

        {/* Pending Card */}
        <div
          onClick={() => {
            setStatusFilter('pending')
            setPage(1)
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            statusFilter === 'pending'
              ? 'bg-card border-amber-500 ring-2 ring-amber-500/20 shadow-md'
              : 'bg-card border-border hover:border-amber-500/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Pending</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{pendingCount}</div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            Waiting for agent execution
          </p>
        </div>

        {/* Completed Card */}
        <div
          onClick={() => {
            setStatusFilter('done')
            setPage(1)
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            statusFilter === 'done'
              ? 'bg-card border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
              : 'bg-card border-border hover:border-emerald-500/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Completed</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{doneCount}</div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1 truncate">
            {successRate}% execution success
          </p>
        </div>

        {/* Failed Card */}
        <div
          onClick={() => {
            setStatusFilter('failed')
            setPage(1)
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            statusFilter === 'failed'
              ? 'bg-card border-red-500 ring-2 ring-red-500/20 shadow-md'
              : 'bg-card border-border hover:border-red-500/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Failed</span>
            <div className="p-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <XCircle className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{failedCount}</div>
          <p className="text-[11px] text-red-600 dark:text-red-400 font-medium mt-1 truncate">
            {failedCount > 0 ? 'Requires attention / retry' : 'No errors reported'}
          </p>
        </div>
      </div>

      {/* Toolbar: Search, Node Filter, and Status Pills */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search & Node Select */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by action, node hostname, or error..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(1)
              }}
              className="pl-9 pr-8 h-9 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setPage(1)
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
              id="task-node-filter"
              className="h-9 w-full rounded-lg border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
              value={selectedNodeId}
              onChange={(e) => {
                setSelectedNodeId(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All VPN Nodes</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.hostname}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs self-start md:self-auto overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all')
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All Tasks ({totalTasks})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('pending')
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'pending'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('done')
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'done'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Completed ({doneCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('failed')
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'failed'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Failed ({failedCount})
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[220px]">
                  Operation / Action
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                  Target Node
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[120px]">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Created
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Duration
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-32">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              className={`divide-y divide-border/60 transition-opacity duration-150 ${isPlaceholderData ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {isLoading && !data ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-center py-4">
                      <Skeleton className="h-4 w-4 mx-auto" />
                    </TableCell>
                    <TableCell className="py-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell className="py-4 text-right pr-5">
                      <Skeleton className="h-8 w-20 ml-auto rounded-md" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredTasks.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <Activity className="size-6 text-muted-foreground/60" />
                      </div>
                      <h3 className="font-semibold text-foreground text-sm">No tasks found</h3>
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        {searchQuery || selectedNodeId || statusFilter !== 'all'
                          ? 'No queue tasks match your search or filter parameters.'
                          : 'No tasks currently exist in the queue.'}
                      </p>
                      {(searchQuery || selectedNodeId || statusFilter !== 'all') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-4 text-xs cursor-pointer"
                          onClick={() => {
                            setSearchQuery('')
                            setSelectedNodeId('')
                            setStatusFilter('all')
                            setPage(1)
                          }}
                        >
                          Clear all filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredTasks.map((task, index) => {
                  const meta = getActionMeta(task.action)
                  const ActionIcon = meta.icon
                  const statusInfo = statusBadgeConfig[task.status] ?? statusBadgeConfig.pending
                  const StatusIcon = statusInfo.icon
                  const rowNumber = (page - 1) * pageSize + index + 1

                  return (
                    <TableRow key={task.id} className="hover:bg-muted/40 transition-colors">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                        {rowNumber}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${meta.color}`}
                          >
                            <ActionIcon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-xs text-foreground truncate">
                              {meta.label}
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground truncate">
                              {task.action}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-1.5 text-xs text-foreground font-medium truncate">
                          <Server className="size-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{task.node_hostname}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge
                          variant="outline"
                          className={`gap-1 px-2 py-0.5 text-[11px] font-medium ${statusInfo.className}`}
                        >
                          <StatusIcon className="size-3 shrink-0" />
                          {statusInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground tabular-nums">
                        {formatBrowserDateTime(task.created_at)}
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs text-foreground font-medium">
                        {formatDuration(task.created_at, task.completed_at)}
                      </TableCell>
                      <TableCell className="py-3 text-right pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          {task.status === 'failed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer shadow-xs"
                              title="Retry failed task"
                              onClick={() => retryTask.mutate(task.id)}
                              disabled={retryTask.isPending}
                            >
                              <RefreshCw
                                className={`size-3.5 ${retryTask.isPending ? 'animate-spin' : ''}`}
                              />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={() => {
                              setSelectedTask(task)
                              setInspectTab(task.status === 'done' ? 'result' : 'payload')
                            }}
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

        {/* Pagination Footer */}
        {pagination && pagination.pages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Showing page <span className="font-semibold text-foreground">{pagination.page}</span>{' '}
              of <span className="font-semibold text-foreground">{pagination.pages}</span> •{' '}
              {pagination.total} {statusFilter !== 'all' ? statusFilter : 'total'} tasks
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                onClick={() => setPage((c) => Math.max(1, c - 1))}
                disabled={isPlaceholderData || page === 1}
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Previous
              </Button>
              <span className="text-xs px-1.5 font-mono text-muted-foreground">
                {page} / {pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs cursor-pointer shadow-xs"
                onClick={() => setPage((c) => Math.min(pagination.pages, c + 1))}
                disabled={isPlaceholderData || page >= pagination.pages}
              >
                Next
                <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL: TASK DETAIL INSPECTION ─────────────────────────────────── */}
      {selectedTask && (
        <Modal open={!!selectedTask} onClose={() => setSelectedTask(null)} className="max-w-2xl">
          <ModalHeader
            title="Task Details"
            description="Inspect execution parameters, result, and runtime diagnostic data"
            onClose={() => setSelectedTask(null)}
          />
          <ModalBody className="space-y-4">
            {/* Top Info Banner */}
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                      getActionMeta(selectedTask.action).color
                    }`}
                  >
                    {(() => {
                      const Icon = getActionMeta(selectedTask.action).icon
                      return <Icon className="size-4" />
                    })()}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {getActionMeta(selectedTask.action).label}
                    </h4>
                    <p className="font-mono text-xs text-muted-foreground">{selectedTask.action}</p>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={`self-start sm:self-auto gap-1 px-2.5 py-1 text-xs font-medium ${
                    (statusBadgeConfig[selectedTask.status] ?? statusBadgeConfig.pending).className
                  }`}
                >
                  {(() => {
                    const Icon = (
                      statusBadgeConfig[selectedTask.status] ?? statusBadgeConfig.pending
                    ).icon
                    return <Icon className="size-3.5" />
                  })()}
                  {(statusBadgeConfig[selectedTask.status] ?? statusBadgeConfig.pending).label}
                </Badge>
              </div>

              {/* Detail Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Server className="size-3" /> Target Node
                  </div>
                  <div className="text-xs font-semibold text-foreground mt-1 truncate">
                    {selectedTask.node_hostname}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Calendar className="size-3" /> Created At
                  </div>
                  <div className="text-xs font-medium text-foreground mt-1 truncate tabular-nums">
                    {formatBrowserDateTime(selectedTask.created_at)}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Timer className="size-3" /> Runtime Duration
                  </div>
                  <div className="text-xs font-mono font-medium text-foreground mt-1">
                    {formatDuration(selectedTask.created_at, selectedTask.completed_at)}
                  </div>
                </div>
              </div>

              {/* Task ID with Copy */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border/60 text-xs">
                <span className="text-muted-foreground font-mono truncate">
                  ID: {selectedTask.id}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedTask.id, 'taskId', 'Task ID')}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer ml-2 shrink-0"
                >
                  {copiedKey === 'taskId' ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedKey === 'taskId' ? 'Copied' : 'Copy ID'}
                </button>
              </div>
            </div>

            {/* Error Message Banner */}
            {selectedTask.error_message && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Execution Failure Diagnostic</span>
                </div>
                <p className="leading-relaxed font-mono bg-background/80 p-2.5 rounded-lg border border-red-500/20 whitespace-pre-wrap">
                  {selectedTask.error_message}
                </p>
              </div>
            )}

            {/* Data Viewers Tabs: Payload, Result, Raw */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setInspectTab('payload')}
                    className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      inspectTab === 'payload'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Payload (Input)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectTab('result')}
                    className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      inspectTab === 'result'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Result (Output)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectTab('raw')}
                    className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      inspectTab === 'raw'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Complete JSON
                  </button>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => {
                    const content =
                      inspectTab === 'payload'
                        ? JSON.stringify(parseJsonSafe(selectedTask.payload), null, 2)
                        : inspectTab === 'result'
                          ? JSON.stringify(parseJsonSafe(selectedTask.result), null, 2)
                          : JSON.stringify(selectedTask, null, 2)
                    copyToClipboard(content, inspectTab, 'JSON content')
                  }}
                >
                  {copiedKey === inspectTab ? (
                    <Check className="mr-1 size-3 text-emerald-500" />
                  ) : (
                    <Copy className="mr-1 size-3" />
                  )}
                  {copiedKey === inspectTab ? 'Copied' : 'Copy JSON'}
                </Button>
              </div>

              <div className="relative rounded-xl border border-border bg-background p-3">
                <pre className="font-mono text-xs overflow-x-auto text-foreground leading-relaxed max-h-64 whitespace-pre-wrap">
                  {inspectTab === 'payload' &&
                    JSON.stringify(parseJsonSafe(selectedTask.payload), null, 2)}
                  {inspectTab === 'result' &&
                    (selectedTask.result
                      ? JSON.stringify(parseJsonSafe(selectedTask.result), null, 2)
                      : 'No result output recorded for this task.')}
                  {inspectTab === 'raw' && JSON.stringify(selectedTask, null, 2)}
                </pre>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            {selectedTask.status === 'failed' && (
              <Button
                type="button"
                onClick={() => retryTask.mutate(selectedTask.id)}
                disabled={retryTask.isPending}
                className="bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs text-xs"
              >
                <RefreshCw
                  className={`mr-1.5 size-3.5 ${retryTask.isPending ? 'animate-spin' : ''}`}
                />
                Retry Task
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedTask(null)}
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
