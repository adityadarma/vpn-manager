import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import {
  BellRing,
  Database,
  Download,
  HardDriveDownload,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, API_URL } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/components/ui/modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatBrowserDateTime } from '@vpn/shared'
import { toast } from 'sonner'

export const Route = createFileRoute('/_layout/settings')({
  beforeLoad: () => {
    if (useAuthStore.getState().user?.role !== 'admin') throw redirect({ to: '/' })
  },
  component: SettingsPage,
})

type Provider = 'slack' | 'telegram'
type AlertEvent = 'node.offline' | 'task.failed' | 'credential.expiring' | 'dns.sync_failed'
interface Channel {
  id: string
  name: string
  type: Provider
  enabled: boolean
  minimum_severity: 'warning' | 'critical'
  events: string | AlertEvent[] | null
  send_resolved: boolean
}
interface Backup {
  name: string
  size: number
  createdAt: string
}
interface RetentionSettings {
  session_retention_days: number | null
  task_retention_days: number | null
  audit_retention_days: number | null
  alert_retention_days: number | null
  delivery_retention_days: number | null
  dns_revision_retention_days: number | null
  last_cleanup_at: string | null
  last_cleanup_result: string | Record<string, number> | null
}

const eventLabels: Record<AlertEvent, string> = {
  'node.offline': 'Node offline',
  'task.failed': 'Task failed',
  'credential.expiring': 'Credential expiring',
  'dns.sync_failed': 'Managed DNS failed',
}
const retentionFields: Array<{
  key: keyof RetentionSettings
  label: string
  description: string
  min: number
}> = [
  {
    key: 'session_retention_days',
    label: 'Completed sessions',
    description: 'Disconnected VPN session history',
    min: 7,
  },
  {
    key: 'task_retention_days',
    label: 'Completed tasks',
    description: 'Done and failed agent tasks',
    min: 7,
  },
  {
    key: 'audit_retention_days',
    label: 'Audit logs',
    description: 'Administrative activity history',
    min: 30,
  },
  {
    key: 'alert_retention_days',
    label: 'Resolved alerts',
    description: 'Resolved incident history',
    min: 7,
  },
  {
    key: 'delivery_retention_days',
    label: 'Notification deliveries',
    description: 'Delivered and exhausted attempts',
    min: 7,
  },
  {
    key: 'dns_revision_retention_days',
    label: 'DNS revisions',
    description: 'Terminal Managed DNS revisions',
    min: 7,
  },
]

function parseEvents(value: Channel['events']): AlertEvent[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    return JSON.parse(value) as AlertEvent[]
  } catch {
    return []
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// eslint-disable-next-line react-refresh/only-export-components
function SettingsPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [channelOpen, setChannelOpen] = useState(false)
  const [provider, setProvider] = useState<Provider>('slack')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [minimumSeverity, setMinimumSeverity] = useState<'warning' | 'critical'>('warning')
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [sendResolved, setSendResolved] = useState(true)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const restoreInputRef = useRef<HTMLInputElement>(null)

  const { data: backupsData } = useQuery<{ backups: Backup[] }>({
    queryKey: ['settings-backups'],
    queryFn: () => api.get('/api/v1/settings/backups'),
  })
  const { data: channelsData } = useQuery<{ channels: Channel[] }>({
    queryKey: ['alert-channels'],
    queryFn: () => api.get('/api/v1/alerts/channels'),
  })
  const { data: settingsData } = useQuery<{ settings: RetentionSettings }>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/v1/settings'),
  })
  const { data: previewData, refetch: refreshPreview } = useQuery<{
    preview: Record<string, number>
  }>({
    queryKey: ['retention-preview'],
    queryFn: () => api.get('/api/v1/settings/retention/preview'),
  })
  const [retentionDraft, setRetentionDraft] = useState<
    Partial<Record<keyof RetentionSettings, string>>
  >({})

  const createBackupMutation = useMutation({
    mutationFn: () => api.post('/api/v1/settings/backups', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings-backups'] })
      toast.success('Database backup created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteBackupMutation = useMutation({
    mutationFn: (backupName: string) =>
      api.delete(`/api/v1/settings/backups/${encodeURIComponent(backupName)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings-backups'] })
      toast.success('Database backup deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const createChannel = useMutation({
    mutationFn: () =>
      api.post('/api/v1/alerts/channels', {
        name,
        type: provider,
        enabled: true,
        minimumSeverity,
        events,
        sendResolved,
        ...(provider === 'slack' ? { url } : { botToken, chatId }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alert-channels'] })
      setChannelOpen(false)
      setName('')
      setUrl('')
      setBotToken('')
      setChatId('')
      toast.success('Notification channel created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const updateChannel = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.patch(`/api/v1/alerts/channels/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alert-channels'] }),
    onError: (e: Error) => toast.error(e.message),
  })
  const testChannel = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/alerts/channels/${id}/test`, {}),
    onSuccess: () => toast.success('Test notification delivered'),
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteChannel = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/alerts/channels/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alert-channels'] })
      toast.success('Channel deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const saveRetention = useMutation({
    mutationFn: () =>
      api.patch(
        '/api/v1/settings/retention',
        Object.fromEntries(
          retentionFields.map(({ key }) => {
            const raw = retentionDraft[key]
            const current = settingsData?.settings[key]
            return [key, raw === undefined ? current : raw === '' ? null : Number(raw)]
          }),
        ),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
      void refreshPreview()
      toast.success('Retention settings saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const cleanup = useMutation({
    mutationFn: () =>
      api.post<{ result: Record<string, number> }>('/api/v1/settings/retention/cleanup', {}),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
      void refreshPreview()
      toast.success(
        `Cleanup removed ${Object.values(data.result).reduce((a, b) => a + b, 0)} records`,
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const downloadBackup = async (backup: Backup) => {
    const response = await fetch(
      `${API_URL}/api/v1/settings/backups/${encodeURIComponent(backup.name)}/download`,
      { credentials: 'include' },
    )
    if (!response.ok) return toast.error('Backup download failed')
    const objectUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = backup.name
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }

  const removeBackup = async (backup: Backup) => {
    const accepted = await confirm({
      title: 'Delete database backup?',
      target: { label: 'Backup', value: backup.name },
      warning: 'This backup file will be permanently deleted.',
      confirmLabel: 'Delete Backup',
      tone: 'danger',
    })
    if (accepted) deleteBackupMutation.mutate(backup.name)
  }

  const restore = async () => {
    if (!restoreFile) return
    const accepted = await confirm({
      title: 'Stage database restore?',
      subtitle: 'A restart is required',
      description:
        'The uploaded database will be validated and a safety backup will be created. The current database is replaced only on the next API restart.',
      warning: 'All changes made after the uploaded backup will be lost after restart.',
      confirmLabel: 'Stage Restore',
      tone: 'danger',
    })
    if (!accepted) return
    const response = await fetch(`${API_URL}/api/v1/settings/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/vnd.sqlite3' },
      body: restoreFile,
    })
    const body = (await response.json().catch(() => ({}))) as {
      message?: string
      safety_backup?: string
    }
    if (!response.ok) return toast.error(body.message ?? 'Restore validation failed')
    setRestoreFile(null)
    if (restoreInputRef.current) restoreInputRef.current.value = ''
    toast.success(
      `Restore staged. Restart the API to apply it. Safety backup: ${body.safety_backup}`,
    )
  }

  const runCleanup = async () => {
    const total = Object.values(previewData?.preview ?? {}).reduce((a, b) => a + b, 0)
    const accepted = await confirm({
      title: 'Delete expired historical data?',
      description: `${total} records currently match the retention policy. Active sessions, pending tasks, open alerts, and active DNS revisions are protected.`,
      warning: 'Deleted records cannot be recovered without restoring a database backup.',
      confirmLabel: 'Clean Up Now',
      tone: 'danger',
    })
    if (accepted) cleanup.mutate()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Database continuity, notification delivery, and historical data lifecycle.
        </p>
      </div>
      <Tabs defaultValue="backup">
        <TabsList className="grid h-auto w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="backup">
            <Database className="mr-1.5 size-4" />
            Backup
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <BellRing className="mr-1.5 size-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="retention">
            <Settings2 className="mr-1.5 size-4" />
            Retention
          </TabsTrigger>
        </TabsList>

        <TabsContent value="backup" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Backup & Restore</CardTitle>
              <CardDescription>
                Create consistent SQLite snapshots and stage validated restores.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Create database backup</p>
                  <p className="text-sm text-muted-foreground">
                    Includes accounts, nodes, credentials, policies, DNS, alerts, and history.
                  </p>
                </div>
                <Button
                  onClick={() => createBackupMutation.mutate()}
                  disabled={createBackupMutation.isPending}
                >
                  <HardDriveDownload className="size-4" />
                  Create Backup
                </Button>
              </div>
              <div className="rounded-lg border p-4">
                <p className="font-medium">Restore from backup</p>
                <p className="mb-3 text-sm text-muted-foreground">
                  Upload a VPN Manager SQLite backup. Validation and a safety backup run before
                  staging.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    ref={restoreInputRef}
                    type="file"
                    accept=".sqlite,.db,application/vnd.sqlite3"
                    onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                  />
                  <Button variant="outline" disabled={!restoreFile} onClick={() => void restore()}>
                    <Upload className="size-4" />
                    Stage Restore
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">Available backups</h3>
                {(backupsData?.backups ?? []).map((backup) => (
                  <div
                    key={backup.name}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <div>
                      <p className="font-mono text-sm">{backup.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(backup.size)} · {formatBrowserDateTime(backup.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Download backup"
                        aria-label={`Download ${backup.name}`}
                        onClick={() => void downloadBackup(backup)}
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-600 hover:text-red-600"
                        title="Delete backup"
                        aria-label={`Delete ${backup.name}`}
                        disabled={deleteBackupMutation.isPending}
                        onClick={() => void removeBackup(backup)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {!backupsData?.backups.length && (
                  <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                    No backups created yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setChannelOpen(true)}>
              <Plus className="size-4" />
              Add Channel
            </Button>
          </div>
          {(channelsData?.channels ?? []).map((channel) => {
            const selectedEvents = parseEvents(channel.events)
            return (
              <Card key={channel.id}>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{channel.name}</CardTitle>
                    <CardDescription>
                      {channel.type === 'slack' ? 'Slack' : 'Telegram'} · minimum{' '}
                      {channel.minimum_severity}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={channel.enabled ? 'text-emerald-600' : 'text-muted-foreground'}
                  >
                    {channel.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Minimum severity</span>
                      <Select
                        value={channel.minimum_severity}
                        onValueChange={(value) =>
                          updateChannel.mutate({ id: channel.id, body: { minimumSeverity: value } })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="warning">Warning</SelectItem>
                          <SelectItem value="critical">Critical only</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span>Send recovery notifications</span>
                      <input
                        type="checkbox"
                        checked={Boolean(channel.send_resolved)}
                        onChange={(e) =>
                          updateChannel.mutate({
                            id: channel.id,
                            body: { sendResolved: e.target.checked },
                          })
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">
                      Events{' '}
                      <span className="font-normal text-muted-foreground">
                        (none selected means all)
                      </span>
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(eventLabels).map(([event, label]) => (
                        <label
                          key={event}
                          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedEvents.includes(event as AlertEvent)}
                            onChange={(e) =>
                              updateChannel.mutate({
                                id: channel.id,
                                body: {
                                  events: e.target.checked
                                    ? [...selectedEvents, event]
                                    : selectedEvents.filter((item) => item !== event),
                                },
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateChannel.mutate({
                          id: channel.id,
                          body: { enabled: !channel.enabled },
                        })
                      }
                    >
                      {channel.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testChannel.mutate(channel.id)}
                    >
                      <Send className="size-4" />
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: 'Delete notification channel?',
                            target: { label: 'Channel', value: channel.name },
                            warning:
                              'Stored credentials and delivery history for this channel will be deleted.',
                            confirmLabel: 'Delete',
                          })
                        )
                          deleteChannel.mutate(channel.id)
                      }}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {!channelsData?.channels.length && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No Slack or Telegram channels configured.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="retention">
          <Card>
            <CardHeader>
              <CardTitle>Data Retention</CardTitle>
              <CardDescription>
                Cleanup runs daily. Leave a value blank to retain that data indefinitely.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {retentionFields.map((field) => (
                  <label key={field.key} className="rounded-lg border p-3">
                    <span className="text-sm font-medium">{field.label}</span>
                    <span className="block text-xs text-muted-foreground">{field.description}</span>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        min={field.min}
                        max={3650}
                        value={
                          retentionDraft[field.key] ??
                          String(settingsData?.settings[field.key] ?? '')
                        }
                        onChange={(e) =>
                          setRetentionDraft((current) => ({
                            ...current,
                            [field.key]: e.target.value,
                          }))
                        }
                      />
                      <span className="text-sm text-muted-foreground">days</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">
                    Cleanup preview:{' '}
                    {Object.values(previewData?.preview ?? {}).reduce((a, b) => a + b, 0)} records
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last cleanup:{' '}
                    {settingsData?.settings.last_cleanup_at
                      ? formatBrowserDateTime(settingsData.settings.last_cleanup_at)
                      : 'Never'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void refreshPreview()}>
                    <RefreshCw className="size-4" />
                    Preview
                  </Button>
                  <Button variant="outline" onClick={() => void runCleanup()}>
                    Clean Up Now
                  </Button>
                  <Button onClick={() => saveRetention.mutate()}>Save Policy</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Modal open={channelOpen} onClose={() => setChannelOpen(false)}>
        <ModalHeader
          title="Add Notification Channel"
          description="Credentials are encrypted before storage."
          onClose={() => setChannelOpen(false)}
        />
        <ModalBody>
          <label className="space-y-1 text-sm">
            <span>Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span>Provider</span>
            <Select value={provider} onValueChange={(value) => setProvider(value as Provider)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="telegram">Telegram</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {provider === 'slack' ? (
            <label className="space-y-1 text-sm">
              <span>Incoming webhook URL</span>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
          ) : (
            <>
              <label className="space-y-1 text-sm">
                <span>Bot token</span>
                <Input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Chat ID</span>
                <Input value={chatId} onChange={(e) => setChatId(e.target.value)} />
              </label>
            </>
          )}
          <label className="space-y-1 text-sm">
            <span>Minimum severity</span>
            <Select
              value={minimumSeverity}
              onValueChange={(value) => setMinimumSeverity(value as 'warning' | 'critical')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical only</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendResolved}
              onChange={(e) => setSendResolved(e.target.checked)}
            />
            Send recovery notifications
          </label>
          <div>
            <p className="mb-2 text-sm">Events (none means all)</p>
            {Object.entries(eventLabels).map(([event, label]) => (
              <label key={event} className="mr-4 inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={events.includes(event as AlertEvent)}
                  onChange={(e) =>
                    setEvents((current) =>
                      e.target.checked
                        ? [...current, event as AlertEvent]
                        : current.filter((item) => item !== event),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setChannelOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name || (provider === 'slack' ? !url : !botToken || !chatId)}
            onClick={() => createChannel.mutate()}
          >
            Create Channel
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
