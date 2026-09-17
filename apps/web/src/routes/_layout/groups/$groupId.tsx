import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  ChevronLeft,
  Users,
  Network,
  Pencil,
  Trash2,
  Search,
  X,
  ShieldCheck,
  UserPlus,
  NetworkIcon,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/_layout/groups/$groupId')({
  component: GroupDetailPage,
})

interface Group {
  id: string
  name: string
  description: string | null
  member_count: number
  network_count: number
  created_at: string
}

interface GroupDetail extends Group {
  members: Array<{
    id: string
    name: string
    email: string | null
    role: string
    is_active: boolean
  }>
  networks: Array<{
    id: string
    name: string
    cidr: string
    description?: string | null
  }>
}

interface User {
  id: string
  name: string
  email: string | null
  role: string
  is_active: boolean
  vpn_group_id: string | null
  vpn_group_name: string | null
}

interface NetworkItem {
  id: string
  name: string
  cidr: string
  description: string | null
}

interface FormState {
  name: string
  description: string
}

// eslint-disable-next-line react-refresh/only-export-components
function GroupDetailPage() {
  const { groupId } = Route.useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const [activeTab, setActiveTab] = useState<string>('members')
  const [memberSearch, setMemberSearch] = useState('')
  const [networkSearch, setNetworkSearch] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showAddNetwork, setShowAddNetwork] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<Set<string>>(new Set())
  const [modalSearchQuery, setModalSearchQuery] = useState('')
  const [editForm, setEditForm] = useState<FormState>({ name: '', description: '' })

  const { data: groupDetail, isLoading } = useQuery<GroupDetail>({
    queryKey: ['groups', groupId],
    queryFn: () => api.get(`/api/v1/groups/${groupId}`),
  })

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users'),
  })

  const { data: allNetworks = [] } = useQuery<NetworkItem[]>({
    queryKey: ['networks'],
    queryFn: () => api.get('/api/v1/networks'),
  })

  const updateMutation = useMutation({
    mutationFn: (data: FormState) => api.patch<Group>(`/api/v1/groups/${groupId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      setShowEdit(false)
      toast.success('Group updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/groups/${groupId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      toast.success('Group deleted')
      navigate({ to: '/groups' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addMemberMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      await Promise.all(userIds.map((id) => api.post(`/api/v1/groups/${groupId}/members`, { user_id: id })))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      setShowAddMember(false)
      setSelectedUserIds(new Set())
      setModalSearchQuery('')
      toast.success('Members assigned to group successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/v1/groups/${groupId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      toast.success('Member removed from group')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addNetworkMutation = useMutation({
    mutationFn: async (networkIds: string[]) => {
      await Promise.all(networkIds.map((id) => api.post(`/api/v1/groups/${groupId}/networks`, { network_id: id })))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      setShowAddNetwork(false)
      setSelectedNetworkIds(new Set())
      setModalSearchQuery('')
      toast.success('Networks assigned to group successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeNetworkMutation = useMutation({
    mutationFn: (networkId: string) => api.delete(`/api/v1/groups/${groupId}/networks/${networkId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      toast.success('Network removed from group')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openEditModal = () => {
    if (groupDetail) {
      setEditForm({
        name: groupDetail.name,
        description: groupDetail.description ?? '',
      })
      setShowEdit(true)
    }
  }

  // Filter available users for adding (not already in this group)
  const availableUsers = allUsers.filter(
    (u) =>
      !groupDetail?.members.some((m) => m.id === u.id) &&
      (u.name.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
        (u.email && u.email.toLowerCase().includes(modalSearchQuery.toLowerCase())))
  )

  const usersBeingMoved = allUsers.filter(
    (u) => selectedUserIds.has(u.id) && u.vpn_group_id && u.vpn_group_id !== groupId
  )

  // Filter available networks for assigning (not already in this group)
  const availableNetworks = allNetworks.filter(
    (n) =>
      !groupDetail?.networks.some((net) => net.id === n.id) &&
      (n.name.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
        n.cidr.toLowerCase().includes(modalSearchQuery.toLowerCase()))
  )

  const toggleUserId = (id: string) => {
    const next = new Set(selectedUserIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedUserIds(next)
  }

  const toggleNetworkId = (id: string) => {
    const next = new Set(selectedNetworkIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedNetworkIds(next)
  }

  // Filter group members for display
  const filteredMembers = (groupDetail?.members ?? []).filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      (m.email && m.email.toLowerCase().includes(memberSearch.toLowerCase()))
  )

  // Filter group networks for display
  const filteredNetworks = (groupDetail?.networks ?? []).filter(
    (n) =>
      n.name.toLowerCase().includes(networkSearch.toLowerCase()) ||
      n.cidr.toLowerCase().includes(networkSearch.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Link
            to="/groups"
            className="inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Back to Groups
          </Link>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {isLoading ? (
                <Skeleton className="h-8 w-48" />
              ) : (
                groupDetail?.name ?? 'Group Details'
              )}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {groupDetail?.description || (
              <span className="italic text-muted-foreground/60">No description provided</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={openEditModal}
            disabled={isLoading || !groupDetail}
            className="shadow-xs"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            Edit Group
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!groupDetail) return
              const ok = await confirm({
                title: 'Delete group',
                description: `Are you sure you want to delete group "${groupDetail.name}"?`,
                warning: 'This action cannot be undone.',
                confirmLabel: 'Delete Group',
              })
              if (ok) deleteMutation.mutate()
            }}
            disabled={isLoading || !groupDetail || deleteMutation.isPending}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30 shadow-xs"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete Group
          </Button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-xs flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Members</p>
            <p className="text-xl font-bold text-foreground mt-0.5">
              {isLoading ? <Skeleton className="h-6 w-10" /> : groupDetail?.members.length ?? 0}
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <Network className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assigned Networks</p>
            <p className="text-xl font-bold text-foreground mt-0.5">
              {isLoading ? <Skeleton className="h-6 w-10" /> : groupDetail?.networks.length ?? 0}
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Members</p>
            <p className="text-xl font-bold text-foreground mt-0.5">
              {isLoading ? (
                <Skeleton className="h-6 w-10" />
              ) : (
                groupDetail?.members.filter((m) => m.is_active).length ?? 0
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Navigation for Members & Networks */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/60 p-1 border border-border/60">
          <TabsTrigger value="members" className="gap-2 text-xs sm:text-sm">
            <Users className="h-4 w-4" />
            Members ({groupDetail?.members.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="networks" className="gap-2 text-xs sm:text-sm">
            <Network className="h-4 w-4" />
            Network Routes ({groupDetail?.networks.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: MEMBERS */}
        <TabsContent value="members" className="space-y-4 outline-none">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            {/* Card Header & Toolbar */}
            <div className="p-4 sm:px-5 sm:py-4 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card">
              <div>
                <h2 className="font-semibold text-foreground text-base">Group Members</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Users configured in this group receiving its network routing access
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    placeholder="Search member name, email, IP..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    className="pl-9 pr-8 h-9 text-sm bg-background"
                  />
                  {memberSearch && (
                    <button
                      type="button"
                      onClick={() => setMemberSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowAddMember(true)
                    setSelectedUserIds(new Set())
                    setModalSearchQuery('')
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs shrink-0"
                >
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  Add Member
                </Button>
              </div>
            </div>

            {/* Members Table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent border-b border-border">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                      Member
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Role
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/60">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell className="text-center">
                          <Skeleton className="h-4 w-4 mx-auto rounded" />
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-28" />
                              <Skeleton className="h-3 w-36" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-16 rounded-full" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-16 rounded-full" />
                        </TableCell>
                        <TableCell className="text-right pr-5">
                          <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredMembers.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="py-12 text-center">
                        {memberSearch ? (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                              <Search className="h-5 w-5 text-muted-foreground/70" />
                            </div>
                            <p className="font-semibold text-sm text-foreground">No matching members found</p>
                            <p className="text-xs text-muted-foreground mt-1 mb-4">
                              No members match &quot;{memberSearch}&quot;.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMemberSearch('')}
                              className="h-8 text-xs"
                            >
                              Clear Search
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3 text-emerald-600 dark:text-emerald-400">
                              <Users className="h-6 w-6" />
                            </div>
                            <p className="font-semibold text-sm text-foreground">No members in this group</p>
                            <p className="text-xs text-muted-foreground mt-1 mb-4">
                              Add users to this group to grant them configured VPN access and network routes.
                            </p>
                            <Button
                              size="sm"
                              onClick={() => {
                                setShowAddMember(true)
                                setSelectedUserIds(new Set())
                                setModalSearchQuery('')
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                            >
                              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                              Add First Member
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMembers.map((m, index) => {
                      return (
                        <TableRow key={m.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                            {index + 1}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                                {m.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{m.email || 'No email'}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 ${
                                m.role === 'admin'
                                    ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20'
                                    : 'bg-muted text-muted-foreground border-border'
                              }`}
                            >
                              {m.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
                                m.is_active
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                                  : 'bg-muted text-muted-foreground border-border'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  m.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50'
                                }`}
                              />
                              {m.is_active ? 'Active' : 'Disabled'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right pr-5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-2.5 text-xs"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: 'Remove member',
                                  description: `Remove "${m.name}" from group "${groupDetail?.name}"?`,
                                  confirmLabel: 'Remove',
                                })
                                if (ok) removeMemberMutation.mutate(m.id)
                              }}
                              disabled={removeMemberMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: NETWORKS */}
        <TabsContent value="networks" className="space-y-4 outline-none">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            {/* Card Header & Toolbar */}
            <div className="p-4 sm:px-5 sm:py-4 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card">
              <div>
                <h2 className="font-semibold text-foreground text-base">Assigned Network Routes</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Network routes and IP CIDR ranges accessible by users in this group
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    placeholder="Search network name or CIDR..."
                    value={networkSearch}
                    onChange={(e) => setNetworkSearch(e.target.value)}
                    className="pl-9 pr-8 h-9 text-sm bg-background"
                  />
                  {networkSearch && (
                    <button
                      type="button"
                      onClick={() => setNetworkSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowAddNetwork(true)
                    setSelectedNetworkIds(new Set())
                    setModalSearchQuery('')
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs shrink-0"
                >
                  <NetworkIcon className="mr-1.5 h-4 w-4" />
                  Assign Network
                </Button>
              </div>
            </div>

            {/* Networks Table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent border-b border-border">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                      Network Name
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                      CIDR Notation
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Description
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/60">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell className="text-center">
                          <Skeleton className="h-4 w-4 mx-auto rounded" />
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                            <Skeleton className="h-4 w-32" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24 rounded-md" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-40" />
                        </TableCell>
                        <TableCell className="text-right pr-5">
                          <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredNetworks.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="py-12 text-center">
                        {networkSearch ? (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                              <Search className="h-5 w-5 text-muted-foreground/70" />
                            </div>
                            <p className="font-semibold text-sm text-foreground">No matching networks found</p>
                            <p className="text-xs text-muted-foreground mt-1 mb-4">
                              No networks match &quot;{networkSearch}&quot;.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setNetworkSearch('')}
                              className="h-8 text-xs"
                            >
                              Clear Search
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-3 text-blue-600 dark:text-blue-400">
                              <Network className="h-6 w-6" />
                            </div>
                            <p className="font-semibold text-sm text-foreground">No networks assigned yet</p>
                            <p className="text-xs text-muted-foreground mt-1 mb-4">
                              Assign network routes to this group to allow its members to access internal networks.
                            </p>
                            <Button
                              size="sm"
                              onClick={() => {
                                setShowAddNetwork(true)
                                setSelectedNetworkIds(new Set())
                                setModalSearchQuery('')
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                            >
                              <NetworkIcon className="mr-1.5 h-3.5 w-3.5" />
                              Assign First Network
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredNetworks.map((n, index) => {
                      return (
                        <TableRow key={n.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                            {index + 1}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                <NetworkIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <span className="font-medium text-sm text-foreground">{n.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded-md border border-border text-foreground">
                              {n.cidr}
                            </code>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">
                            {n.description || <span className="text-muted-foreground/50 italic text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right pr-5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-2.5 text-xs"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: 'Remove network',
                                  description: `Remove network "${n.name}" (${n.cidr}) from group?`,
                                  confirmLabel: 'Remove',
                                })
                                if (ok) removeNetworkMutation.mutate(n.id)
                              }}
                              disabled={removeNetworkMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* MODAL 1: Add Member (Multi-Select) */}
      <Modal
        open={showAddMember}
        onClose={() => {
          setShowAddMember(false)
          setSelectedUserIds(new Set())
        }}
        className="max-w-[450px]"
      >
        <ModalHeader
          title={`Add Members to ${groupDetail?.name ?? 'Group'}`}
          onClose={() => {
            setShowAddMember(false)
            setSelectedUserIds(new Set())
          }}
        />
        <ModalBody>
          {usersBeingMoved.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <span className="text-xs">
                <strong>{usersBeingMoved.map((u) => u.name).join(', ')}</strong> will be moved from their current group and reassigned.
              </span>
            </div>
          )}
          <div className="space-y-3">
            <Input
              placeholder="Search by name or email..."
              value={modalSearchQuery}
              onChange={(e) => setModalSearchQuery(e.target.value)}
              autoFocus
            />
            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {availableUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground border rounded-lg border-dashed">
                  No users found to add.
                </div>
              ) : (
                availableUsers.map((u) => (
                  <div
                    key={u.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer select-none transition-colors hover:bg-muted/50 ${
                      selectedUserIds.has(u.id)
                        ? 'border-emerald-600 bg-emerald-500/5 ring-1 ring-emerald-500/20'
                        : 'border-border'
                    }`}
                    onClick={() => toggleUserId(u.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.has(u.id)}
                      onChange={() => {}}
                      className="rounded border-input text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0 cursor-pointer"
                    />
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                      {u.vpn_group_name && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 truncate">
                          Currently in: {u.vpn_group_name}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase font-semibold text-muted-foreground">
                      {u.role}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="sm:justify-between">
          <div className="text-xs text-muted-foreground hidden sm:block">
            {selectedUserIds.size} user(s) selected
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddMember(false)
                setSelectedUserIds(new Set())
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={selectedUserIds.size === 0 || addMemberMutation.isPending}
              onClick={() => addMemberMutation.mutate(Array.from(selectedUserIds))}
              className={selectedUserIds.size > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
            >
              {addMemberMutation.isPending ? 'Adding...' : `Add ${selectedUserIds.size || ''} Member(s)`}
            </Button>
          </div>
        </ModalFooter>
      </Modal>

      {/* MODAL 2: Assign Network (Multi-Select) */}
      <Modal
        open={showAddNetwork}
        onClose={() => {
          setShowAddNetwork(false)
          setSelectedNetworkIds(new Set())
        }}
        className="max-w-[450px]"
      >
        <ModalHeader
          title={`Assign Networks to ${groupDetail?.name ?? 'Group'}`}
          onClose={() => {
            setShowAddNetwork(false)
            setSelectedNetworkIds(new Set())
          }}
        />
        <ModalBody>
          <div className="space-y-3">
            <Input
              placeholder="Search network name or CIDR..."
              value={modalSearchQuery}
              onChange={(e) => setModalSearchQuery(e.target.value)}
              autoFocus
            />
            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {availableNetworks.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground border rounded-lg border-dashed">
                  No networks found to assign.
                </div>
              ) : (
                availableNetworks.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer select-none transition-colors hover:bg-muted/50 ${
                      selectedNetworkIds.has(n.id)
                        ? 'border-emerald-600 bg-emerald-500/5 ring-1 ring-emerald-500/20'
                        : 'border-border'
                    }`}
                    onClick={() => toggleNetworkId(n.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedNetworkIds.has(n.id)}
                      onChange={() => {}}
                      className="rounded border-input text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0 cursor-pointer"
                    />
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <NetworkIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{n.name}</p>
                      <p className="text-xs font-mono text-muted-foreground truncate">{n.cidr}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="sm:justify-between">
          <div className="text-xs text-muted-foreground hidden sm:block">
            {selectedNetworkIds.size} network(s) selected
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddNetwork(false)
                setSelectedNetworkIds(new Set())
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={selectedNetworkIds.size === 0 || addNetworkMutation.isPending}
              onClick={() => addNetworkMutation.mutate(Array.from(selectedNetworkIds))}
              className={selectedNetworkIds.size > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
            >
              {addNetworkMutation.isPending ? 'Assigning...' : `Assign ${selectedNetworkIds.size || ''} Network(s)`}
            </Button>
          </div>
        </ModalFooter>
      </Modal>

      {/* MODAL 3: Edit Group */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)}>
        <ModalHeader title="Edit Group" onClose={() => setShowEdit(false)} />
        <ModalBody>
          <div className="space-y-1.5">
            <Label htmlFor="detail-group-name">Name</Label>
            <Input
              id="detail-group-name"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="detail-group-desc">Description</Label>
            <Textarea
              id="detail-group-desc"
              rows={3}
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Groups allow you to organize users and assign network CIDR access routes.
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
          <Button
            disabled={!editForm.name.trim() || updateMutation.isPending}
            onClick={() => updateMutation.mutate({ name: editForm.name, description: editForm.description })}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
