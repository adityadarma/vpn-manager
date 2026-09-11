import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/tasks')({
  component: TasksPage,
})

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Clock, CheckCircle, XCircle, AlertCircle, Server, Search, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { formatBrowserDateTime } from '@vpn/shared'

interface Task {
  id: string
  node_id: string
  node_hostname: string
  action: string
  payload: string
  status: 'pending' | 'done' | 'failed'
  result: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

function formatDuration(start: string, end: string | null) {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function TasksPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [activeTab, setActiveTab] = useState<'pending' | 'done' | 'failed'>('pending')
  const pageSize = 25

  const { data, isLoading } = useQuery<{ tasks: Task[]; pagination: { page: number; pages: number; total: number }; status_counts: Record<string, number> }>({
    queryKey: ['tasks', activeTab, page],
    queryFn: () => api.get(`/api/v1/tasks?status=${activeTab}&page=${page}&limit=${pageSize}`),
    refetchInterval: 10_000, // Auto-refresh every 10s
  })

  const tasks = data?.tasks ?? []
  const pagination = data?.pagination
  const statusCounts = data?.status_counts ?? {}

  const pendingCount = statusCounts.pending ?? 0
  const doneCount = statusCounts.done ?? 0
  const failedCount = statusCounts.failed ?? 0

  // Search filter
  const filterTasks = (taskList: Task[]) => {
    if (!searchQuery) return taskList
    const query = searchQuery.toLowerCase()
    return taskList.filter(t => 
      t.node_hostname.toLowerCase().includes(query) ||
      t.action.toLowerCase().includes(query) ||
      (t.error_message?.toLowerCase().includes(query))
    )
  }

  const filteredTasks = filterTasks(tasks)

  const TaskRow = ({ task }: { task: Task }) => {
    const statusConfig = {
      pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50', label: 'Pending' },
      done: { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Done' },
      failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', label: 'Failed' },
    }

    const config = statusConfig[task.status]
    const Icon = config.icon

    const details = task.error_message || (task.result && task.status === 'done')

    return (
      <details className="group bg-card text-card-foreground rounded-xl border border-border shadow-sm open:border-primary/30 open:shadow-md transition-all">
        <summary className="list-none cursor-pointer px-4 py-3 sm:px-5 sm:py-3.5 grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(10rem,1.3fr)_minmax(9rem,1fr)_minmax(8rem,0.8fr)_auto] items-center gap-x-3 gap-y-2 hover:bg-muted/30 rounded-xl">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${config.bg} ${config.color}`}>
            <Icon className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs font-semibold text-foreground truncate">{task.action}</span>
              <span className={`sm:hidden inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${config.bg} ${config.color}`}>
                {config.label}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground truncate">
              <Server className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{task.node_hostname}</span>
            </div>
          </div>

          <div className="hidden sm:block min-w-0 text-xs text-muted-foreground tabular-nums">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/70">Created</div>
            <div className="mt-1 truncate">{formatBrowserDateTime(task.created_at)}</div>
          </div>

          <div className="hidden sm:block text-xs text-muted-foreground">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/70">Duration</div>
            <div className="mt-1 font-medium text-foreground">{formatDuration(task.created_at, task.completed_at)}</div>
          </div>

          <div className="col-start-2 sm:col-start-auto flex items-center justify-between gap-3 sm:justify-end">
            <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.color}`}>
              {config.label}
            </span>
            {details ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-open:text-foreground">
                Details
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/60">No details</span>
            )}
          </div>
        </summary>

        {details && (
          <div className="border-t border-border/60 px-4 py-3 sm:px-5 bg-muted/20 space-y-3">
            <div className="sm:hidden flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
              <span>Created: {formatBrowserDateTime(task.created_at)}</span>
              <span>Duration: {formatDuration(task.created_at, task.completed_at)}</span>
            </div>
            {task.error_message && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="leading-relaxed font-medium">{task.error_message}</span>
              </div>
            )}
            {task.result && task.status === 'done' && (
              <pre className="p-3 bg-background border border-border/60 rounded-lg text-xs overflow-x-auto text-muted-foreground font-mono leading-relaxed max-h-64">
                {JSON.stringify(JSON.parse(task.result), null, 2)}
              </pre>
            )}
          </div>
        )}
      </details>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Task Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pagination?.total ?? 0} task{(pagination?.total ?? 0) !== 1 ? 's' : ''} • {pendingCount} pending
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted text-muted-foreground text-xs font-medium rounded-full">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Auto-refresh 10s
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
        <Input
          placeholder="Search tasks by node, type, or error..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card text-card-foreground rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Pending</span>
            <div className="bg-amber-500/10 p-2 rounded-lg">
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{pendingCount}</div>
          <p className="text-xs text-muted-foreground/70 mt-1">Waiting for execution</p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Completed</span>
            <div className="bg-emerald-500/10 p-2 rounded-lg">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{doneCount}</div>
          <p className="text-xs text-muted-foreground/70 mt-1">Successfully executed</p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Failed</span>
            <div className="bg-red-500/10 p-2 rounded-lg">
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{failedCount}</div>
          <p className="text-xs text-muted-foreground/70 mt-1">Execution errors</p>
        </div>
      </div>

      {/* Tabs */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground/70">Loading tasks...</div>
      ) : (pagination?.total ?? 0) === 0 ? (
        <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border/60 py-16 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-foreground">No tasks yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Tasks will appear here when agents execute operations</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as typeof activeTab); setPage(1) }} className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="h-4 w-4" />
              Pending ({pendingCount})
            </TabsTrigger>
            <TabsTrigger value="done" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              Done ({doneCount})
            </TabsTrigger>
            <TabsTrigger value="failed" className="gap-2">
              <XCircle className="h-4 w-4" />
              Failed ({failedCount})
            </TabsTrigger>
          </TabsList>

          {(['pending', 'done', 'failed'] as const).map((status) => (
            <TabsContent key={status} value={status} className="space-y-4">
              {filteredTasks.length === 0 ? (
                <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
                  {searchQuery ? `No ${status} tasks match your search` : `No ${status} tasks`}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {filteredTasks.map(task => <TaskRow key={task.id} task={task} />)}
                  </div>
                  {pagination && pagination.pages > 1 && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
                      <p className="text-sm text-muted-foreground">
                        Page {pagination.page} of {pagination.pages} • {pagination.total} {status} tasks
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1}>
                          <ChevronLeft className="h-4 w-4 mr-1" />
                          Previous
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setPage(current => current + 1)} disabled={page >= pagination.pages}>
                          Next
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}
