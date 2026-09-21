import { createFileRoute, redirect } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useRealtimeConnected } from '@/components/realtime-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/components/ui/modal'
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

interface Channel {
  id: string
  name: string
  type: ProviderType
  enabled: boolean
}

type ProviderType = 'slack' | 'telegram'

const providerLabels: Record<ProviderType, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
}

// eslint-disable-next-line react-refresh/only-export-components
function AlertsPage() {
  const qc = useQueryClient()
  const realtimeConnected = useRealtimeConnected()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('open')
  const [severity, setSeverity] = useState('all')
  const [channelModalOpen, setChannelModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ProviderType>('slack')
  const [url, setUrl] = useState('')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')

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

  const { data: channelData } = useQuery<{ channels: Channel[] }>({
    queryKey: ['alert-channels'],
    queryFn: () => api.get('/api/v1/alerts/channels'),
  })

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.patch(`/api/v1/alerts/${id}/acknowledge`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alert acknowledged')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const createChannel = useMutation({
    mutationFn: () => {
      const providerConfig = provider === 'telegram' ? { botToken, chatId } : { url }
      return api.post('/api/v1/alerts/channels', {
        name,
        type: provider,
        enabled: true,
        ...providerConfig,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alert-channels'] })
      setChannelModalOpen(false)
      setName('')
      setProvider('slack')
      setUrl('')
      setBotToken('')
      setChatId('')
      toast.success('Notification channel created')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const deleteChannel = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/alerts/channels/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alert-channels'] })
      toast.success('Notification channel deleted')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const counts = data?.status_counts ?? {}
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operational Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Node, task, credential, and Managed DNS incidents.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => setChannelModalOpen(true)}>
            <Plus className="size-4" /> Add Channel
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Open</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-red-600">
            {counts.open ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Acknowledged</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-amber-600">
            {counts.acknowledged ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Resolved</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-emerald-600">
            {counts.resolved ?? 0}
          </CardContent>
        </Card>
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
                  <TableHead className="text-right">Action</TableHead>
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
                  </TableRow>
                ))}
                {!data?.alerts.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                      No alerts match the selected filters.
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(channelData?.channels ?? []).map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <div className="font-medium">{channel.name}</div>
                <div className="text-xs text-muted-foreground">
                  {providerLabels[channel.type]} · {channel.enabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="text-red-600"
                onClick={() => deleteChannel.mutate(channel.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {!channelData?.channels.length && (
            <p className="text-sm text-muted-foreground">
              No notification channel configured. Alerts remain available in this page.
            </p>
          )}
        </CardContent>
      </Card>

      <Modal open={channelModalOpen} onClose={() => setChannelModalOpen(false)}>
        <ModalHeader
          title="Add Notification Channel"
          description="Choose a provider and enter its delivery credentials."
          onClose={() => setChannelModalOpen(false)}
        />
        <ModalBody className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Operations alerts"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Provider</label>
            <Select value={provider} onValueChange={(value) => setProvider(value as ProviderType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(providerLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {provider === 'slack' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Webhook URL</label>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Slack incoming webhook URL"
              />
              <p className="mt-1 text-xs text-muted-foreground">HTTPS public endpoints only.</p>
            </div>
          )}
          {provider === 'telegram' && (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Bot token</label>
                <Input
                  type="password"
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder="123456789:AA..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Chat ID</label>
                <Input
                  value={chatId}
                  onChange={(event) => setChatId(event.target.value)}
                  placeholder="-1001234567890"
                />
              </div>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setChannelModalOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !name ||
              createChannel.isPending ||
              (provider === 'slack' && !url) ||
              (provider === 'telegram' && (!botToken || !chatId))
            }
            onClick={() => createChannel.mutate()}
          >
            Create Channel
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
