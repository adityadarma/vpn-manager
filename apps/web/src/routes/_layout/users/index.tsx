import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useRealtimeConnected } from '@/components/realtime-provider'
import {
  Trash2,
  Shield,
  Search,
  X,
  Plus,
  Key,
  AlertTriangle,
  Edit,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Users,
  CircleOff,
  CircleCheck,
  Clock,
} from 'lucide-react'
import { formatBrowserDateTime, type User } from '@vpn/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

export const Route = createFileRoute('/_layout/users/')({
  component: UsersPage,
})

interface UserWithMeta extends User {
  current_groups?: string | null
  clientCert?: boolean
}

interface ExpiringCert {
  cert_id: string
  user_id: string
  name: string
  email: string | null
  node_id: string
  node_hostname: string
  expires_at: string
  password_protected: boolean
}

interface CreateUserPayload {
  name: string
  email: string
  password: string
  role: 'admin' | 'user'
}

interface EditUserPayload {
  name?: string
  email?: string
  password?: string
  role?: 'admin' | 'user'
  isActive?: boolean
}

// eslint-disable-next-line react-refresh/only-export-components
function UsersPage() {
  const qc = useQueryClient()
  const realtimeConnected = useRealtimeConnected()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<User | null>(null)
  const [form, setForm] = useState<CreateUserPayload>({
    name: '',
    email: '',
    password: '',
    role: 'user',
  })
  const [editForm, setEditForm] = useState<EditUserPayload>({
    name: '',
    email: '',
    password: '',
    role: 'user',
    isActive: true,
  })

  // Filter & Search states
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')
  const [page, setPage] = useState(1)
  const pageSize = 10

  const {
    data: usersData,
    isLoading,
    isPlaceholderData,
  } = useQuery<{
    users: UserWithMeta[]
    pagination: { page: number; pages: number; total: number }
  }>({
    queryKey: ['users', page, search],
    queryFn: () =>
      api.get(`/api/v1/users?page=${page}&limit=${pageSize}&search=${encodeURIComponent(search)}`),
    placeholderData: keepPreviousData,
  })
  const users = usersData?.users ?? []
  const pagination = usersData?.pagination

  const { data: expiringCerts = [] } = useQuery<ExpiringCert[]>({
    queryKey: ['expiring-certs'],
    queryFn: () => api.get('/api/v1/users/expiring-certs?days=30'),
    refetchInterval: realtimeConnected ? false : 60_000,
  })

  const [now] = useState(() => Date.now())
  const getDaysUntilExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return null
    const remainingMs = new Date(expiresAt).getTime() - now
    return remainingMs > 0 ? Math.ceil(remainingMs / (1000 * 60 * 60 * 24)) : 0
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateUserPayload) =>
      api.post<User>('/api/v1/users', {
        ...data,
        email: data.email || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ name: '', email: '', password: '', role: 'user' })
      toast.success('User created successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditUserPayload }) => {
      const payload: Record<string, unknown> = {}
      if (data.name !== undefined) payload.name = data.name
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
      setEditForm({ name: '', email: '', password: '', role: 'user', isActive: true })
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

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/api/v1/users/${id}`, { isActive }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(`User ${variables.isActive ? 'enabled' : 'disabled'}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleOpenCertListModal = (user: User) => {
    navigate({ to: '/users/$userId/certificates', params: { userId: user.id } })
  }

  const handleOpenEditModal = (user: User) => {
    setSelectedUserForEdit(user)
    setEditForm({
      name: user.name,
      email: user.email || '',
      password: '',
      role: user.role,
      isActive: user.is_active,
    })
    setShowEditForm(true)
  }

  // Client-side quick filtering by role & status for loaded page
  const filtered = users.filter((user) => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && !user.is_active) return false
      if (statusFilter === 'disabled' && user.is_active) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      {/* Expiring Certificates Warning */}
      {expiringCerts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 transition-colors">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                Certificate Expiration Warning
              </h3>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                {expiringCerts.length} certificate{expiringCerts.length !== 1 ? 's' : ''} expiring
                within 30 days:
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {expiringCerts.slice(0, 5).map((cert) => {
                  const daysLeft = getDaysUntilExpiry(cert.expires_at)
                  return (
                    <button
                      key={cert.cert_id}
                      type="button"
                      onClick={() =>
                        navigate({
                          to: '/users/$userId/certificates',
                          params: { userId: cert.user_id },
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-card hover:bg-muted text-foreground border border-amber-500/30 rounded-md text-xs transition-colors shadow-xs group"
                    >
                      <Key className="h-3 w-3 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform" />
                      <span className="font-medium truncate max-w-[140px]">{cert.name}</span>
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ({daysLeft}d left)
                      </span>
                    </button>
                  )
                })}
                {expiringCerts.length > 5 && (
                  <span className="text-xs text-amber-700 dark:text-amber-300 self-center px-1">
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">VPN Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pagination?.total ?? 0} user{(pagination?.total ?? 0) !== 1 ? 's' : ''} registered •
            Manage access credentials and user permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="btn-add-user"
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
            onClick={() => setShowForm(true)}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Toolbar: Search and Filter Pills */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
          <Input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setPage(1)
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Role filter pills */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setRoleFilter('all')
                setPage(1)
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                roleFilter === 'all'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Roles
            </button>
            <button
              type="button"
              onClick={() => {
                setRoleFilter('user')
                setPage(1)
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                roleFilter === 'user'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Staff
            </button>
            <button
              type="button"
              onClick={() => {
                setRoleFilter('admin')
                setPage(1)
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                roleFilter === 'admin'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Admin
            </button>
          </div>

          {/* Status filter pills */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all')
                setPage(1)
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === 'all'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Status
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('active')
                setPage(1)
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === 'active'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('disabled')
                setPage(1)
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === 'disabled'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Disabled
            </button>
          </div>
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
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[220px]">
                  User
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Role
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Web Portal Activity
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              className={`divide-y divide-border/60 transition-opacity duration-150 ${isPlaceholderData ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {isLoading && !usersData ? (
                /* Skeleton shimmer rows */
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="text-center">
                      <Skeleton className="h-4 w-4 mx-auto" />
                    </TableCell>
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-3 w-40" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                /* Empty state */
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-16 text-center">
                    {search || roleFilter !== 'all' || statusFilter !== 'all' ? (
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                          <Search className="h-6 w-6 text-muted-foreground/70" />
                        </div>
                        <h3 className="font-semibold text-foreground text-base">No users match</h3>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          No users found with the current filter and search criteria.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4 text-xs"
                          onClick={() => {
                            setSearch('')
                            setRoleFilter('all')
                            setStatusFilter('all')
                            setPage(1)
                          }}
                        >
                          Clear all filters
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                          <Users className="h-6 w-6 text-muted-foreground/70" />
                        </div>
                        <h3 className="font-semibold text-foreground text-base">No users yet</h3>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          Get started by creating your first VPN user to assign network
                          certificates.
                        </p>
                        <Button
                          size="sm"
                          className="mt-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                          onClick={() => setShowForm(true)}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add User
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                /* Data rows */
                filtered.map((user, index) => {
                  const rowNumber = (page - 1) * pageSize + index + 1
                  const hasCerts = Boolean(user.clientCert)
                  return (
                    <TableRow key={user.id} className="hover:bg-muted/40 transition-colors group">
                      {/* # Number */}
                      <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                        {rowNumber}
                      </TableCell>

                      {/* User Info */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          {/* Polished Initials Avatar */}
                          <div className="relative shrink-0">
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-xs transition-transform group-hover:scale-105 ${
                                user.role === 'admin'
                                  ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20'
                                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20'
                              }`}
                            >
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-card ${
                                user.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/50'
                              }`}
                              title={user.is_active ? 'Active user' : 'Disabled user'}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-foreground text-sm truncate">
                                {user.name}
                              </span>
                              {hasCerts && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenCertListModal(user)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/20 transition-colors cursor-pointer"
                                  title="View user certificates"
                                >
                                  <Key className="h-2.5 w-2.5" />
                                  Cert
                                </button>
                              )}
                              {user.current_groups && (
                                <span
                                  className="text-[10px] text-muted-foreground truncate max-w-[120px]"
                                  title={`Groups: ${user.current_groups}`}
                                >
                                  ({user.current_groups})
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {user.email || 'No email registered'}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Role */}
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                            user.role === 'admin'
                              ? 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                              : 'border-border bg-secondary text-secondary-foreground'
                          }`}
                        >
                          {user.role === 'admin' ? (
                            <Shield className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                          ) : (
                            <Users className="h-3 w-3 text-muted-foreground" />
                          )}
                          {user.role === 'admin' ? 'Admin' : 'Staff'}
                        </span>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            user.is_active
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              user.is_active ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                          {user.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </TableCell>

                      {/* Web Portal Activity */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {user.role === 'user' ? (
                          <span
                            className="text-muted-foreground/60 italic"
                            title="Staff accounts connect directly via VPN tunnel without web dashboard access"
                          >
                            — (VPN only)
                          </span>
                        ) : user.last_login ? (
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                            <span>{formatBrowserDateTime(user.last_login)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">Never logged in</span>
                        )}
                      </TableCell>

                      {/* Actions Dropdown */}
                      <TableCell className="text-right pr-5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="ml-auto flex p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-muted rounded-md transition-colors"
                              aria-label={`Actions for ${user.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => handleOpenEditModal(user)}>
                              <Edit className="mr-2 h-4 w-4 text-muted-foreground" />
                              Edit user
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleOpenCertListModal(user)}>
                              <Key className="mr-2 h-4 w-4 text-muted-foreground" />
                              Manage certificates
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                toggleActiveMutation.mutate({
                                  id: user.id,
                                  isActive: !user.is_active,
                                })
                              }
                              disabled={toggleActiveMutation.isPending}
                              className={
                                user.is_active
                                  ? 'text-amber-600 dark:text-amber-400 focus:text-amber-600'
                                  : 'text-emerald-600 dark:text-emerald-400 focus:text-emerald-600'
                              }
                            >
                              {user.is_active ? (
                                <CircleOff className="mr-2 h-4 w-4" />
                              ) : (
                                <CircleCheck className="mr-2 h-4 w-4" />
                              )}
                              {user.is_active ? 'Disable user' : 'Enable user'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                if (
                                  confirm(
                                    `Are you sure you want to delete user "${user.name}"? This action cannot be undone.`,
                                  )
                                ) {
                                  deleteMutation.mutate(user.id)
                                }
                              }}
                              className="text-red-600 dark:text-red-400 focus:text-red-600"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete user
                            </DropdownMenuItem>
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

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-3.5 border-t border-border bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Showing{' '}
              <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-medium text-foreground">
                {Math.min(page * pageSize, pagination.total)}
              </span>{' '}
              of <span className="font-medium text-foreground">{pagination.total}</span> users
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setPage((c) => Math.max(1, c - 1))}
                disabled={isPlaceholderData || page === 1}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Previous
              </Button>
              <span className="text-xs px-2 text-muted-foreground">
                {page} / {pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setPage((c) => c + 1)}
                disabled={isPlaceholderData || page >= pagination.pages}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md border border-border">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="font-semibold text-foreground">Add VPN User</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Create a new user account</p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createMutation.mutate(form)
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-background text-foreground"
                >
                  <option value="user">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="John Doe"
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-background text-foreground"
                />
              </div>
              {form.role === 'admin' && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="john@example.com"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-background text-foreground"
                  />
                </div>
              )}
              {form.role === 'admin' && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Password {form.role === 'admin' && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Min. 8 characters"
                    required={form.role === 'admin'}
                    minLength={8}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-background text-foreground"
                  />
                </div>
              )}
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
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
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
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md border border-border">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <Edit className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  Edit User
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Update user information</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowEditForm(false)
                  setSelectedUserForEdit(null)
                  setEditForm({ name: '', email: '', password: '', role: 'user', isActive: true })
                }}
                className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                updateMutation.mutate({
                  id: selectedUserForEdit.id,
                  data: editForm,
                })
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm({ ...editForm, role: e.target.value as 'admin' | 'user' })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-background text-foreground"
                >
                  <option value="user">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Name</label>
                <input
                  type="text"
                  value={editForm.name ?? selectedUserForEdit.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-background text-foreground"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Existing certificate identifiers remain unchanged.
                </p>
              </div>
              {editForm.role === 'admin' && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Email</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    placeholder="john@example.com"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-background text-foreground"
                  />
                </div>
              )}
              {editForm.role === 'admin' && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={editForm.password}
                    onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    placeholder="Leave blank to keep current password"
                    minLength={8}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-background text-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Min. 8 characters. Leave blank to retain current password.
                  </p>
                </div>
              )}
              <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border border-border">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  className="rounded border-border text-violet-600 focus:ring-violet-500 h-4 w-4"
                />
                <label
                  htmlFor="isActive"
                  className="text-xs font-medium text-foreground cursor-pointer"
                >
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
                    setEditForm({
                      name: '',
                      email: '',
                      password: '',
                      role: 'user',
                      isActive: true,
                    })
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white shadow-xs"
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
