import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Plus,
  Trash2,
  Users,
  Network,
  Pencil,
  Search,
  X,
  Layers,
  MoreHorizontal,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/_layout/groups/')({
  component: GroupsPage,
})

interface Group {
  id: string
  name: string
  description: string | null
  member_count: number
  network_count: number
  created_at: string
}

interface FormState {
  name: string
  description: string
}

// eslint-disable-next-line react-refresh/only-export-components
function GroupsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [showCreate, setShowCreate] = useState(false)
  const [editGroup, setEditGroup] = useState<Group | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', description: '' })
  const [search, setSearch] = useState('')
  const [memberFilter, setMemberFilter] = useState<'all' | 'with_members' | 'empty'>('all')
  const [networkFilter, setNetworkFilter] = useState<'all' | 'routed' | 'no_routes'>('all')

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/api/v1/groups'),
  })

  const createMutation = useMutation({
    mutationFn: (data: FormState) => api.post<Group>('/api/v1/groups', data),
    onSuccess: (newGroup) => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setShowCreate(false)
      setForm({ name: '', description: '' })
      toast.success('Group created successfully')
      if (newGroup?.id) {
        navigate({ to: '/groups/$groupId', params: { groupId: newGroup.id } })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormState }) =>
      api.patch<Group>(`/api/v1/groups/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setEditGroup(null)
      toast.success('Group updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/groups/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      toast.success('Group deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openEdit = (g: Group) => {
    setEditGroup(g)
    setForm({ name: g.name, description: g.description ?? '' })
  }

  const filteredGroups = groups.filter((g) => {
    const matchesSearch =
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      (g.description && g.description.toLowerCase().includes(search.toLowerCase()))

    const matchesMembers =
      memberFilter === 'all'
        ? true
        : memberFilter === 'with_members'
        ? g.member_count > 0
        : g.member_count === 0

    const matchesNetworks =
      networkFilter === 'all'
        ? true
        : networkFilter === 'routed'
        ? g.network_count > 0
        : g.network_count === 0

    return matchesSearch && matchesMembers && matchesNetworks
  })

  const hasFilters = Boolean(search || memberFilter !== 'all' || networkFilter !== 'all')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">VPN Groups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {groups.length} group{groups.length !== 1 ? 's' : ''} registered • Organize users and segment VPN network access
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="btn-create-group"
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
            onClick={() => {
              setShowCreate(true)
              setForm({ name: '', description: '' })
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add Group
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
            placeholder="Search groups..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Member filter pills */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMemberFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                memberFilter === 'all'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Groups
            </button>
            <button
              type="button"
              onClick={() => setMemberFilter('with_members')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                memberFilter === 'with_members'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              With Members
            </button>
            <button
              type="button"
              onClick={() => setMemberFilter('empty')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                memberFilter === 'empty'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              No Members
            </button>
          </div>

          {/* Network route filter pills */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setNetworkFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                networkFilter === 'all'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Networks
            </button>
            <button
              type="button"
              onClick={() => setNetworkFilter('routed')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                networkFilter === 'routed'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Routed
            </button>
            <button
              type="button"
              onClick={() => setNetworkFilter('no_routes')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                networkFilter === 'no_routes'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              No Routes
            </button>
          </div>
        </div>
      </div>

      {/* Main Groups Directory Table (Full Width) */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
        {/* Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent border-b border-border">
                <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[220px]">
                  Group Name
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[220px]">
                  Description
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36">
                  Members
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36">
                  Networks
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-24">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="text-center">
                      <Skeleton className="h-4 w-4 mx-auto rounded" />
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell className="text-center">
                      <Skeleton className="h-5 w-20 mx-auto rounded-md" />
                    </TableCell>
                    <TableCell className="text-center">
                      <Skeleton className="h-5 w-16 mx-auto rounded-md" />
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredGroups.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-16 text-center">
                    {hasFilters ? (
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                          <Search className="h-6 w-6 text-muted-foreground/70" />
                        </div>
                        <h3 className="font-semibold text-foreground text-base">No groups found</h3>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          No groups match your current search or filter criteria. Try resetting them.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4 text-xs"
                          onClick={() => {
                            setSearch('')
                            setMemberFilter('all')
                            setNetworkFilter('all')
                          }}
                        >
                          Clear all filters
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3 text-emerald-600 dark:text-emerald-400">
                          <Layers className="h-6 w-6" />
                        </div>
                        <h3 className="font-semibold text-foreground text-base">No groups yet</h3>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          Create your first group to start organizing VPN users and routing network access.
                        </p>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                filteredGroups.map((g, index) => {
                  return (
                    <TableRow
                      key={g.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* # Number */}
                      <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                        {index + 1}
                      </TableCell>

                      {/* Group Name */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                            <Layers className="h-4.5 w-4.5" />
                          </div>
                          <span className="font-semibold text-sm text-foreground truncate">
                            {g.name}
                          </span>
                        </div>
                      </TableCell>

                      {/* Description */}
                      <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">
                        {g.description ? (
                          g.description
                        ) : (
                          <span className="text-muted-foreground/50 italic text-xs">No description</span>
                        )}
                      </TableCell>

                      {/* Members Shortcut Badge */}
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => navigate({ to: '/groups/$groupId', params: { groupId: g.id } })}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-muted/60 hover:bg-muted hover:border-border text-foreground border border-border/80 transition-colors shadow-2xs group/btn cursor-pointer"
                          title="Manage group members"
                        >
                          <Users className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                          <span>{g.member_count}</span>
                          <span className="text-[10px] text-muted-foreground font-sans">members</span>
                        </button>
                      </TableCell>

                      {/* Networks Shortcut Badge */}
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => navigate({ to: '/groups/$groupId', params: { groupId: g.id } })}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-muted/60 hover:bg-muted hover:border-border text-foreground border border-border/80 transition-colors shadow-2xs group/btn cursor-pointer"
                          title="Manage group networks"
                        >
                          <Network className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                          <span>{g.network_count}</span>
                          <span className="text-[10px] text-muted-foreground font-sans">nets</span>
                        </button>
                      </TableCell>

                      {/* Actions Dropdown */}
                      <TableCell className="text-right pr-5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="ml-auto flex p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
                              aria-label={`Actions for ${g.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              onSelect={() => navigate({ to: '/groups/$groupId', params: { groupId: g.id } })}
                            >
                              <ExternalLink className="mr-2 h-4 w-4 text-muted-foreground" />
                              View & Manage Group
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openEdit(g)}>
                              <Pencil className="mr-2 h-4 w-4 text-muted-foreground" />
                              Edit Group
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={async () => {
                                const ok = await confirm({
                                  title: 'Delete group',
                                  description: `Delete group "${g.name}"?`,
                                  warning: 'This action cannot be undone.',
                                  confirmLabel: 'Delete Group',
                                })
                                if (ok) deleteMutation.mutate(g.id)
                              }}
                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            >
                              <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                              Delete Group
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
      </div>

      {/* Create Group Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}>
        <ModalHeader title="Add Group" onClose={() => setShowCreate(false)} />
        <ModalBody>
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              placeholder="e.g. IT Department, Developers, Sales"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-desc">Description</Label>
            <Textarea
              id="group-desc"
              placeholder="Optional description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Groups allow you to organize users and assign network CIDR access routes.
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button
            id="btn-create-group-submit"
            disabled={!form.name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate({ name: form.name, description: form.description })}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {createMutation.isPending ? 'Adding...' : 'Add Group'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Group Modal */}
      <Modal open={!!editGroup} onClose={() => setEditGroup(null)}>
        <ModalHeader title="Edit Group" onClose={() => setEditGroup(null)} />
        <ModalBody>
          <div className="space-y-1.5">
            <Label htmlFor="edit-group-name">Name</Label>
            <Input
              id="edit-group-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-group-desc">Description</Label>
            <Textarea
              id="edit-group-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Groups allow you to organize users and assign network CIDR access routes.
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setEditGroup(null)}>Cancel</Button>
          <Button
            id="btn-edit-group-submit"
            disabled={!form.name.trim() || updateMutation.isPending}
            onClick={() =>
              editGroup &&
              updateMutation.mutate({
                id: editGroup.id,
                data: { name: form.name, description: form.description },
              })
            }
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
