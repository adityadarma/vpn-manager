import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Plus, Trash2, Pencil, Globe, Users, Server, Check, Network as NetworkIcon, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
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

function NetworksPage() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'routes' | 'allocations'>('routes')

  // Target Networks state
  const [showCreate, setShowCreate] = useState(false)
  const [editNetwork, setEditNetwork] = useState<Network | null>(null)
  const [detailNetwork, setDetailNetwork] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', cidr: '', description: '', node_ids: [] })

  // Group Allocations state
  const [showAllocDialog, setShowAllocDialog] = useState(false)
  const [allocForm, setAllocForm] = useState({ group_id: '', node_id: '', vpn_subnet: '' })

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

  const selectedAllocNode = allNodes.find(n => n.id === allocForm.node_id)

  const NodeSelector = ({ selectedIds }: { selectedIds: string[] }) => (
    <div className="space-y-1.5">
      <Label>Target Nodes <span className="text-xs text-muted-foreground font-normal">(leave empty = global, apply to all)</span></Label>
      {allNodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No nodes registered.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
          {allNodes.map(node => (
            <button
              key={node.id}
              type="button"
              onClick={() => toggleNode(node.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                selectedIds.includes(node.id)
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'hover:bg-muted border border-transparent'
              }`}
            >
              <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                selectedIds.includes(node.id) ? 'bg-emerald-500 border-emerald-500' : 'border-input'
              }`}>
                {selectedIds.includes(node.id) && <Check className="h-3 w-3 text-white" />}
              </div>
              <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{node.hostname}</span>
              <span className="text-xs text-muted-foreground ml-auto">{node.ip_address}</span>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${node.status === 'online' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Networks & IP Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage target network routes and group VPN subnet allocations across node pools.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'routes' ? (
            <Button
              id="btn-create-network"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                setShowCreate(true)
                setForm({ name: '', cidr: '', description: '', node_ids: [] })
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Network
            </Button>
          ) : (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                setShowAllocDialog(true)
                setAllocForm({ group_id: '', node_id: '', vpn_subnet: '' })
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
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
        <TabsContent value="routes" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className={detailNetwork ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="p-5 border-b border-border/50">
                  <h2 className="font-semibold text-foreground">Network Segments</h2>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">{networks.length} network{networks.length !== 1 ? 's' : ''} defined</p>
                </div>
                <div className="p-0">
                  {isLoading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
                  ) : networks.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <Globe className="h-8 w-8 mx-auto text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No networks defined yet.</p>
                      <p className="text-xs text-muted-foreground">Add internal subnets (e.g. 10.0.1.0/24) that VPN users should be able to access.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>CIDR</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Groups</TableHead>
                          <TableHead>Nodes</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {networks.map(n => (
                          <TableRow
                            key={n.id}
                            className={`cursor-pointer ${detailNetwork === n.id ? 'bg-muted/50' : ''}`}
                            onClick={() => setDetailNetwork(detailNetwork === n.id ? null : n.id)}
                          >
                            <TableCell className="font-medium">{n.name}</TableCell>
                            <TableCell>
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{n.cidr}</code>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">
                              {n.description || '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="gap-1 text-xs">
                                <Users className="h-3 w-3" />
                                {n.group_count}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {n.node_count === 0 ? (
                                <Badge variant="outline" className="text-xs text-muted-foreground">All Nodes</Badge>
                              ) : (
                                <Badge variant="secondary" className="gap-1 text-xs">
                                  <Server className="h-3 w-3" />
                                  {n.node_count} node{n.node_count !== 1 ? 's' : ''}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditNetwork(n)
                                    setForm({
                                      name: n.name,
                                      cidr: n.cidr,
                                      description: n.description || '',
                                      node_ids: n.node_ids ?? [],
                                    })
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                                  onClick={() => {
                                    if (confirm(`Delete network "${n.name}"? This will remove access for all associated groups.`)) {
                                      deleteMutation.mutate(n.id)
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </div>

            {/* Network detail sidebar */}
            {detailNetwork && networkDetail && (
              <div className="space-y-4">
                <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">{networkDetail.name}</h3>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{networkDetail.cidr}</code>
                  </div>
                  {networkDetail.description && (
                    <p className="text-sm text-muted-foreground mb-4">{networkDetail.description}</p>
                  )}

                  <div className="space-y-4 pt-2 border-t border-border/50">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Nodes</span>
                        <Badge className="text-xs" variant="outline">
                          {networkDetail.nodes.length === 0 ? 'All Nodes (Global)' : `${networkDetail.nodes.length} node(s)`}
                        </Badge>
                      </div>
                      {networkDetail.nodes.length === 0 ? (
                        <p className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg">
                          This route is pushed to connected clients on <strong>all nodes</strong>.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {networkDetail.nodes.map(node => (
                            <div key={node.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/30">
                              <span className="font-medium">{node.hostname}</span>
                              <span className="font-mono text-muted-foreground">{node.ip_address}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Associated Groups</span>
                        <Badge className="text-xs bg-emerald-100 text-emerald-700">{networkDetail.groups.length}</Badge>
                      </div>
                      {networkDetail.groups.length === 0 ? (
                        <p className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg">
                          No groups assigned yet. Assign in Groups menu.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {networkDetail.groups.map(g => (
                            <div key={g.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/30">
                              <span className="font-medium">{g.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TAB 2: GROUP SUBNET ALLOCATIONS ───────────────────────────── */}
        <TabsContent value="allocations" className="space-y-6">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border/50 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Node Subnet Allocations</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Divide node IP pools into distinct subnets for each group. Members connecting to that node receive an IP from the allocated subnet.
                </p>
              </div>
              <Badge variant="outline" className="text-xs self-start sm:self-auto font-mono">
                {allocations.length} allocation{allocations.length !== 1 ? 's' : ''}
              </Badge>
            </div>

            <div className="p-0">
              {isAllocLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading allocations...</div>
              ) : allocations.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <Layers className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No group subnets allocated yet.</p>
                  <p className="text-xs text-muted-foreground">
                    Click "Allocate Subnet" to map a group to a dedicated subnet within a node's IP pool.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead>Target Node</TableHead>
                      <TableHead>Node Pool</TableHead>
                      <TableHead>Allocated Group Subnet</TableHead>
                      <TableHead>Managed DNS</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map(a => (
                      <TableRow key={`${a.group_id}-${a.node_id}`}>
                        <TableCell className="font-semibold text-sm">
                          {a.group_name}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5 font-medium">
                            <Server className="size-3.5 text-muted-foreground" />
                            {a.node_hostname}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                            {a.node_pool}
                          </code>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-medium">
                            {a.vpn_subnet}
                          </code>
                        </TableCell>
                        <TableCell>
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
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setAllocForm({
                                  group_id: a.group_id,
                                  node_id: a.node_id,
                                  vpn_subnet: a.vpn_subnet,
                                })
                                setShowAllocDialog(true)
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                              onClick={() => {
                                if (confirm(`Remove subnet allocation for group "${a.group_name}" on node "${a.node_hostname}"?`)) {
                                  deleteAllocMutation.mutate({ groupId: a.group_id, nodeId: a.node_id })
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

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
          <NodeSelector selectedIds={form.node_ids} />
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
          <NodeSelector selectedIds={form.node_ids} />
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
