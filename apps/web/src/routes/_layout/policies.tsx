import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  Shield,
  X,
  Search,
  Users,
  UsersRound,
  Server,
  CheckCircle2,
  Ban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal'
import { useConfirm } from '@/components/ui/confirm-dialog'

export const Route = createFileRoute('/_layout/policies')({
  component: PoliciesPage,
})

interface Policy {
  id: string
  userId: string | null
  groupId: string | null
  node_id: string | null
  name?: string
  group_name?: string
  node_name?: string
  target_network: string
  target_port: string | null
  protocol: 'tcp' | 'udp' | 'icmp' | 'all'
  action: 'allow' | 'deny'
  priority: number
  description: string | null
}

interface CreatePolicyForm {
  targetType: 'user' | 'group' | 'global'
  userId: string
  groupId: string
  nodeId: string
  targetNetwork: string
  protocol: 'tcp' | 'udp' | 'icmp' | 'all'
  targetPort: string
  action: 'allow' | 'deny'
  priority: string
  description: string
}

interface PolicyTableProps {
  policies: Policy[]
  type: 'user' | 'group' | 'global'
  isLoading: boolean
  hasFilters: boolean
  onClearFilters: () => void
  onDelete: (policy: Policy) => void
  onAddPolicy: (type: 'user' | 'group' | 'global') => void
}

// eslint-disable-next-line react-refresh/only-export-components
function PolicyTable({
  policies: policyList,
  type,
  isLoading,
  hasFilters,
  onClearFilters,
  onDelete,
  onAddPolicy,
}: PolicyTableProps) {
  const targetLabel = type === 'global' ? 'Target' : type === 'user' ? 'User' : 'Group'

  return (
    <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                #
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                {targetLabel}
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Routing Node
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Target Network
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Port / Proto
              </TableHead>
              <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Action
              </TableHead>
              <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Priority
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                Description
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-24">
                Action
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
                    <Skeleton className="h-5 w-24 rounded-md" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-28 rounded-md" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-md" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Skeleton className="h-5 w-16 mx-auto rounded-full" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Skeleton className="h-5 w-8 mx-auto rounded" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-36" />
                  </TableCell>
                  <TableCell className="text-right pr-5">
                    <Skeleton className="h-7 w-16 rounded-md ml-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : policyList.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9} className="py-16 text-center">
                  {hasFilters ? (
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <Search className="h-6 w-6 text-muted-foreground/70" />
                      </div>
                      <h3 className="font-semibold text-foreground text-base">No policies found</h3>
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        No {type} policies match your current search or filter criteria. Try clearing filters.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 text-xs cursor-pointer"
                        onClick={onClearFilters}
                      >
                        Clear all filters
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                        <Shield className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <h3 className="font-semibold text-foreground text-base">No {type} policies</h3>
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        {type === 'group'
                          ? 'No group network policies configured yet. Create a policy to restrict or permit access for groups.'
                          : type === 'user'
                          ? 'No per-user network policies configured yet. Create a policy to restrict or permit access for specific users.'
                          : 'No global network policies configured yet. Global rules apply to all connected VPN clients.'}
                      </p>
                      <Button
                        size="sm"
                        className="mt-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                        onClick={() => onAddPolicy(type)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Add {type === 'group' ? 'Group' : type === 'user' ? 'User' : 'Global'} Policy
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              policyList.map((p, index) => (
                <TableRow key={p.id} className="hover:bg-muted/40 transition-colors">
                  {/* # Row Number */}
                  <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                    {index + 1}
                  </TableCell>

                  {/* Target Column with Icon Box */}
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      {type === 'group' ? (
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <UsersRound className="size-4" />
                        </div>
                      ) : type === 'user' ? (
                        <div className="w-9 h-9 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <Users className="size-4" />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <Shield className="size-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-foreground truncate">
                          {type === 'global'
                            ? 'All Clients (Global)'
                            : type === 'user'
                            ? p.name ?? p.userId ?? 'Unknown User'
                            : p.group_name ?? p.groupId ?? 'Unknown Group'}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  {/* Routing Node */}
                  <TableCell className="text-xs whitespace-nowrap">
                    {p.node_name ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20">
                        <Server className="size-3" />
                        {p.node_name}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs text-muted-foreground bg-muted/60 border border-border/70">
                        All Nodes (Global)
                      </span>
                    )}
                  </TableCell>

                  {/* Target Network */}
                  <TableCell>
                    <code className="px-2 py-0.5 rounded-md font-mono text-xs font-medium bg-muted/60 text-foreground border border-border/70 whitespace-nowrap">
                      {p.target_network}
                    </code>
                  </TableCell>

                  {/* Port / Protocol */}
                  <TableCell className="whitespace-nowrap">
                    <div className="inline-flex items-center gap-1 font-mono text-xs">
                      <span className="uppercase bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border/60 font-medium">
                        {p.protocol}
                      </span>
                      {p.target_port ? (
                        <span className="text-foreground font-semibold">:{p.target_port}</span>
                      ) : (
                        <span className="text-muted-foreground/60">:all</span>
                      )}
                    </div>
                  </TableCell>

                  {/* Action Badge */}
                  <TableCell className="text-center whitespace-nowrap">
                    {p.action === 'allow' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="size-3" />
                        allow
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20">
                        <Ban className="size-3" />
                        deny
                      </span>
                    )}
                  </TableCell>

                  {/* Priority */}
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded text-xs font-mono text-muted-foreground bg-muted/40 border border-border/60">
                      {p.priority}
                    </span>
                  </TableCell>

                  {/* Description */}
                  <TableCell>
                    <span
                      className="text-xs text-muted-foreground truncate block max-w-[200px]"
                      title={p.description || undefined}
                    >
                      {p.description || '—'}
                    </span>
                  </TableCell>

                  {/* Action: Delete */}
                  <TableCell className="text-right pr-5 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2.5 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-500/10 cursor-pointer ml-auto"
                      onClick={() => onDelete(p)}
                    >
                      <Trash2 className="mr-1.5 size-3.5" />
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function PoliciesPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [showForm, setShowForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<'all' | 'allow' | 'deny'>('all')
  const [nodeFilter, setNodeFilter] = useState<'all' | 'global' | 'specific'>('all')
  const [activeTab, setActiveTab] = useState<'group' | 'user' | 'global'>('group')

  const [form, setForm] = useState<CreatePolicyForm>({
    targetType: 'group',
    userId: '',
    groupId: '',
    nodeId: '',
    targetNetwork: '',
    protocol: 'all',
    targetPort: '',
    action: 'allow',
    priority: '100',
    description: '',
  })

  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ['policies'],
    queryFn: () => api.get('/api/v1/policies'),
  })

  const { data: users = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users'),
  })

  const { data: groups = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/api/v1/groups'),
  })

  const { data: nodes = [] } = useQuery<{ id: string; hostname: string }[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/api/v1/policies', {
        userId: form.targetType === 'user' ? form.userId : undefined,
        groupId: form.targetType === 'group' ? form.groupId : undefined,
        nodeId: form.nodeId || undefined,
        targetNetwork: form.targetNetwork,
        protocol: form.protocol,
        targetPort: form.targetPort || undefined,
        action: form.action,
        priority: parseInt(form.priority, 10) || 100,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      setShowForm(false)
      setForm({
        targetType: 'group',
        userId: '',
        groupId: '',
        nodeId: '',
        targetNetwork: '',
        protocol: 'all',
        targetPort: '',
        action: 'allow',
        priority: '100',
        description: '',
      })
      toast.success('Policy created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/policies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      toast.success('Policy deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDeletePolicy = async (p: Policy) => {
    const targetDesc = p.group_name || p.name || (p.groupId ? 'Group' : p.userId ? 'User' : 'Global')
    const ok = await confirm({
      title: 'Delete network policy',
      description: `Delete network policy for "${targetDesc}" (${p.target_network})?`,
      confirmLabel: 'Delete Policy',
    })
    if (ok) deleteMutation.mutate(p.id)
  }

  // Segment policies by target type
  const userPolicies = useMemo(() => policies.filter((p) => p.userId), [policies])
  const groupPolicies = useMemo(() => policies.filter((p) => p.groupId), [policies])
  const globalPolicies = useMemo(() => policies.filter((p) => !p.userId && !p.groupId), [policies])

  // Filter helper
  const filterList = useCallback(
    (list: Policy[]) => {
      return list.filter((p) => {
        // Action filter
        if (actionFilter !== 'all' && p.action !== actionFilter) return false

        // Node filter
        if (nodeFilter === 'global' && p.node_id) return false
        if (nodeFilter === 'specific' && !p.node_id) return false

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          const matchName = (p.name || '').toLowerCase().includes(q)
          const matchGroup = (p.group_name || '').toLowerCase().includes(q)
          const matchNode = (p.node_name || '').toLowerCase().includes(q)
          const matchNet = (p.target_network || '').toLowerCase().includes(q)
          const matchPort = (p.target_port || '').toLowerCase().includes(q)
          const matchDesc = (p.description || '').toLowerCase().includes(q)
          const matchProto = (p.protocol || '').toLowerCase().includes(q)
          if (!matchName && !matchGroup && !matchNode && !matchNet && !matchPort && !matchDesc && !matchProto) {
            return false
          }
        }
        return true
      })
    },
    [actionFilter, nodeFilter, searchQuery]
  )

  const filteredGroupPolicies = useMemo(() => filterList(groupPolicies), [groupPolicies, filterList])
  const filteredUserPolicies = useMemo(() => filterList(userPolicies), [userPolicies, filterList])
  const filteredGlobalPolicies = useMemo(() => filterList(globalPolicies), [globalPolicies, filterList])

  const hasFilters = searchQuery.trim() !== '' || actionFilter !== 'all' || nodeFilter !== 'all'

  const clearAllFilters = () => {
    setSearchQuery('')
    setActionFilter('all')
    setNodeFilter('all')
  }

  const openAddPolicy = (type: 'user' | 'group' | 'global') => {
    setForm((prev) => ({
      ...prev,
      targetType: type,
      userId: '',
      groupId: '',
    }))
    setShowForm(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Network Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {policies.length} rule{policies.length !== 1 ? 's' : ''} defined • Control VPN traffic access by target network, port, and protocol
          </p>
        </div>
        <Button
          id="btn-add-policy"
          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer self-start sm:self-auto"
          onClick={() => openAddPolicy(activeTab)}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add Policy
        </Button>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as 'group' | 'user' | 'global')}
        className="space-y-4"
      >
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="group" className="gap-2 cursor-pointer">
              <UsersRound className="h-4 w-4" />
              Group Policies ({groupPolicies.length})
            </TabsTrigger>
            <TabsTrigger value="user" className="gap-2 cursor-pointer">
              <Users className="h-4 w-4" />
              User Policies ({userPolicies.length})
            </TabsTrigger>
            <TabsTrigger value="global" className="gap-2 cursor-pointer">
              <Shield className="h-4 w-4" />
              Global Policies ({globalPolicies.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Toolbar: Search and Filter Pills (Matching Users and Groups) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
            <Input
              type="text"
              placeholder="Search policies by user, group, network, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-9 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Action filter pills */}
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActionFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  actionFilter === 'all'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Actions
              </button>
              <button
                type="button"
                onClick={() => setActionFilter('allow')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  actionFilter === 'allow'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => setActionFilter('deny')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  actionFilter === 'deny'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Deny
              </button>
            </div>

            {/* Node filter pills */}
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setNodeFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  nodeFilter === 'all'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Nodes
              </button>
              <button
                type="button"
                onClick={() => setNodeFilter('global')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  nodeFilter === 'global'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setNodeFilter('specific')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  nodeFilter === 'specific'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Specific Nodes
              </button>
            </div>
          </div>
        </div>

        {/* Tab 1: Group Policies */}
        <TabsContent value="group" className="space-y-4">
          <PolicyTable
            policies={filteredGroupPolicies}
            type="group"
            isLoading={isLoading}
            hasFilters={hasFilters}
            onClearFilters={clearAllFilters}
            onDelete={handleDeletePolicy}
            onAddPolicy={openAddPolicy}
          />
        </TabsContent>

        {/* Tab 2: User Policies */}
        <TabsContent value="user" className="space-y-4">
          <PolicyTable
            policies={filteredUserPolicies}
            type="user"
            isLoading={isLoading}
            hasFilters={hasFilters}
            onClearFilters={clearAllFilters}
            onDelete={handleDeletePolicy}
            onAddPolicy={openAddPolicy}
          />
        </TabsContent>

        {/* Tab 3: Global Policies */}
        <TabsContent value="global" className="space-y-4">
          <PolicyTable
            policies={filteredGlobalPolicies}
            type="global"
            isLoading={isLoading}
            hasFilters={hasFilters}
            onClearFilters={clearAllFilters}
            onDelete={handleDeletePolicy}
            onAddPolicy={openAddPolicy}
          />
        </TabsContent>
      </Tabs>

      {/* Add Policy Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} className="max-w-lg">
        <ModalHeader title="Add Network Policy" onClose={() => setShowForm(false)} />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          <ModalBody className="space-y-4">
            <div>
              <Label className="block text-sm font-medium mb-1.5">Target Node</Label>
              <select
                value={form.nodeId}
                onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
                className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Global (All Nodes)</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.hostname}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Bind this policy to a specific node. Keep "Global" to apply evenly across all nodes.
              </p>
            </div>

            <div>
              <Label className="block text-sm font-medium mb-1.5">
                Target Type <span className="text-red-500">*</span>
              </Label>
              <select
                value={form.targetType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    targetType: e.target.value as 'user' | 'group' | 'global',
                    userId: '',
                    groupId: '',
                  })
                }
                className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="group">Group</option>
                <option value="user">User</option>
                <option value="global">Global (All Clients)</option>
              </select>
            </div>

            {form.targetType === 'user' && (
              <div>
                <Label className="block text-sm font-medium mb-1.5">
                  User <span className="text-red-500">*</span>
                </Label>
                <select
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                  required
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">Select user...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.targetType === 'group' && (
              <div>
                <Label className="block text-sm font-medium mb-1.5">
                  Group <span className="text-red-500">*</span>
                </Label>
                <select
                  value={form.groupId}
                  onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                  required
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">Select group...</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-1 sm:col-span-2">
                <Label className="block text-sm font-medium mb-1.5">
                  Target Network IP / CIDR <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  value={form.targetNetwork}
                  onChange={(e) => setForm({ ...form, targetNetwork: e.target.value })}
                  placeholder="e.g. 172.31.6.140/32 or 10.0.0.0/24"
                  required
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Specify full CIDR block (e.g. /24 or /32 for a single IP).
                </p>
              </div>

              <div>
                <Label className="block text-sm font-medium mb-1.5">Protocol</Label>
                <select
                  value={form.protocol}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      protocol: e.target.value as 'tcp' | 'udp' | 'icmp' | 'all',
                    })
                  }
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="all">Any Protocol</option>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP (Ping)</option>
                </select>
              </div>

              <div>
                <Label className="block text-sm font-medium mb-1.5">Target Port</Label>
                <Input
                  type="text"
                  value={form.targetPort}
                  onChange={(e) => setForm({ ...form, targetPort: e.target.value })}
                  placeholder="e.g. 5432, 80:443"
                  disabled={form.protocol === 'all' || form.protocol === 'icmp'}
                  className={`text-sm ${
                    form.protocol === 'all' || form.protocol === 'icmp'
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Leave empty for all ports</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium mb-1.5">Action</Label>
                <select
                  value={form.action}
                  onChange={(e) =>
                    setForm({ ...form, action: e.target.value as 'allow' | 'deny' })
                  }
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                </select>
              </div>

              <div>
                <Label className="block text-sm font-medium mb-1.5">Priority</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  placeholder="100"
                  min="1"
                  max="1000"
                  className="text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <Label className="block text-sm font-medium mb-1.5">Description</Label>
              <Input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
                className="text-sm"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForm(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !form.targetNetwork.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Policy'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  )
}
