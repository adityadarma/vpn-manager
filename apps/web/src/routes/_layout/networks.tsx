import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Plus,
  Trash2,
  Pencil,
  Globe,
  Users,
  Server,
  Check,
  Layers,
  Search,
  X,
  MoreHorizontal,
  Eye,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export const Route = createFileRoute('/_layout/networks')({
  component: NetworksPage,
})

interface Network {
  id: string
  name: string
  cidr: string
  description: string | null
  group_count: number
  node_count: number
  node_ids: string[]
  created_at: string
}

interface NetworkDetail extends Network {
  groups: Array<{ id: string; name: string; description: string | null }>
  nodes: Array<{ id: string; hostname: string; ip_address: string; status: string }>
}

interface VpnNode {
  id: string
  hostname: string
  ip_address: string
  status: string
  vpn_network?: string
  vpn_netmask?: string
}

interface Group {
  id: string
  name: string
  vpn_subnet?: string | null
}

interface GroupAllocation {
  group_id: string
  group_name: string
  node_id: string
  node_hostname: string
  node_pool: string
  vpn_subnet: string
  managed_dns_enabled: boolean
  listener_ip: string | null
  created_at: string
  updated_at: string
}

interface FormState { name: string; cidr: string; description: string; node_ids: string[] }

interface NodeSelectorProps {
  selectedIds: string[]
  nodes: VpnNode[]
  onToggle: (nodeId: string) => void
}

// eslint-disable-next-line react-refresh/only-export-components
function NodeSelector({ selectedIds, nodes, onToggle }: NodeSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>Target Nodes</Label>
        <span
          className={`text-xs font-medium ${
            selectedIds.length > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'No nodes selected'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Select the nodes that can actually reach this network. Routes are only pushed to the
        nodes you select here.
      </p>
      {selectedIds.length === 0 && nodes.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            With no nodes selected this route is not pushed to any client.
          </p>
        </div>
      )}
      {nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No nodes registered.</p>
      ) : (
        <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
          {nodes.map((node) => {
            const selected = selectedIds.includes(node.id)
            const online = node.status === 'online'
            return (
              <button
                key={node.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                onClick={() => onToggle(node.id)}
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                  selected
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-transparent hover:bg-muted'
                }`}
              >
                <div
                  className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    selected
                      ? 'border-emerald-500 bg-emerald-500'
                      : 'border-muted-foreground/40 bg-transparent'
                  }`}
                >
                  {selected && <Check className="h-3 w-3 text-white" />}
                </div>
                <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{node.hostname}</span>
                </span>
                <span className="text-xs text-muted-foreground">{node.ip_address}</span>
                <span
                  className={`size-1.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`}
                  title={online ? 'Online' : 'Offline'}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function NetworksPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [activeTab, setActiveTab] = useState<'routes' | 'allocations'>('routes')

  // Target Networks state
  const [showCreate, setShowCreate] = useState(false)
  const [editNetwork, setEditNetwork] = useState<Network | null>(null)
  const [detailNetwork, setDetailNetwork] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', cidr: '', description: '', node_ids: [] })
  const [networkSearch, setNetworkSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'unassigned' | 'specific'>('all')
  const [groupFilter, setGroupFilter] = useState<'all' | 'assigned' | 'unassigned'>('all')

  // Group Allocations state
  const [showAllocDialog, setShowAllocDialog] = useState(false)
  const [allocForm, setAllocForm] = useState({ group_id: '', node_id: '', vpn_subnet: '' })
  const [allocSearch, setAllocSearch] = useState('')
  const [dnsFilter, setDnsFilter] = useState<'all' | 'dns_on' | 'dns_off'>('all')

  const { data: networks = [], isLoading } = useQuery<Network[]>({
    queryKey: ['networks'],
    queryFn: () => api.get('/api/v1/networks'),
  })

  const { data: networkDetail } = useQuery<NetworkDetail>({
    queryKey: ['networks', detailNetwork],
    queryFn: () => api.get(`/api/v1/networks/${detailNetwork}`),
    enabled: !!detailNetwork,
  })

  const { data: allNodes = [] } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/api/v1/groups'),
  })

  const { data: allocations = [], isLoading: isAllocLoading } = useQuery<GroupAllocation[]>({
    queryKey: ['group-allocations'],
    queryFn: () => api.get('/api/v1/networks/group-allocations'),
  })

  const createMutation = useMutation({
    mutationFn: (data: FormState) => api.post<Network>('/api/v1/networks', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] })
      setShowCreate(false)
      setForm({ name: '', cidr: '', description: '', node_ids: [] })
      toast.success('Network created successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormState }) =>
      api.patch<Network>(`/api/v1/networks/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] })
      setEditNetwork(null)
      toast.success('Network updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/networks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] })
      if (detailNetwork) setDetailNetwork(null)
      toast.success('Network deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const saveAllocMutation = useMutation({
    mutationFn: (data: { group_id: string; node_id: string; vpn_subnet: string }) =>
      api.post('/api/v1/networks/group-allocations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-allocations'] })
      qc.invalidateQueries({ queryKey: ['group-node-dns'] })
      setShowAllocDialog(false)
      setAllocForm({ group_id: '', node_id: '', vpn_subnet: '' })
      toast.success('Group subnet allocated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteAllocMutation = useMutation({
    mutationFn: ({ groupId, nodeId }: { groupId: string; nodeId: string }) =>
      api.delete(`/api/v1/networks/group-allocations/${groupId}/${nodeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-allocations'] })
      qc.invalidateQueries({ queryKey: ['group-node-dns'] })
      toast.success('Group subnet allocation removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleNode = (nodeId: string) => {
    setForm(f => ({
      ...f,
      node_ids: f.node_ids.includes(nodeId)
        ? f.node_ids.filter(id => id !== nodeId)
        : [...f.node_ids, nodeId],
    }))
  }

  const handleGroupSelectForAlloc = (groupId: string) => {
    const selectedGroup = allGroups.find(g => g.id === groupId)
    setAllocForm(prev => ({
      ...prev,
      group_id: groupId,
      vpn_subnet: prev.vpn_subnet || selectedGroup?.vpn_subnet || '',
    }))
  }

  const filteredNetworks = networks.filter((n) => {
    const q = networkSearch.toLowerCase().trim()
    const matchesSearch =
      !q ||
      n.name.toLowerCase().includes(q) ||
      n.cidr.toLowerCase().includes(q) ||
      (n.description && n.description.toLowerCase().includes(q))

    const matchesScope =
      scopeFilter === 'all'
        ? true
        : scopeFilter === 'unassigned'
        ? n.node_count === 0
        : n.node_count > 0

    const matchesGroup =
      groupFilter === 'all'
        ? true
        : groupFilter === 'assigned'
        ? n.group_count > 0
        : n.group_count === 0

    return matchesSearch && matchesScope && matchesGroup
  })

  const hasNetworkFilters = Boolean(networkSearch || scopeFilter !== 'all' || groupFilter !== 'all')

  const filteredAllocations = allocations.filter((a) => {
    const q = allocSearch.toLowerCase().trim()
    const matchesSearch =
      !q ||
      a.group_name.toLowerCase().includes(q) ||
      a.node_hostname.toLowerCase().includes(q) ||
      a.node_pool.toLowerCase().includes(q) ||
      a.vpn_subnet.toLowerCase().includes(q)

    const matchesDns =
      dnsFilter === 'all'
        ? true
        : dnsFilter === 'dns_on'
        ? a.managed_dns_enabled
        : !a.managed_dns_enabled

    return matchesSearch && matchesDns
  })

  const hasAllocFilters = Boolean(allocSearch || dnsFilter !== 'all')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Networks & IP Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {networks.length} network{networks.length !== 1 ? 's' : ''} defined • Manage target network routes and group VPN subnet allocations across node pools
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'routes' ? (
            <Button
              id="btn-create-network"
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              onClick={() => {
                setShowCreate(true)
                setForm({ name: '', cidr: '', description: '', node_ids: [] })
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add Network
            </Button>
          ) : (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              onClick={() => {
                setShowAllocDialog(true)
                setAllocForm({ group_id: '', node_id: '', vpn_subnet: '' })
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Allocate Subnet
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'routes' | 'allocations')} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="routes" className="gap-2">
            <Globe className="size-4" />
            Target Networks
          </TabsTrigger>
          <TabsTrigger value="allocations" className="gap-2">
            <Layers className="size-4" />
            Group Subnets per Node
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: TARGET NETWORKS ────────────────────────────────────── */}
        <TabsContent value="routes" className="space-y-4">
          {/* Toolbar: Search and Filter Pills */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search networks..."
                value={networkSearch}
                onChange={(e) => setNetworkSearch(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm"
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

            {/* Quick Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Scope filter pills */}
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setScopeFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    scopeFilter === 'all'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All Scopes
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter('unassigned')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    scopeFilter === 'unassigned'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  No Nodes
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter('specific')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    scopeFilter === 'specific'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Specific Nodes
                </button>
              </div>

              {/* Group assignment filter pills */}
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setGroupFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    groupFilter === 'all'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All Networks
                </button>
                <button
                  type="button"
                  onClick={() => setGroupFilter('assigned')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    groupFilter === 'assigned'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  With Groups
                </button>
                <button
                  type="button"
                  onClick={() => setGroupFilter('unassigned')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    groupFilter === 'unassigned'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Unassigned
                </button>
              </div>
            </div>
          </div>

          {/* Main Networks Table (Full Width) */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
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
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-40">
                      CIDR
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                      Description
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground w-32">
                      Groups
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36">
                      Nodes
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
                            <Skeleton className="h-4 w-28" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24 rounded-md" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-40" />
                        </TableCell>
                        <TableCell className="text-center">
                          <Skeleton className="h-5 w-16 mx-auto rounded-md" />
                        </TableCell>
                        <TableCell className="text-center">
                          <Skeleton className="h-5 w-20 mx-auto rounded-md" />
                        </TableCell>
                        <TableCell className="text-right pr-5">
                          <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredNetworks.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-16 text-center">
                        {hasNetworkFilters ? (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                              <Search className="h-6 w-6 text-muted-foreground/70" />
                            </div>
                            <h3 className="font-semibold text-foreground text-base">No networks found</h3>
                            <p className="text-xs text-muted-foreground mt-1 text-center">
                              No networks match your current search or filter criteria. Try resetting them.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-4 text-xs"
                              onClick={() => {
                                setNetworkSearch('')
                                setScopeFilter('all')
                                setGroupFilter('all')
                              }}
                            >
                              Clear all filters
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3 text-emerald-600 dark:text-emerald-400">
                              <Globe className="h-6 w-6" />
                            </div>
                            <h3 className="font-semibold text-foreground text-base">No networks defined yet</h3>
                            <p className="text-xs text-muted-foreground mt-1 text-center">
                              Define internal subnets (e.g. 10.0.1.0/24 or 172.31.0.0/20) that VPN users should be able to access.
                            </p>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredNetworks.map((n, index) => (
                      <TableRow
                        key={n.id}
                        className="hover:bg-muted/40 transition-colors group"
                      >
                        {/* # Number */}
                        <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                          {index + 1}
                        </TableCell>

                        {/* Network Name */}
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                              <Globe className="h-4.5 w-4.5" />
                            </div>
                            <span className="font-semibold text-sm text-foreground truncate">
                              {n.name}
                            </span>
                          </div>
                        </TableCell>

                        {/* CIDR */}
                        <TableCell>
                          <code className="px-2 py-0.5 rounded-md font-mono text-xs font-medium bg-muted/60 text-foreground border border-border/70">
                            {n.cidr}
                          </code>
                        </TableCell>

                        {/* Description */}
                        <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">
                          {n.description ? (
                            n.description
                          ) : (
                            <span className="text-muted-foreground/50 italic text-xs">No description</span>
                          )}
                        </TableCell>

                        {/* Groups Shortcut Badge */}
                        <TableCell className="text-center">
                          <button
                            type="button"
                            onClick={() => setDetailNetwork(n.id)}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-muted/60 hover:bg-muted hover:border-border text-foreground border border-border/80 transition-colors shadow-2xs group/btn cursor-pointer"
                            title="View associated groups"
                          >
                            <Users className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                            <span>{n.group_count}</span>
                            <span className="text-[10px] text-muted-foreground font-sans">
                              group{n.group_count !== 1 ? 's' : ''}
                            </span>
                          </button>
                        </TableCell>

                        {/* Nodes Shortcut Badge */}
                        <TableCell className="text-center">
                          {n.node_count === 0 ? (
                            <button
                              type="button"
                              onClick={() => setDetailNetwork(n.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 transition-colors cursor-pointer"
                              title="No target nodes selected — this route is not pushed to any client"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              <span>No nodes</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailNetwork(n.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-muted/60 hover:bg-muted hover:border-border text-foreground border border-border/80 transition-colors shadow-2xs group/btn cursor-pointer"
                              title="View target nodes"
                            >
                              <Server className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                              <span>{n.node_count}</span>
                              <span className="text-[10px] text-muted-foreground font-sans">
                                node{n.node_count !== 1 ? 's' : ''}
                              </span>
                            </button>
                          )}
                        </TableCell>

                        {/* Actions Dropdown */}
                        <TableCell className="text-right pr-5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="ml-auto flex p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
                                aria-label={`Actions for ${n.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onSelect={() => setDetailNetwork(n.id)}>
                                <Eye className="mr-2 h-4 w-4 text-muted-foreground" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditNetwork(n)
                                  setForm({
                                    name: n.name,
                                    cidr: n.cidr,
                                    description: n.description || '',
                                    node_ids: n.node_ids ?? [],
                                  })
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4 text-muted-foreground" />
                                Edit Network
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={async () => {
                                  const ok = await confirm({
                                    title: 'Delete network',
                                    description: `Delete network "${n.name}"?`,
                                    warning: 'This will remove access for all associated groups.',
                                    confirmLabel: 'Delete Network',
                                  })
                                  if (ok) deleteMutation.mutate(n.id)
                                }}
                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                              >
                                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                                Delete Network
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 2: GROUP SUBNET ALLOCATIONS ───────────────────────────── */}
        <TabsContent value="allocations" className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search allocations..."
                value={allocSearch}
                onChange={(e) => setAllocSearch(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm"
              />
              {allocSearch && (
                <button
                  type="button"
                  onClick={() => setAllocSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* DNS Filter pills */}
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDnsFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  dnsFilter === 'all'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All DNS
              </button>
              <button
                type="button"
                onClick={() => setDnsFilter('dns_on')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  dnsFilter === 'dns_on'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                DNS Enabled
              </button>
              <button
                type="button"
                onClick={() => setDnsFilter('dns_off')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  dnsFilter === 'dns_off'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                DNS Off
              </button>
            </div>
          </div>

          {/* Allocations Table */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent border-b border-border">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[180px]">
                      Group
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[180px]">
                      Target Node
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36">
                      Node Pool
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-44">
                      Allocated Subnet
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36">
                      Managed DNS
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-24">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/60">
                  {isAllocLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell className="text-center">
                          <Skeleton className="h-4 w-4 mx-auto rounded" />
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                            <Skeleton className="h-4 w-28" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24 rounded-md" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-28 rounded-md" />
                        </TableCell>
                        <TableCell className="text-center">
                          <Skeleton className="h-5 w-16 mx-auto rounded-full" />
                        </TableCell>
                        <TableCell className="text-right pr-5">
                          <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredAllocations.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-16 text-center">
                        {hasAllocFilters ? (
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                              <Search className="h-6 w-6 text-muted-foreground/70" />
                            </div>
                            <h3 className="font-semibold text-foreground text-base">No allocations found</h3>
                            <p className="text-xs text-muted-foreground mt-1 text-center">
                              No subnet allocations match your current search or filter.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-4 text-xs"
                              onClick={() => {
                                setAllocSearch('')
                                setDnsFilter('all')
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
                            <h3 className="font-semibold text-foreground text-base">No group subnets allocated yet</h3>
                            <p className="text-xs text-muted-foreground mt-1 text-center">
                              Divide node IP pools into distinct subnets for each group.
                            </p>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAllocations.map((a, index) => (
                      <TableRow
                        key={`${a.group_id}-${a.node_id}`}
                        className="hover:bg-muted/40 transition-colors group"
                      >
                        {/* # Number */}
                        <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                          {index + 1}
                        </TableCell>

                        {/* Group */}
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                              <Layers className="h-4.5 w-4.5" />
                            </div>
                            <span className="font-semibold text-sm text-foreground truncate">
                              {a.group_name}
                            </span>
                          </div>
                        </TableCell>

                        {/* Target Node */}
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            <Server className="size-3.5 text-muted-foreground" />
                            {a.node_hostname}
                          </div>
                        </TableCell>

                        {/* Node Pool */}
                        <TableCell>
                          <code className="text-xs bg-muted/60 text-muted-foreground border border-border/70 px-2 py-0.5 rounded font-mono">
                            {a.node_pool}
                          </code>
                        </TableCell>

                        {/* Allocated Subnet */}
                        <TableCell>
                          <code className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-medium">
                            {a.vpn_subnet}
                          </code>
                        </TableCell>

                        {/* Managed DNS */}
                        <TableCell className="text-center">
                          {a.managed_dns_enabled ? (
                            <Badge variant="outline" className="text-[11px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                              Enabled ({a.listener_ip || 'No IP'})
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[11px] text-muted-foreground">
                              Off
                            </Badge>
                          )}
                        </TableCell>

                        {/* Actions Dropdown */}
                        <TableCell className="text-right pr-5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="ml-auto flex p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
                                aria-label={`Actions for allocation on ${a.node_hostname}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setAllocForm({
                                    group_id: a.group_id,
                                    node_id: a.node_id,
                                    vpn_subnet: a.vpn_subnet,
                                  })
                                  setShowAllocDialog(true)
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4 text-muted-foreground" />
                                Edit Allocation
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={async () => {
                                  const ok = await confirm({
                                    title: 'Remove allocation',
                                    description: `Remove subnet allocation for group "${a.group_name}" on node "${a.node_hostname}"?`,
                                    confirmLabel: 'Remove Allocation',
                                  })
                                  if (ok) deleteAllocMutation.mutate({ groupId: a.group_id, nodeId: a.node_id })
                                }}
                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                              >
                                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                                Remove Allocation
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Network Detail Modal */}
      <Modal open={!!detailNetwork} onClose={() => setDetailNetwork(null)}>
        <ModalHeader
          title={networkDetail?.name ? `Network: ${networkDetail.name}` : 'Network Details'}
          onClose={() => setDetailNetwork(null)}
        />
        <ModalBody>
          {networkDetail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">CIDR Route</span>
                  <div className="mt-1">
                    <code className="px-2.5 py-1 rounded-md bg-muted font-mono text-sm font-semibold text-foreground border border-border">
                      {networkDetail.cidr}
                    </code>
                  </div>
                </div>
                {networkDetail.created_at && (
                  <div className="text-right">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(networkDetail.created_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>

              {networkDetail.description && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</span>
                  <p className="text-sm text-foreground bg-muted/30 p-2.5 rounded-lg border border-border/50">
                    {networkDetail.description}
                  </p>
                </div>
              )}

              {/* Target Nodes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Server className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Target Nodes
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      networkDetail.nodes.length === 0
                        ? 'text-xs border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'text-xs'
                    }
                  >
                    {networkDetail.nodes.length === 0 ? 'No nodes' : `${networkDetail.nodes.length} node(s)`}
                  </Badge>
                </div>
                {networkDetail.nodes.length === 0 ? (
                  <div className="flex items-start gap-2 text-xs bg-amber-500/10 p-3 rounded-lg border border-amber-500/30">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                      No target nodes selected, so this route is <strong>not pushed to any client</strong>.
                      Edit the network and select the nodes that can reach this subnet.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                    {networkDetail.nodes.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-muted/30 border border-border/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`size-1.5 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`} />
                          <span className="font-medium text-foreground">{node.hostname}</span>
                        </div>
                        <span className="font-mono text-muted-foreground">{node.ip_address}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Associated Groups */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Associated Groups
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {networkDetail.groups.length} group{networkDetail.groups.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                {networkDetail.groups.length === 0 ? (
                  <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-lg border border-border/50">
                    No groups currently have access to this route. Assign this network in Group Settings.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                    {networkDetail.groups.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-muted/30 border border-border/40"
                      >
                        <div className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium text-foreground">{g.name}</span>
                        </div>
                        {g.description && (
                          <span className="text-muted-foreground truncate max-w-[200px]">{g.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading details...</div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setDetailNetwork(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Allocate Subnet Modal */}
      <Modal open={showAllocDialog} onClose={() => setShowAllocDialog(false)}>
        <ModalHeader title="Allocate Group Subnet on Node" onClose={() => setShowAllocDialog(false)} />
        <ModalBody>
          <div className="space-y-1.5">
            <Label htmlFor="alloc-dlg-group">Target Group</Label>
            <select
              id="alloc-dlg-group"
              className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              value={allocForm.group_id}
              onChange={(e) => handleGroupSelectForAlloc(e.target.value)}
            >
              <option value="">Select a group...</option>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.vpn_subnet ? `(Default: ${g.vpn_subnet})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alloc-dlg-node">Target Node</Label>
            <select
              id="alloc-dlg-node"
              className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              value={allocForm.node_id}
              onChange={(e) => setAllocForm({ ...allocForm, node_id: e.target.value })}
            >
              <option value="">Select a node...</option>
              {allNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.hostname} ({n.ip_address})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alloc-dlg-subnet">Group VPN Subnet</Label>
            <Input
              id="alloc-dlg-subnet"
              placeholder="e.g. 10.8.10.0/24"
              value={allocForm.vpn_subnet}
              onChange={(e) => setAllocForm({ ...allocForm, vpn_subnet: e.target.value })}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Must be an available subnet contained inside the target node's VPN network pool.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowAllocDialog(false)}>Cancel</Button>
          <Button
            disabled={!allocForm.group_id || !allocForm.node_id || !allocForm.vpn_subnet.trim() || saveAllocMutation.isPending}
            onClick={() => saveAllocMutation.mutate(allocForm)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saveAllocMutation.isPending ? 'Saving...' : 'Save Allocation'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Create Target Network Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}>
        <ModalHeader title="Add Network Route" onClose={() => setShowCreate(false)} />
        <ModalBody>
          <div className="space-y-1.5">
            <Label htmlFor="net-name">Name</Label>
            <Input
              id="net-name"
              placeholder="e.g. Office LAN"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="net-cidr">CIDR</Label>
            <Input
              id="net-cidr"
              placeholder="e.g. 10.0.1.0/24"
              value={form.cidr}
              onChange={e => setForm(f => ({ ...f, cidr: e.target.value }))}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">IPv4 CIDR notation (e.g. 192.168.1.0/24)</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="net-desc">Description</Label>
            <Textarea
              id="net-desc"
              placeholder="Optional description"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <NodeSelector selectedIds={form.node_ids} nodes={allNodes} onToggle={toggleNode} />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button
            id="btn-create-network-submit"
            disabled={!form.name.trim() || !form.cidr.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(form)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {createMutation.isPending ? 'Adding...' : 'Add Network'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Target Network Modal */}
      <Modal open={!!editNetwork} onClose={() => setEditNetwork(null)}>
        <ModalHeader title="Edit Network Route" onClose={() => setEditNetwork(null)} />
        <ModalBody>
          <div className="space-y-1.5">
            <Label htmlFor="edit-net-name">Name</Label>
            <Input
              id="edit-net-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-net-cidr">CIDR</Label>
            <Input
              id="edit-net-cidr"
              value={form.cidr}
              onChange={e => setForm(f => ({ ...f, cidr: e.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-net-desc">Description</Label>
            <Textarea
              id="edit-net-desc"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <NodeSelector selectedIds={form.node_ids} nodes={allNodes} onToggle={toggleNode} />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setEditNetwork(null)}>Cancel</Button>
          <Button
            id="btn-edit-network-submit"
            disabled={!form.name.trim() || !form.cidr.trim() || updateMutation.isPending}
            onClick={() => editNetwork && updateMutation.mutate({ id: editNetwork.id, data: form })}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
