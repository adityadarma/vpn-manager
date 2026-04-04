import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/users')({
  component: UsersPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, API_URL } from '@/lib/api'
import { Trash2, Download, Shield, Search, X, Plus, Key, Lock, AlertTriangle, RefreshCw, Edit } from 'lucide-react'
import type { User } from '@vpn/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface CreateUserPayload {
  username: string
  email: string
  password: string
  role: 'admin' | 'user'
}

interface EditUserPayload {
  email?: string
  password?: string
  role?: 'admin' | 'user'
  isActive?: boolean
}

function UsersPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showCertModal, setShowCertModal] = useState(false)
  const [showCertListModal, setShowCertListModal] = useState(false)
  const [selectedUserForCert, setSelectedUserForCert] = useState<User | null>(null)
  const [selectedUserForCertList, setSelectedUserForCertList] = useState<User | null>(null)
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<User | null>(null)
  const [certForm, setCertForm] = useState({ nodeId: '', passwordProtected: false, password: '', validDays: 0 })
  const [form, setForm] = useState<CreateUserPayload>({ username: '', email: '', password: '', role: 'user' })
  const [editForm, setEditForm] = useState<EditUserPayload>({ email: '', password: '', role: 'user', isActive: true })
  const [search, setSearch] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [revokeReason, setRevokeReason] = useState('')
  const [revokingCertId, setRevokingCertId] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users'),
  })

  const { data: nodes = [] } = useQuery<any[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  const { data: expiringCerts = [] } = useQuery<any[]>({
    queryKey: ['expiring-certs'],
    queryFn: () => api.get('/api/v1/users/expiring-certs?days=30'),
    refetchInterval: 60000, // Refresh every minute
  })

  const { data: userCertificates = [], refetch: refetchCertificates } = useQuery<any[]>({
    queryKey: ['user-certificates', selectedUserForCertList?.id],
    queryFn: () => api.get(`/api/v1/users/${selectedUserForCertList?.id}/certificates`),
    enabled: !!selectedUserForCertList,
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateUserPayload) => api.post<User>('/api/v1/users', {
      ...data,
      email: data.email || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ username: '', email: '', password: '', role: 'user' })
      toast.success('User created successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditUserPayload }) => {
      const payload: any = {}
      if (data.email !== undefined) payload.email = data.email || undefined
      if (data.password) payload.password = data.password
      if (data.role !== undefined) payload.role = data.role
      if (data.isActive !== undefined) payload.isActive = data.isActive
      return api.patch<User>(`/api/v1/users/${id}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowEditForm(false)
      setSelectedUserForEdit(null)
      setEditForm({ email: '', password: '', role: 'user', isActive: true })
      toast.success('User updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => api.delete(`/api/v1/users/${id}`)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setSelectedUsers(new Set())
      toast.success('Users deleted successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkToggleActiveMutation = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      await Promise.all(ids.map(id => api.patch(`/api/v1/users/${id}`, { isActive })))
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setSelectedUsers(new Set())
      toast.success(`Users ${variables.isActive ? 'enabled' : 'disabled'} successfully`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const generateCertMutation = useMutation({
    mutationFn: ({ userId, nodeId, password, passwordProtected, validDays }: { userId: string; nodeId: string; password?: string; passwordProtected: boolean; validDays: number | null }) =>
      api.post(`/api/v1/users/${userId}/generate-cert`, { nodeId, password, passwordProtected, validDays: validDays === 0 ? null : validDays }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['expiring-certs'] })
      setShowCertModal(false)
      setSelectedUserForCert(null)
      setCertForm({ nodeId: '', passwordProtected: false, password: '', validDays: 0 })
      toast.success('Certificate generated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkGenerateCertMutation = useMutation({
    mutationFn: ({ userIds, nodeId, password, passwordProtected, validDays }: { userIds: string[]; nodeId: string; password?: string; passwordProtected: boolean; validDays: number | null }) =>
      api.post('/api/v1/users/bulk-generate-cert', { userIds, nodeId, password, passwordProtected, validDays: validDays === 0 ? null : validDays }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['expiring-certs'] })
      setSelectedUsers(new Set())
      toast.success(data.message)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleAutoRenewMutation = useMutation({
    mutationFn: ({ userId, autoRenew }: { userId: string; autoRenew: boolean }) =>
      api.patch(`/api/v1/users/${userId}`, { certAutoRenew: autoRenew }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Auto-renewal setting updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revokeCertMutation = useMutation({
    mutationFn: ({ userId, certId, reason }: { userId: string; certId: string; reason: string }) =>
      api.post(`/api/v1/users/${userId}/certificates/${certId}/revoke`, { reason }),
    onSuccess: () => {
      refetchCertificates()
      setRevokingCertId(null)
      setRevokeReason('')
      toast.success('Certificate revoked successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleOpenCertModal = (user: User) => {
    setSelectedUserForCert(user)
    setShowCertModal(true)
    // Auto-select first online node if available
    const onlineNode = nodes.find((n: any) => n.status === 'online')
    if (onlineNode) {
      setCertForm(prev => ({ ...prev, nodeId: onlineNode.id }))
    }
  }

  const handleBulkGenerateCert = () => {
    if (selectedUsers.size === 0) {
      toast.error('No users selected')
      return
    }

    const onlineNode = nodes.find((n: any) => n.status === 'online')
    if (!onlineNode) {
      toast.error('No online nodes available')
      return
    }

    if (confirm(`Generate certificates for ${selectedUsers.size} user(s)?`)) {
      bulkGenerateCertMutation.mutate({
        userIds: Array.from(selectedUsers),
        nodeId: onlineNode.id,
        passwordProtected: false,
        validDays: 0
      })
    }
  }

  const getDaysUntilExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return null
    const days = Math.floor((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return days
  }

  const toggleUser = (userId: string) => {
    const newSelected = new Set(selectedUsers)
    if (newSelected.has(userId)) {
      newSelected.delete(userId)
    } else {
      newSelected.add(userId)
    }
    setSelectedUsers(newSelected)
  }

  const toggleAll = () => {
    if (selectedUsers.size === filtered.length) {
      setSelectedUsers(new Set())
    } else {
      setSelectedUsers(new Set(filtered.map(u => u.id)))
    }
  }

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedUsers.size} user(s)?`)) {
      bulkDeleteMutation.mutate(Array.from(selectedUsers))
    }
  }

  const [isDownloading, setIsDownloading] = useState<string | null>(null)

  const handleDownloadConfig = async (user: User, certId?: string) => {
    try {
      setIsDownloading(certId || user.id)
      const url = certId
        ? `${API_URL}/api/v1/users/${user.id}/vpn?certId=${certId}`
        : `${API_URL}/api/v1/users/${user.id}/vpn`

      const res = await fetch(url, {
        credentials: 'include',
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => null)
        throw new Error(errorData?.message || errorData?.error || 'Failed to generate config')
      }

      // Attempt to get filename from Content-Disposition header
      let filename = `${user.username}.ovpn`
      const disposition = res.headers.get('Content-Disposition')
      if (disposition && disposition.includes('filename=')) {
        const matches = /filename="([^"]+)"/.exec(disposition)
        if (matches?.[1]) filename = matches[1]
      }

      const blob = await res.blob()
      const url2 = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url2
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url2)
      a.remove()

      toast.success('Configuration downloaded successfully')

      // Refresh certificates list if modal is open
      if (showCertListModal) {
        refetchCertificates()
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setIsDownloading(null)
    }
  }

  const handleOpenCertListModal = (user: User) => {
    setSelectedUserForCertList(user)
    setShowCertListModal(true)
  }

  const handleOpenEditModal = (user: User) => {
    setSelectedUserForEdit(user)
    setEditForm({
      email: user.email || '',
      password: '',
      role: user.role,
      isActive: user.is_active
    })
    setShowEditForm(true)
  }

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Expiring Certificates Warning */}
      {expiringCerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900">Certificate Expiration Warning</h3>
              <p className="text-sm text-amber-700 mt-1">
                {expiringCerts.length} user{expiringCerts.length !== 1 ? 's have' : ' has'} certificate{expiringCerts.length !== 1 ? 's' : ''} expiring within 30 days:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {expiringCerts.slice(0, 5).map((cert: any) => (
                  <span key={cert.id} className="inline-flex items-center gap-1 px-2 py-1 bg-card text-card-foreground border border-amber-200 rounded text-xs text-amber-800">
                    {cert.username}
                    <span className="text-amber-600">
                      ({getDaysUntilExpiry(cert.expires_at)} days)
                    </span>
                  </span>
                ))}
                {expiringCerts.length > 5 && (
                  <span className="text-xs text-amber-700 px-2 py-1">
                    +{expiringCerts.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VPN Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {users.length} user{users.length !== 1 ? 's' : ''} registered
            {selectedUsers.size > 0 && ` • ${selectedUsers.size} selected`}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedUsers.size > 0 && (
            <>
              <Button
                variant="outline"
                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                onClick={handleBulkGenerateCert}
                disabled={bulkGenerateCertMutation.isPending || nodes.filter((n: any) => n.status === 'online').length === 0}
              >
                <Key className="mr-2 h-4 w-4" />
                Generate Certs ({selectedUsers.size})
              </Button>
              <Button
                variant="outline"
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                onClick={() => bulkToggleActiveMutation.mutate({ ids: Array.from(selectedUsers), isActive: true })}
                disabled={bulkToggleActiveMutation.isPending}
              >
                Enable ({selectedUsers.size})
              </Button>
              <Button
                variant="outline"
                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                onClick={() => bulkToggleActiveMutation.mutate({ ids: Array.from(selectedUsers), isActive: false })}
                disabled={bulkToggleActiveMutation.isPending}
              >
                Disable ({selectedUsers.size})
              </Button>
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleBulkDelete}
                disabled={bulkDeleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete ({selectedUsers.size})
              </Button>
            </>
          )}
          <Button
            id="btn-add-user"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setShowForm(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-card text-card-foreground"
        />
      </div>

      {/* Table */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-5 py-3 w-12">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedUsers.size === filtered.length}
                  onChange={toggleAll}
                  className="rounded border-input text-emerald-600 focus:ring-emerald-500"
                />
              </th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Login (Web)</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Connect (VPN)</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={7} className="py-12 text-center text-muted-foreground/70">Loading users...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-muted-foreground/70">No users found.</td></tr>
            ) : filtered.map((user) => (
              <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                <td className="px-5 py-4">
                  <input
                    type="checkbox"
                    checked={selectedUsers.has(user.id)}
                    onChange={() => toggleUser(user.id)}
                    className="rounded border-input text-emerald-600 focus:ring-emerald-500"
                  />
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-xs">
                      {user.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{user.username}</p>
                        {(user as any).clientCert && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700" title="Has certificate">
                            <Key className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/70">{user.email ?? 'No email'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${user.role === 'admin'
                    ? 'bg-violet-50 text-violet-700'
                    : 'bg-muted text-muted-foreground'
                    }`}>
                    {user.role === 'admin' && <Shield className="h-3 w-3" />}
                    {user.role}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    {user.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-5 py-4 text-muted-foreground" >
                  {user.role === 'user' ? '-' : (user.last_login ? (() => {
                    const d = new Date(user.last_login);
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                  })() : 'Never')}
                </td>
                <td className="px-5 py-4 text-muted-foreground" >
                  {user.last_vpn_connect ? (() => {
                    const d = new Date(user.last_vpn_connect);
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                  })() : 'Never'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleOpenEditModal(user)}
                      className="p-2 text-muted-foreground/70 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                      title="Edit user"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleOpenCertModal(user)}
                      className="p-2 text-muted-foreground/70 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Generate certificate"
                    >
                      <Key className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleOpenCertListModal(user)}
                      className="p-2 text-muted-foreground/70 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      title="View certificates"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete user?')) deleteMutation.mutate(user.id) }}
                      className="p-2 text-muted-foreground/70 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="font-semibold text-foreground">Add VPN User</h2>
                <p className="text-sm text-muted-foreground/70 mt-0.5">Create a new user account</p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form) }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-card text-card-foreground"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Username <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="johndoe"
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="john@example.com"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Password {form.role === 'admin' && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={form.role === 'admin' ? "Min. 8 characters" : "Optional for standard VPN users"}
                  required={form.role === 'admin'}
                  minLength={8}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 shadow-sm"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create User'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditForm && selectedUserForEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <Edit className="h-5 w-5 text-violet-600" />
                  Edit User
                </h2>
                <p className="text-sm text-muted-foreground/70 mt-0.5">Update user information</p>
              </div>
              <button
                onClick={() => {
                  setShowEditForm(false)
                  setSelectedUserForEdit(null)
                  setEditForm({ email: '', password: '', role: 'user', isActive: true })
                }}
                className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                updateMutation.mutate({
                  id: selectedUserForEdit.id,
                  data: editForm
                })
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as 'admin' | 'user' })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-card text-card-foreground"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  value={selectedUserForEdit.username}
                  disabled
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted/50 text-muted-foreground cursor-not-allowed"
                  title="Username cannot be changed after creation"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Username cannot be changed (used as certificate CN)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="john@example.com"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  New Password
                </label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Leave blank to keep current password"
                  minLength={8}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Min. 8 characters. Leave blank to keep current password.
                </p>
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  className="rounded border-input text-violet-600 focus:ring-violet-500"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-foreground cursor-pointer">
                  Account is active
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowEditForm(false)
                    setSelectedUserForEdit(null)
                    setEditForm({ email: '', password: '', role: 'user', isActive: true })
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex-1 shadow-sm"
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update User'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate Certificate Modal */}
      {showCertModal && selectedUserForCert && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <Key className="h-5 w-5 text-blue-600" />
                  Generate Certificate
                </h2>
                <p className="text-sm text-muted-foreground/70 mt-0.5">
                  For user: <span className="font-medium text-muted-foreground">{selectedUserForCert.username}</span>
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCertModal(false)
                  setSelectedUserForCert(null)
                  setCertForm({ nodeId: '', passwordProtected: false, password: '', validDays: 0 })
                }}
                className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!certForm.nodeId) {
                  toast.error('Please select a node')
                  return
                }
                if (certForm.passwordProtected && !certForm.password) {
                  toast.error('Please enter a password')
                  return
                }
                generateCertMutation.mutate({
                  userId: selectedUserForCert.id,
                  nodeId: certForm.nodeId,
                  password: certForm.passwordProtected ? certForm.password : undefined,
                  passwordProtected: certForm.passwordProtected,
                  validDays: certForm.validDays
                })
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  VPN Node <span className="text-red-500">*</span>
                </label>
                <select
                  value={certForm.nodeId}
                  onChange={(e) => setCertForm({ ...certForm, nodeId: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card text-card-foreground"
                >
                  <option value="">Select a node...</option>
                  {nodes.filter((n: any) => n.status === 'online').map((node: any) => (
                    <option key={node.id} value={node.id}>
                      {node.hostname} ({node.ip_address})
                    </option>
                  ))}
                </select>
                {nodes.filter((n: any) => n.status === 'online').length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">⚠️ No online nodes available</p>
                )}
              </div>

              {(() => {
                const selectedNode = nodes?.find((n: any) => n.id === certForm.nodeId)

                if (selectedNode?.vpn_type === 'wireguard') {
                  return (
                    <div className="bg-muted/50 border border-border rounded-lg p-4">
                      <div className="flex gap-2 items-start text-sm">
                        <Lock className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="font-medium text-foreground">Static Keypair (WireGuard)</p>
                          <p className="text-muted-foreground mt-0.5">WireGuard uses static asymmetric keys that do not have native X.509 expiration dates or passphrase combinations.</p>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Certificate Validity Period
                    </label>
                    <select
                      value={certForm.validDays}
                      onChange={(e) => setCertForm({ ...certForm, validDays: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card text-card-foreground"
                    >
                      <option value="0">Unlimited (No expiration)</option>
                      <option value="1">1 Day</option>
                      <option value="7">1 Week (7 days)</option>
                      <option value="14">2 Weeks (14 days)</option>
                      <option value="30">1 Month (30 days)</option>
                      <option value="90">3 Months (90 days)</option>
                      <option value="180">6 Months (180 days)</option>
                      <option value="365">1 Year (365 days)</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {certForm.validDays === 0 ? 'Certificate will never expire' : 'Shorter validity = better security if compromised'}
                    </p>
                  </div>
                )
              })()}

              {/* OpenVPN Specific Settings */}
              {(() => {
                const selectedNode = nodes?.find((n: any) => n.id === certForm.nodeId)
                if (selectedNode?.vpn_type === 'wireguard') return null

                return (
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="passwordProtected"
                        checked={certForm.passwordProtected}
                        onChange={(e) => setCertForm({ ...certForm, passwordProtected: e.target.checked, password: '' })}
                        className="mt-1 rounded border-input text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <label htmlFor="passwordProtected" className="block text-sm font-medium text-foreground cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Lock className="h-4 w-4 text-muted-foreground/70" />
                            Password-protect private key
                          </div>
                        </label>
                        <p className="text-xs text-muted-foreground mt-1">
                          User will need to enter password when connecting to VPN
                        </p>
                      </div>
                    </div>

                    {certForm.passwordProtected && (
                      <div className="pl-7">
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                          Key Password <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="password"
                          value={certForm.password}
                          onChange={(e) => setCertForm({ ...certForm, password: e.target.value })}
                          placeholder="Enter password for private key"
                          required={certForm.passwordProtected}
                          minLength={8}
                          className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card text-card-foreground"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Min. 8 characters. User must remember this password.
                        </p>
                      </div>
                    )}
                  </div>
                )
              })()}

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                <p className="text-xs text-blue-800">
                  <strong>Note:</strong> This will generate a new client certificate and private key.
                  Any existing certificate for this user will be revoked.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowCertModal(false)
                    setSelectedUserForCert(null)
                    setCertForm({ nodeId: '', passwordProtected: false, password: '', validDays: 0 })
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={generateCertMutation.isPending || nodes.filter((n: any) => n.status === 'online').length === 0}
                  className="flex-1 shadow-sm"
                >
                  {generateCertMutation.isPending ? 'Generating...' : 'Generate Certificate'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Certificate List Modal */}
      {showCertListModal && selectedUserForCertList && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <Key className="h-5 w-5 text-emerald-600" />
                  Certificates for {selectedUserForCertList.username}
                </h2>
                <p className="text-sm text-muted-foreground/70 mt-0.5">
                  Manage certificates across all nodes
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCertListModal(false)
                  setSelectedUserForCertList(null)
                }}
                className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {userCertificates.length === 0 ? (
                <div className="text-center py-12">
                  <Key className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No certificates found</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Generate a certificate for this user on a node
                  </p>
                  <Button
                    onClick={() => {
                      setShowCertListModal(false)
                      handleOpenCertModal(selectedUserForCertList)
                    }}
                    className="mt-4 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Generate Certificate
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {userCertificates.map((cert: any) => (
                    <div
                      key={cert.id}
                      className={`relative border rounded-xl p-5 overflow-hidden transition-all duration-200 hover:shadow-md ${!!cert.is_revoked
                        ? 'border-red-500/20 bg-red-500/5'
                        : cert.node_status === 'online'
                          ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                          : 'border-border/60 bg-muted/20'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-6">
                        <div className="flex-1 min-w-0">
                          {/* Header section with badges */}
                          <div className="flex flex-wrap items-center gap-3 mb-4">
                            <h3 className="text-lg font-bold text-foreground">
                              {cert.node_hostname}
                            </h3>

                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${cert.node_status === 'online'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : 'bg-muted text-muted-foreground border border-border'
                                }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${cert.node_status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                                {cert.node_status}
                              </span>

                              {!!cert.is_revoked && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                  <X className="h-3 w-3" />
                                  Revoked
                                </span>
                              )}

                              {!!cert.password_protected && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20" title="Password protected">
                                  <Lock className="h-3 w-3" />
                                  Protected
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Data Grid */}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-0.5">IP Address</span>
                              <span className="font-mono text-foreground">{cert.node_ip || 'N/A'}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-0.5">Downloads</span>
                              <span className="text-foreground font-medium">{cert.download_count} times</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-0.5">Generated</span>
                              <span className="text-foreground">
                                {cert.generated_at ? new Date(cert.generated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-0.5">Expires</span>
                              {cert.expires_at ? (
                                <span className="text-foreground">
                                  {new Date(cert.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                  {(() => {
                                    const days = Math.floor((new Date(cert.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                                    if (days < 0) return <span className="text-red-500 ml-1.5 font-medium">(Expired)</span>
                                    if (days < 30) return <span className="text-amber-500 ml-1.5 font-medium">({days} days left)</span>
                                    return null
                                  })()}
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Never</span>
                              )}
                            </div>
                          </div>

                          {!!cert.is_revoked && cert.revoke_reason && (
                            <div className="mt-4 flex items-start gap-2 text-sm text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                              <div className="font-semibold shrink-0 uppercase tracking-wider text-xs mt-0.5">Reason:</div>
                              <div>{cert.revoke_reason}</div>
                            </div>
                          )}
                        </div>

                        {/* Actions Sidebar */}
                        <div className="flex flex-col gap-2 shrink-0 border-l border-border/50 pl-6 my-2">
                          {!cert.is_revoked ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleDownloadConfig(selectedUserForCertList, cert.id)}
                                disabled={isDownloading === cert.id}
                                className="w-32 justify-start shadow-sm"
                              >
                                <Download className={`mr-2 h-4 w-4 ${isDownloading === cert.id ? 'animate-bounce' : ''}`} />
                                Download
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRevokingCertId(cert.id)}
                                className="w-32 justify-start border-red-500/30 hover:bg-red-500/10 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:border-red-500/50"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Revoke
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                setShowCertListModal(false)
                                handleOpenCertModal(selectedUserForCertList)
                                setCertForm(prev => ({ ...prev, nodeId: cert.node_id }))
                              }}
                              className="w-32 justify-start shadow-sm"
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Regenerate
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border/50 p-5 bg-muted/50">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {userCertificates.filter((c: any) => !c.is_revoked).length} active certificate(s)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCertListModal(false)
                      setSelectedUserForCertList(null)
                    }}
                  >
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      setShowCertListModal(false)
                      handleOpenCertModal(selectedUserForCertList)
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Generate New
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Certificate Confirmation Modal */}
      {revokingCertId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b border-border/50">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Revoke Certificate
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                This action cannot be undone. The user will not be able to connect with this certificate.
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Reason for revocation <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g., Security breach, Lost device, User terminated..."
                  required
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRevokingCertId(null)
                    setRevokeReason('')
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!revokeReason.trim()) {
                      toast.error('Please provide a reason for revocation')
                      return
                    }
                    if (selectedUserForCertList) {
                      revokeCertMutation.mutate({
                        userId: selectedUserForCertList.id,
                        certId: revokingCertId,
                        reason: revokeReason
                      })
                    }
                  }}
                  disabled={revokeCertMutation.isPending}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {revokeCertMutation.isPending ? 'Revoking...' : 'Revoke Certificate'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
