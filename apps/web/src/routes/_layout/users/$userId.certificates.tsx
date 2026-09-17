import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  Download,
  Key,
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import { api, API_URL } from '@/lib/api'
import { formatBrowserDateTime, type User, type VpnNode } from '@vpn/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/_layout/users/$userId/certificates')({
  component: UserCertificatesPage,
})

interface Certificate {
  id: string
  user_id: string
  node_id: string
  node_hostname: string
  node_vpn_type?: string
  credential_name?: string | null
  vpn_ip?: string | null
  password_protected?: boolean
  is_revoked?: boolean
  expires_at?: string | null
  last_vpn_connect?: string | null
  download_count: number
}

// eslint-disable-next-line react-refresh/only-export-components
function UserCertificatesPage() {
  const { userId } = Route.useParams()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    nodeId: '',
    credentialName: '',
    passwordProtected: false,
    password: '',
    expirationDate: '',
  })

  const { data: user } = useQuery<User>({
    queryKey: ['user', userId],
    queryFn: () => api.get(`/api/v1/users/${userId}`),
  })
  const { data: certificates = [], isLoading } = useQuery<Certificate[]>({
    queryKey: ['user-certificates', userId],
    queryFn: () => api.get(`/api/v1/users/${userId}/certificates`),
  })
  const { data: nodes = [] } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })
  const selectedNode = nodes.find((node) => node.id === form.nodeId)

  const generate = useMutation({
    mutationFn: () => {
      const { expirationDate, ...credential } = form
      const [year, month, day] = expirationDate.split('-').map(Number)
      const expiresAt = expirationDate
        ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
        : null
      return api.post(`/api/v1/users/${userId}/generate-cert`, {
        ...credential,
        credentialName: credential.credentialName.trim(),
        password: credential.passwordProtected ? credential.password : undefined,
        expiresAt,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-certificates', userId] })
      setShowForm(false)
      setForm({
        nodeId: '',
        credentialName: '',
        passwordProtected: false,
        password: '',
        expirationDate: '',
      })
      toast.success('Certificate generated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: (certId: string) =>
      api.post(`/api/v1/users/${userId}/certificates/${certId}/revoke`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-certificates', userId] })
      setRevokingId(null)
      setReason('')
      toast.success('Certificate revoked')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = async (cert: Certificate) => {
    try {
      setDownloadingId(cert.id)
      const response = await fetch(`${API_URL}/api/v1/users/${userId}/vpn?certId=${cert.id}`, {
        credentials: 'include',
      })
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.message || 'Failed to generate config',
        )
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${user?.name || 'vpn'}-${cert.credential_name || 'credential'}.${cert.node_vpn_type === 'wireguard' ? 'conf' : 'ovpn'}`
      link.click()
      URL.revokeObjectURL(url)
      qc.invalidateQueries({ queryKey: ['user-certificates', userId] })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to download configuration')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/users"
            className="inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Back to Users
          </Link>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
            Certificates {user ? <span className="font-normal text-muted-foreground">for {user.name}</span> : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {certificates.length} certificate{certificates.length !== 1 ? 's' : ''} • Manage client VPN credentials and configuration downloads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowForm(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add Certificate
          </Button>
        </div>
      </div>

      {/* Redesigned Table Card */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent border-b border-border">
                <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[180px]">
                  Credential
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Node
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  VPN IP
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Expires
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Connect
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Downloads
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60">
              {isLoading ? (
                /* Skeleton shimmer rows */
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="text-center">
                      <Skeleton className="h-4 w-4 mx-auto" />
                    </TableCell>
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="text-center">
                      <Skeleton className="h-4 w-6 mx-auto" />
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : certificates.length === 0 ? (
                /* Empty state */
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="py-16 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <Key className="h-6 w-6 text-muted-foreground/70" />
                      </div>
                      <h3 className="font-semibold text-foreground text-base">No certificates yet</h3>
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        Generate a VPN certificate to allow {user?.name || 'this user'} to connect to the network.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                /* Data rows */
                certificates.map((cert, index) => {
                  const isRevoked = Boolean(cert.is_revoked)
                  return (
                    <TableRow
                      key={cert.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* # Number */}
                      <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                        {index + 1}
                      </TableCell>

                      {/* Credential */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${
                              isRevoked
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            }`}
                          >
                            <Key className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-foreground text-sm">
                                {cert.credential_name || 'default'}
                              </span>
                              {Boolean(cert.password_protected) && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded border border-blue-500/20"
                                  title="Password-protected private key"
                                >
                                  <Lock className="h-2.5 w-2.5" />
                                  Pass
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground/70">
                              {cert.node_vpn_type === 'wireguard' ? 'WireGuard' : 'OpenVPN'}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            isRevoked
                              ? 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isRevoked ? 'bg-rose-500' : 'bg-emerald-500'
                            }`}
                          />
                          {isRevoked ? 'Revoked' : 'Active'}
                        </span>
                      </TableCell>

                      {/* Node */}
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Server className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                          <span className="text-sm font-medium text-foreground">
                            {cert.node_hostname}
                          </span>
                        </div>
                      </TableCell>

                      {/* VPN IP */}
                      <TableCell>
                        {cert.vpn_ip ? (
                          <code className="px-2 py-0.5 rounded text-xs font-mono bg-muted/60 text-foreground border border-border/50">
                            {cert.vpn_ip}
                          </code>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>

                      {/* Expires */}
                      <TableCell className="text-xs whitespace-nowrap">
                        {cert.expires_at ? (
                          <span className="text-muted-foreground">
                            {formatBrowserDateTime(cert.expires_at)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground border border-border/40">
                            Unlimited
                          </span>
                        )}
                      </TableCell>

                      {/* Last Connect */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {cert.last_vpn_connect ? (
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                            <span>{formatBrowserDateTime(cert.last_vpn_connect)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">Never</span>
                        )}
                      </TableCell>

                      {/* Downloads */}
                      <TableCell className="text-center tabular-nums font-mono text-xs text-muted-foreground">
                        {cert.download_count}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right pr-5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="ml-auto flex p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-muted rounded-md transition-colors"
                              aria-label={`Actions for ${cert.credential_name || 'default'}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {!isRevoked ? (
                              <>
                                <DropdownMenuItem
                                  onSelect={() => download(cert)}
                                  disabled={downloadingId === cert.id}
                                >
                                  <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                                  Download config
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setRevokingId(cert.id)}
                                  className="text-red-600 dark:text-red-400 focus:text-red-600"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Revoke certificate
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => {
                                  setForm({
                                    ...form,
                                    nodeId: cert.node_id,
                                    credentialName: cert.credential_name || '',
                                  })
                                  setShowForm(true)
                                }}
                              >
                                <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
                                Renew certificate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!form.nodeId || !form.credentialName.trim())
                return toast.error('Node and credential name are required')
              if (form.passwordProtected && !form.password)
                return toast.error('Password is required')
              generate.mutate()
            }}
            className="my-6 w-full max-w-lg rounded-xl bg-card text-card-foreground shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border/50 p-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Key className="h-5 w-5 text-blue-600" />
                  Generate Certificate
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  For user: <span className="font-medium text-foreground">{user?.name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  VPN Node <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.nodeId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      nodeId: e.target.value,
                      passwordProtected: false,
                      password: '',
                    })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a node...</option>
                  {nodes
                    .filter((n) => n.status === 'online')
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.hostname} ({n.ip_address})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Credential / Device Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.credentialName}
                  onChange={(e) => setForm({ ...form, credentialName: e.target.value })}
                  placeholder="e.g. Laptop, iPhone, Work-PC"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Unique name for this device/credential on this node. Multiple certificates are
                  allowed.
                </p>
              </div>
              {selectedNode?.vpn_type !== 'wireguard' && (
                <>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="block text-sm font-medium">
                        Certificate Expiration Date
                      </label>
                      {form.expirationDate && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, expirationDate: '' })}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear for unlimited
                        </button>
                      )}
                    </div>
                    <input
                      type="date"
                      value={form.expirationDate}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground [color-scheme:light] dark:[color-scheme:dark] cursor-pointer"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {form.expirationDate
                        ? `Certificate expires at the end of ${form.expirationDate}.`
                        : 'Leave empty for unlimited validity.'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.passwordProtected}
                        onChange={(e) =>
                          setForm({ ...form, passwordProtected: e.target.checked, password: '' })
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Lock className="h-4 w-4 text-muted-foreground" />
                          Password-protect private key
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          User will need to enter a password when connecting to VPN.
                        </span>
                      </span>
                    </label>
                    {form.passwordProtected && (
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="Enter key password"
                        className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300">
                    Multiple certificates can be created for the same user on one node using
                    different credential names.
                  </div>
                </>
              )}
              {selectedNode?.vpn_type === 'wireguard' && (
                <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                  WireGuard uses a static keypair and does not support certificate validity or key
                  passphrases.
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t border-border/50 p-4">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={generate.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                {generate.isPending ? 'Generating...' : 'Generate Certificate'}
              </Button>
            </div>
          </form>
        </div>
      )}
      {revokingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-card shadow-xl p-5 space-y-4">
            <h2 className="font-semibold flex gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Revoke Certificate
            </h2>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for revocation"
              className="w-full rounded-lg border border-border p-3"
            />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRevokingId(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                disabled={!reason.trim() || revoke.isPending}
                onClick={() => revoke.mutate(revokingId)}
              >
                Revoke
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
