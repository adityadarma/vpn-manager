import { createFileRoute, redirect } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useRealtimeConnected } from '@/components/realtime-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBrowserDateTime } from '@vpn/shared'
import { toast } from 'sonner'

export const Route = createFileRoute('/_layout/alerts')({
  beforeLoad: () => {
    if (useAuthStore.getState().user?.role !== 'admin') throw redirect({ to: '/' })
  },
  component: AlertsPage,
})

interface AlertItem {
  id: string
  event: string
  severity: 'warning' | 'critical'
  status: 'open' | 'acknowledged' | 'resolved'
  resource_name: string
  summary: string
  occurrence_count: number
  last_occurred_at: string
}

// eslint-disable-next-line react-refresh/only-export-components
function AlertsPage() {
  const qc = useQueryClient()
  const realtimeConnected = useRealtimeConnected()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('open')
  const [severity, setSeverity] = useState('all')

  const { data, isFetching, isPlaceholderData, refetch } = useQuery<{
    alerts: AlertItem[]
    pagination: { page: number; pages: number; total: number }
    status_counts: Record<string, number>
  }>({
    queryKey: ['alerts', status, severity, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '10' })
      if (status !== 'all') params.set('status', status)
      if (severity !== 'all') params.set('severity', severity)
      return api.get(`/api/v1/alerts?${params}`)
    },
    placeholderData: keepPreviousData,
    refetchInterval: realtimeConnected ? false : 60_000,
  })

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.patch(`/api/v1/alerts/${id}/acknowledge`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alert acknowledged')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const counts = data?.status_counts ?? {}
  const openCount = counts.open ?? 0
  const ackCount = counts.acknowledged ?? 0
  const resCount = counts.resolved ?? 0
  const totalAlerts = openCount + ackCount + resCount
  const showActions = status === 'all' || status === 'open'

  const handleStatusFilter = (targetStatus: string) => {
    setStatus((prev) => (prev === targetStatus ? 'all' : targetStatus))
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Operations & Automation
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
            Operational Alerts
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {totalAlerts} total incident{totalAlerts !== 1 ? 's' : ''} recorded • {openCount} active
            requiring attention
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="cursor-pointer h-9 px-3 text-xs shadow-xs"
            title="Refresh alerts immediately"
          >
            <RefreshCw
              className={`mr-1.5 size-3.5 ${isFetching ? 'animate-spin text-emerald-600' : ''}`}
            />
            Refresh
          </Button>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 border border-border/70 text-muted-foreground text-xs font-medium rounded-lg">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            {realtimeConnected ? 'Live Realtime' : 'Auto-refresh 60s'}
          </span>
        </div>
      </div>

      {/* Interactive Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Total Alerts Card */}
        <div
          role="button"
          tabIndex={0}
          title="Click to show all alerts"
          onClick={() => {
            setStatus('all')
            setPage(1)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setStatus('all')
              setPage(1)
            }
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            status === 'all'
              ? 'bg-card border-primary ring-2 ring-primary/20 shadow-md'
              : 'bg-card border-border hover:border-primary/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Alerts</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Bell className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{totalAlerts}</div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">All incident records</p>
        </div>

        {/* Open Card */}
        <div
          role="button"
          tabIndex={0}
          title="Click to filter open alerts"
          onClick={() => handleStatusFilter('open')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleStatusFilter('open')
            }
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            status === 'open'
              ? 'bg-card border-red-500 ring-2 ring-red-500/20 shadow-md'
              : 'bg-card border-border hover:border-red-500/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Open</span>
            <div className="p-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertCircle className="size-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-red-600 dark:text-red-400">{openCount}</span>
            {openCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 animate-pulse">
                Action needed
              </span>
            )}
          </div>
          <p className="text-[11px] text-red-600 dark:text-red-400 font-medium mt-1 truncate">
            {openCount > 0 ? 'Requires operator action' : 'No active incidents'}
          </p>
        </div>

        {/* Acknowledged Card */}
        <div
          role="button"
          tabIndex={0}
          title="Click to filter acknowledged alerts"
          onClick={() => handleStatusFilter('acknowledged')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleStatusFilter('acknowledged')
            }
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            status === 'acknowledged'
              ? 'bg-card border-amber-500 ring-2 ring-amber-500/20 shadow-md'
              : 'bg-card border-border hover:border-amber-500/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Acknowledged</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-2">
            {ackCount}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            {ackCount > 0 ? 'Under review / silenced' : 'None in progress'}
          </p>
        </div>

        {/* Resolved Card */}
        <div
          role="button"
          tabIndex={0}
          title="Click to filter resolved alerts"
          onClick={() => handleStatusFilter('resolved')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleStatusFilter('resolved')
            }
          }}
          className={`rounded-xl border p-4 shadow-xs transition-all cursor-pointer select-none ${
            status === 'resolved'
              ? 'bg-card border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
              : 'bg-card border-border hover:border-emerald-500/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Resolved</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
            {resCount}
          </div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1 truncate">
            {resCount > 0
              ? `${resCount} incident${resCount !== 1 ? 's' : ''} resolved`
              : 'No resolved alerts'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="size-4" /> Alert History
          </CardTitle>
          <div className="flex gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={severity}
              onValueChange={(value) => {
                setSeverity(value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Incident</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last occurrence</TableHead>
                  {showActions && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.alerts ?? []).map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          alert.severity === 'critical'
                            ? 'border-red-500/30 bg-red-500/10 text-red-600'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                        }
                      >
                        <AlertTriangle className="mr-1 size-3" />
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{alert.summary}</div>
                      <div className="text-xs text-muted-foreground">
                        {alert.event} · occurred {alert.occurrence_count}x
                      </div>
                    </TableCell>
                    <TableCell>{alert.resource_name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          alert.status === 'resolved'
                            ? 'text-emerald-600'
                            : alert.status === 'acknowledged'
                              ? 'text-amber-600'
                              : 'text-red-600'
                        }
                      >
                        {alert.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatBrowserDateTime(alert.last_occurred_at)}
                    </TableCell>
                    {showActions && (
                      <TableCell className="text-right">
                        {alert.status === 'open' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acknowledge.mutate(alert.id)}
                          >
                            <CheckCircle2 className="size-4" /> Acknowledge
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!data?.alerts.length && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={showActions ? 6 : 5} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2.5">
                          <BellRing className="size-5 text-muted-foreground/60" />
                        </div>
                        <p className="font-semibold text-foreground text-sm">No alerts found</p>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          {status !== 'all' || severity !== 'all'
                            ? 'No alerts match your selected status or severity filter.'
                            : 'No operational alerts recorded in the system.'}
                        </p>
                        {(status !== 'all' || severity !== 'all') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 text-xs cursor-pointer"
                            onClick={() => {
                              setStatus('all')
                              setSeverity('all')
                              setPage(1)
                            }}
                          >
                            Reset all filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {data?.pagination && data.pagination.pages > 1 && (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row">
              <p className="text-xs text-muted-foreground">
                Showing page{' '}
                <span className="font-semibold text-foreground">{data.pagination.page}</span> of{' '}
                <span className="font-semibold text-foreground">{data.pagination.pages}</span> •{' '}
                {data.pagination.total} alerts
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 cursor-pointer px-2.5 text-xs shadow-xs"
                  disabled={isPlaceholderData || page === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft className="mr-1 size-3.5" />
                  Previous
                </Button>
                <span className="px-1.5 font-mono text-xs text-muted-foreground">
                  {page} / {data.pagination.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 cursor-pointer px-2.5 text-xs shadow-xs"
                  disabled={isPlaceholderData || page >= data.pagination.pages}
                  onClick={() => setPage((value) => Math.min(data.pagination.pages, value + 1))}
                >
                  Next
                  <ChevronRight className="ml-1 size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
