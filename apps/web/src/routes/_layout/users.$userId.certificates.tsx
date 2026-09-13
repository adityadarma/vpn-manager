import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertTriangle, ChevronLeft, Download, Key, Lock, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { api, API_URL } from '@/lib/api'
import { formatBrowserDateTime, type User } from '@vpn/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_layout/users/$userId/certificates')({ component: UserCertificatesPage })

function UserCertificatesPage() {
  const { userId } = Route.useParams()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [form, setForm] = useState({ nodeId: '', credentialName: '', passwordProtected: false, password: '', expirationDate: '' })

  const { data: user } = useQuery<User>({ queryKey: ['user', userId], queryFn: () => api.get(`/api/v1/users/${userId}`) })
  const { data: certificates = [] } = useQuery<any[]>({ queryKey: ['user-certificates', userId], queryFn: () => api.get(`/api/v1/users/${userId}/certificates`) })
  const { data: nodes = [] } = useQuery<any[]>({ queryKey: ['nodes'], queryFn: () => api.get('/api/v1/nodes') })
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['user-certificates', userId] }); setShowForm(false); setForm({ nodeId: '', credentialName: '', passwordProtected: false, password: '', expirationDate: '' }); toast.success('Certificate generated') },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: (certId: string) => api.post(`/api/v1/users/${userId}/certificates/${certId}/revoke`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['user-certificates', userId] }); setRevokingId(null); setReason(''); toast.success('Certificate revoked') },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = async (cert: any) => {
    try {
      setDownloadingId(cert.id)
      const response = await fetch(`${API_URL}/api/v1/users/${userId}/vpn?certId=${cert.id}`, { credentials: 'include' })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || 'Failed to generate config')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${user?.username || 'vpn'}-${cert.credential_name || 'credential'}.${cert.node_vpn_type === 'wireguard' ? 'conf' : 'ovpn'}`
      link.click()
      URL.revokeObjectURL(url)
      qc.invalidateQueries({ queryKey: ['user-certificates', userId] })
    } catch (e: any) { toast.error(e.message) } finally { setDownloadingId(null) }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Link to="/users" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="mr-1 h-4 w-4" />Users</Link>
        <h1 className="mt-2 text-2xl font-bold">Certificates{user ? ` for ${user.username}` : ''}</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage credentials and download client configurations.</p>
      </div>
      <Button onClick={() => setShowForm(true)} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" />Add Certificate</Button>
    </div>

    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {certificates.length === 0 ? <div className="py-16 text-center text-muted-foreground"><Key className="mx-auto mb-3 h-10 w-10 opacity-40" />No certificates for this user.</div> :
        <div className="divide-y divide-border">{certificates.map((cert: any) => <div key={cert.id} className="p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-semibold">{cert.credential_name || 'default'}</span>{cert.is_revoked && <span className="text-xs text-red-600">Revoked</span>}{cert.password_protected && <Lock className="h-3.5 w-3.5 text-blue-600" />}</div>
            <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-muted-foreground sm:grid-cols-4"><span>Node: {cert.node_hostname}</span><span>VPN IP: {cert.vpn_ip || '-'}</span><span>Last connect: {cert.last_vpn_connect ? formatBrowserDateTime(cert.last_vpn_connect) : 'Never'}</span><span>Downloads: {cert.download_count}</span></div>
          </div>
          <div className="flex gap-2">{!cert.is_revoked ? <><Button size="sm" onClick={() => download(cert)} disabled={downloadingId === cert.id}><Download className="mr-2 h-4 w-4" />{downloadingId === cert.id ? 'Downloading...' : 'Download'}</Button><Button size="sm" variant="outline" onClick={() => setRevokingId(cert.id)} className="text-red-600"><Trash2 className="mr-2 h-4 w-4" />Revoke</Button></> : <Button size="sm" variant="outline" onClick={() => { setForm({ ...form, nodeId: cert.node_id, credentialName: cert.credential_name || '' }); setShowForm(true) }}><RefreshCw className="mr-2 h-4 w-4" />Regenerate</Button>}</div>
        </div>)}</div>}
    </div>

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <form onSubmit={e => { e.preventDefault(); if (!form.nodeId || !form.credentialName.trim()) return toast.error('Node and credential name are required'); if (form.passwordProtected && !form.password) return toast.error('Password is required'); generate.mutate() }} className="my-6 w-full max-w-lg rounded-xl bg-card text-card-foreground shadow-xl">
        <div className="flex items-center justify-between border-b border-border/50 p-4">
          <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Key className="h-5 w-5 text-blue-600" />Generate Certificate</h2><p className="mt-0.5 text-sm text-muted-foreground">For user: <span className="font-medium text-foreground">{user?.username}</span></p></div>
          <button type="button" onClick={() => setShowForm(false)} className="rounded-md p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-4">
          <div><label className="mb-1.5 block text-sm font-medium">VPN Node <span className="text-red-500">*</span></label><select value={form.nodeId} onChange={e => setForm({ ...form, nodeId: e.target.value, passwordProtected: false, password: '' })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"><option value="">Select a node...</option>{nodes.filter(n => n.status === 'online').map(n => <option key={n.id} value={n.id}>{n.hostname} ({n.ip_address})</option>)}</select></div>
          <div><label className="mb-1.5 block text-sm font-medium">Credential / Device Name <span className="text-red-500">*</span></label><input value={form.credentialName} onChange={e => setForm({ ...form, credentialName: e.target.value })} placeholder="e.g. Laptop, iPhone, Work-PC" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" /><p className="mt-1 text-xs text-muted-foreground">Unique name for this device/credential on this node. Multiple certificates are allowed.</p></div>
          {selectedNode?.vpn_type !== 'wireguard' && <><div><div className="mb-1.5 flex items-center justify-between"><label className="block text-sm font-medium">Certificate Expiration Date</label>{form.expirationDate && <button type="button" onClick={() => setForm({ ...form, expirationDate: '' })} className="text-xs text-muted-foreground hover:text-foreground">Clear for unlimited</button>}</div><input type="date" value={form.expirationDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setForm({ ...form, expirationDate: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" /><p className="mt-1 text-xs text-muted-foreground">{form.expirationDate ? `Certificate expires at the end of ${form.expirationDate}.` : 'Leave empty for unlimited validity.'}</p></div>
          <div className="rounded-lg border border-border p-3"><label className="flex items-start gap-2.5 cursor-pointer"><input type="checkbox" checked={form.passwordProtected} onChange={e => setForm({ ...form, passwordProtected: e.target.checked, password: '' })} className="mt-0.5" /><span><span className="flex items-center gap-1.5 text-sm font-medium"><Lock className="h-4 w-4 text-muted-foreground" />Password-protect private key</span><span className="mt-0.5 block text-xs text-muted-foreground">User will need to enter a password when connecting to VPN.</span></span></label>{form.passwordProtected && <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Enter key password" className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm" />}</div>
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300">Multiple certificates can be created for the same user on one node using different credential names.</div></>}
          {selectedNode?.vpn_type === 'wireguard' && <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">WireGuard uses a static keypair and does not support certificate validity or key passphrases.</div>}
        </div>
        <div className="flex gap-3 border-t border-border/50 p-4"><Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button><Button size="sm" disabled={generate.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700">{generate.isPending ? 'Generating...' : 'Generate Certificate'}</Button></div>
      </form>
    </div>}
    {revokingId && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-xl bg-card shadow-xl p-5 space-y-4"><h2 className="font-semibold flex gap-2"><AlertTriangle className="h-5 w-5 text-red-600" />Revoke Certificate</h2><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for revocation" className="w-full rounded-lg border border-border p-3" /><div className="flex gap-3"><Button variant="outline" className="flex-1" onClick={() => setRevokingId(null)}>Cancel</Button><Button className="flex-1 bg-red-600 hover:bg-red-700" disabled={!reason.trim() || revoke.isPending} onClick={() => revoke.mutate(revokingId)}>Revoke</Button></div></div></div>}
  </div>
}
