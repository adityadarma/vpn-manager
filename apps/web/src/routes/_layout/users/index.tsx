import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/users/')({
  component: UsersPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, API_URL } from '@/lib/api'
import { Trash2, Shield, Search, X, Plus, Key, AlertTriangle, Edit, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { formatBrowserDateTime, type User } from '@vpn/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

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
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<User | null>(null)
  const [form, setForm] = useState<CreateUserPayload>({ username: '', email: '', password: '', role: 'user' })
  const [editForm, setEditForm] = useState<EditUserPayload>({ email: '', password: '', role: 'user', isActive: true })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())

  const { data: usersData, isLoading } = useQuery<{ users: User[]; pagination: { page: number; pages: number; total: number } }>({
    queryKey: ['users', page, search],
    queryFn: () => api.get(`/api/v1/users?page=${page}&limit=${pageSize}&search=${encodeURIComponent(search)}`),
  })
  const users = usersData?.users ?? []
  const pagination = usersData?.pagination

  const { data: nodes = [] } = useQuery<any[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  const { data: expiringCerts = [] } = useQuery<any[]>({
    queryKey: ['expiring-certs'],
    queryFn: () => api.get('/api/v1/users/expiring-certs?days=30'),
    refetchInterval: 60000, // Refresh every minute
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
    const remainingMs = new Date(expiresAt).getTime() - Date.now()
    return remainingMs > 0 ? Math.ceil(remainingMs / (1000 * 60 * 60 * 24)) : 0
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

  const handleOpenCertListModal = (user: User) => {
    navigate({ to: '/users/$userId/certificates', params: { userId: user.id } })
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

  const filtered = users

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VPN Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pagination?.total ?? 0} user{(pagination?.total ?? 0) !== 1 ? 's' : ''} registered
            {selectedUsers.size > 0 && ` • ${selectedUsers.size} selected`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          onChange={e => { setSearch(e.target.value); setPage(1); setSelectedUsers(new Set()) }}
          className="w-full max-w-sm pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-card text-card-foreground"
        />
      </div>

      {/* Table */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
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
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Active (Web)</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={6} className="py-12 text-center text-muted-foreground/70">Loading users...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-muted-foreground/70">No users found.</td></tr>
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
                  {user.role === 'user' ? '-' : (user.last_login ? formatBrowserDateTime(user.last_login) : 'Never')}
                </td>
                <td className="px-5 py-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="ml-auto flex p-2 text-muted-foreground/70 hover:text-foreground hover:bg-muted rounded-lg transition-colors" aria-label={`Actions for ${user.username}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => handleOpenEditModal(user)}><Edit className="mr-2 h-4 w-4" />Edit user</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleOpenCertListModal(user)}><Key className="mr-2 h-4 w-4" />Certificates</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => { if (confirm('Delete user?')) deleteMutation.mutate(user.id) }} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Delete user</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {pagination && pagination.pages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-t border-border/60">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.pages} • {pagination.total} users
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setPage(current => Math.max(1, current - 1)); setSelectedUsers(new Set()) }} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setPage(current => current + 1); setSelectedUsers(new Set()) }} disabled={page >= pagination.pages}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
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

    </div>
  )
}
