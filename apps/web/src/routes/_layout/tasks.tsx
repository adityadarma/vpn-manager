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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                {task.node_hostname}
              </CardTitle>
              <CardDescription className="mt-1">
                <Badge variant="outline" className="text-xs">
                  {task.type}
                </Badge>
              </CardDescription>
            </div>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
              <Icon className="h-3.5 w-3.5" />
              {config.label}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Created: {formatDate(task.created_at)}</span>
            {task.completed_at && (
              <span>Duration: {formatDuration(task.created_at, task.completed_at)}</span>
            )}
          </div>
          
          {task.error_message && (
            <div className="flex items-start gap-2 p-2 bg-red-50 rounded-md text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{task.error_message}</span>
            </div>
          )}
          
          {task.result && task.status === 'done' && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                View result
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                {JSON.stringify(JSON.parse(task.result), null, 2)}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingTasks.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Waiting for execution</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{doneTasks.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Successfully executed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failedTasks.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Execution errors</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground/70">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Clock className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="font-medium text-foreground">No tasks yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Tasks will appear here when agents execute operations</p>
          </CardContent>
        </Card>
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
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {searchQuery ? 'No pending tasks match your search' : 'No pending tasks'}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPending.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="done" className="space-y-4">
            {filteredDone.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {searchQuery ? 'No completed tasks match your search' : 'No completed tasks'}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredDone.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="failed" className="space-y-4">
            {filteredFailed.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {searchQuery ? 'No failed tasks match your search' : 'No failed tasks'}
                </CardContent>
              </Card>
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
