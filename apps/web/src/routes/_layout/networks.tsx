import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/networks')({
  component: NetworksPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Plus, Trash2, Pencil, Globe, Users, Server, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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
}

interface FormState { name: string; cidr: string; description: string; node_ids: string[] }

function NetworksPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editNetwork, setEditNetwork] = useState<Network | null>(null)
  const [detailNetwork, setDetailNetwork] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', cidr: '', description: '', node_ids: [] })

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

  const openEdit = (n: Network) => {
    setEditNetwork(n)
    setForm({ name: n.name, cidr: n.cidr, description: n.description ?? '', node_ids: n.node_ids ?? [] })
  }

  const toggleNode = (nodeId: string) => {
    setForm(f => ({
      ...f,
      node_ids: f.node_ids.includes(nodeId)
        ? f.node_ids.filter(id => id !== nodeId)
        : [...f.node_ids, nodeId],
    }))
  }

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Networks</h1>
          <p className="text-sm text-muted-foreground mt-1">{networks.length} network{networks.length !== 1 ? 's' : ''} defined</p>
        </div>
        <Button id="btn-create-network" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setShowCreate(true); setForm({ name: '', cidr: '', description: '', node_ids: [] }) }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Network
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Networks table */}
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
                      <TableHead className="text-center">Groups</TableHead>
                      <TableHead className="text-center">Nodes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {networks.map((n) => (
                      <TableRow
                        key={n.id}
                        className={`cursor-pointer hover:bg-muted/50 ${detailNetwork === n.id ? 'bg-muted' : ''}`}
                        onClick={() => setDetailNetwork(detailNetwork === n.id ? null : n.id)}
                      >
                        <TableCell className="font-medium">{n.name}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{n.cidr}</code>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{n.description ?? '—'}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{n.group_count}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {n.node_count > 0 ? (
                            <Badge className="bg-sky-100 text-sky-700 border-sky-200">{n.node_count} node{n.node_count !== 1 ? 's' : ''}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Global</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" id={`btn-edit-network-${n.id}`} onClick={() => openEdit(n)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              id={`btn-delete-network-${n.id}`}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => deleteMutation.mutate(n.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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

        {/* Detail panel */}
        {detailNetwork && networkDetail && (
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border/50 flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <Globe className="h-4 w-4 text-emerald-500" />
                  {networkDetail.name}
                </div>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground mt-1 block w-fit">{networkDetail.cidr}</code>
              </div>
              <button
                onClick={() => setDetailNetwork(null)}
                className="p-1 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted rounded-md transition-colors shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Assigned Nodes */}
            <div className="p-4 border-b border-border/50">
              <div className="flex items-center gap-2 mb-3">
                <Server className="h-3.5 w-3.5 text-sky-500" />
                <span className="text-sm font-medium">Nodes</span>
                <Badge className="ml-auto bg-sky-100 text-sky-700 border-sky-200 text-xs">
                  {networkDetail.nodes?.length > 0 ? networkDetail.nodes.length : 'Global'}
                </Badge>
              </div>
              {!networkDetail.nodes || networkDetail.nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Applied to all nodes (global network).</p>
              ) : (
                <div className="space-y-1">
                  {networkDetail.nodes.map(node => (
                    <div key={node.id} className="flex items-center gap-2 text-sm">
                      <span className={`w-1.5 h-1.5 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      <span className="font-medium">{node.hostname}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{node.ip_address}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assigned Groups */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-sm font-medium">Groups</span>
                <Badge className="ml-auto bg-emerald-100 text-emerald-700 text-xs">{networkDetail.groups.length}</Badge>
              </div>
              {networkDetail.groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not assigned to any group yet.</p>
              ) : (
                <div className="space-y-1">
                  {networkDetail.groups.map(g => (
                    <div key={g.id} className="flex items-center gap-2 text-sm">
                      <div className="h-6 w-6 rounded bg-emerald-100 flex items-center justify-center shrink-0">
                        <Users className="h-3 w-3 text-emerald-700" />
                      </div>
                      <div>
                        <p className="font-medium leading-none">{g.name}</p>
                        {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Network</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              id="btn-create-network-submit"
              disabled={!form.name.trim() || !form.cidr.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Network'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editNetwork} onOpenChange={() => setEditNetwork(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Network</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNetwork(null)}>Cancel</Button>
            <Button
              id="btn-edit-network-submit"
              disabled={!form.name.trim() || !form.cidr.trim() || updateMutation.isPending}
              onClick={() => editNetwork && updateMutation.mutate({ id: editNetwork.id, data: form })}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
