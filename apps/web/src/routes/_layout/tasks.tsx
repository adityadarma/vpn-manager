import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/tasks')({
  component: TasksPage,
})

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Clock, CheckCircle, XCircle, AlertCircle, Server, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface Task {
  id: string
  node_id: string
  node_hostname: string
  type: string
  payload: string
  status: 'pending' | 'done' | 'failed'
  result: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

function formatDate(date: string) {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: () => api.get('/api/v1/tasks'),
    refetchInterval: 10_000, // Auto-refresh every 10s
  })

  // Filter tasks
  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const doneTasks = tasks.filter(t => t.status === 'done')
  const failedTasks = tasks.filter(t => t.status === 'failed')

  // Search filter
  const filterTasks = (taskList: Task[]) => {
    if (!searchQuery) return taskList
    const query = searchQuery.toLowerCase()
    return taskList.filter(t => 
      t.node_hostname.toLowerCase().includes(query) ||
      t.type.toLowerCase().includes(query) ||
      (t.error_message?.toLowerCase().includes(query))
    )
  }

  const filteredPending = filterTasks(pendingTasks)
  const filteredDone = filterTasks(doneTasks)
  const filteredFailed = filterTasks(failedTasks)

  const TaskCard = ({ task }: { task: Task }) => {
    const statusConfig = {
      pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50', label: 'Pending' },
      done: { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Done' },
      failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', label: 'Failed' },
    }

    const config = statusConfig[task.status]
    const Icon = config.icon

    return (
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 border-b border-border/50 bg-muted/10">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                {task.node_hostname}
              </h3>
              <div className="mt-2">
                <Badge variant="outline" className="text-[10px] font-mono tracking-wider uppercase bg-background">
                  {task.type}
                </Badge>
              </div>
            </div>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${config.bg} ${config.color} border-current/20`}>
              <Icon className="h-3.5 w-3.5" />
              {config.label}
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3 text-sm flex-1 flex flex-col">
          <div className="flex justify-between items-center text-xs text-muted-foreground bg-muted/30 p-2 rounded-md border border-border/50">
            <div className="flex flex-col gap-0.5">
              <span className="uppercase text-[10px] font-bold tracking-wider opacity-70">Created</span>
              <span className="font-medium text-foreground">{formatDate(task.created_at)}</span>
            </div>
            {task.completed_at && (
              <div className="flex flex-col gap-0.5 text-right">
                <span className="uppercase text-[10px] font-bold tracking-wider opacity-70">Duration</span>
                <span className="font-medium text-foreground">{formatDuration(task.created_at, task.completed_at)}</span>
              </div>
            )}
          </div>
          
          {task.error_message && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="leading-relaxed font-medium">{task.error_message}</span>
            </div>
          )}
          
          {task.result && task.status === 'done' && (
            <details className="text-xs group mt-auto pt-2 border-t border-border/50">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground list-none flex items-center gap-1.5">
                <span className="border border-border rounded px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider group-open:bg-muted transition-colors">Show Result</span>
              </summary>
              <pre className="mt-2 p-3 bg-muted/50 border border-border/50 rounded-md text-xs overflow-x-auto text-muted-foreground font-mono leading-relaxed">
                {JSON.stringify(JSON.parse(task.result), null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Task Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} • {pendingTasks.length} pending
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
          <div className="text-2xl font-bold text-foreground">{pendingTasks.length}</div>
          <p className="text-xs text-muted-foreground/70 mt-1">Waiting for execution</p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Completed</span>
            <div className="bg-emerald-500/10 p-2 rounded-lg">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{doneTasks.length}</div>
          <p className="text-xs text-muted-foreground/70 mt-1">Successfully executed</p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Failed</span>
            <div className="bg-red-500/10 p-2 rounded-lg">
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{failedTasks.length}</div>
          <p className="text-xs text-muted-foreground/70 mt-1">Execution errors</p>
        </div>
      </div>

      {/* Tabs */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground/70">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border/60 py-16 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-foreground">No tasks yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Tasks will appear here when agents execute operations</p>
        </div>
      ) : (
        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="h-4 w-4" />
              Pending ({pendingTasks.length})
            </TabsTrigger>
            <TabsTrigger value="done" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              Done ({doneTasks.length})
            </TabsTrigger>
            <TabsTrigger value="failed" className="gap-2">
              <XCircle className="h-4 w-4" />
              Failed ({failedTasks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {filteredPending.length === 0 ? (
              <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No pending tasks match your search' : 'No pending tasks'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPending.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="done" className="space-y-4">
            {filteredDone.length === 0 ? (
              <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No completed tasks match your search' : 'No completed tasks'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredDone.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="failed" className="space-y-4">
            {filteredFailed.length === 0 ? (
              <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No failed tasks match your search' : 'No failed tasks'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredFailed.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
