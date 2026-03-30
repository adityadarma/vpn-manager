import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/networks')({
  component: NetworksPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Plus, Trash2, Pencil, Globe, Users } from 'lucide-react'
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface Network {
  id: string
  name: string
  cidr: string
  description: string | null
  group_count: number
  created_at: string
}

interface NetworkDetail extends Network {
  groups: Array<{ id: string; name: string; description: string | null }>
}

interface FormState { name: string; cidr: string; description: string }

function NetworksPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editNetwork, setEditNetwork] = useState<Network | null>(null)
  const [detailNetwork, setDetailNetwork] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', cidr: '', description: '' })

  const { data: networks = [], isLoading } = useQuery<Network[]>({
    queryKey: ['networks'],
    queryFn: () => api.get('/api/v1/networks'),
  })

  const { data: networkDetail } = useQuery<NetworkDetail>({
    queryKey: ['networks', detailNetwork],
    queryFn: () => api.get(`/api/v1/networks/${detailNetwork}`),
    enabled: !!detailNetwork,
  })

  const createMutation = useMutation({
    mutationFn: (data: FormState) => api.post<Network>('/api/v1/networks', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] })
      setShowCreate(false)
      setForm({ name: '', cidr: '', description: '' })
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
    setForm({ name: n.name, cidr: n.cidr, description: n.description ?? '' })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Networks</h1>
          <p className="text-sm text-muted-foreground mt-1">{networks.length} network{networks.length !== 1 ? 's' : ''} defined</p>
        </div>
        <Button id="btn-create-network" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setShowCreate(true); setForm({ name: '', cidr: '', description: '' }) }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Network
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Networks table */}
        <div className={detailNetwork ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Network Segments</CardTitle>
              <CardDescription>{networks.length} network{networks.length !== 1 ? 's' : ''} defined</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
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
            </CardContent>
          </Card>
        </div>

        {/* Detail panel */}
        {detailNetwork && networkDetail && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Assigned to Groups
                <Badge className="ml-auto">{networkDetail.groups.length}</Badge>
              </CardTitle>
              <CardDescription>
                <code className="text-xs">{networkDetail.cidr}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {networkDetail.groups.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Not assigned to any group yet.</p>
              ) : (
                <div className="divide-y">
                  {networkDetail.groups.map(g => (
                    <div key={g.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Users className="h-4 w-4 text-emerald-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{g.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{g.description ?? '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
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
        <DialogContent>
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
