import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/policies')({
  component: PoliciesPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Shield, X, Search, Users, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Policy {
  id: string
  userId: string | null
  groupId: string | null
  node_id: string | null
  username?: string
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

function PoliciesPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPolicies, setSelectedPolicies] = useState<Set<string>>(new Set())
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

  const { data: users = [] } = useQuery<{ id: string; username: string }[]>({
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
    mutationFn: () => api.post('/api/v1/policies', {
      userId: form.targetType === 'user' ? form.userId : undefined,
      groupId: form.targetType === 'group' ? form.groupId : undefined,
      nodeId: form.nodeId || undefined,
      targetNetwork: form.targetNetwork,
      protocol: form.protocol,
      targetPort: form.targetPort || undefined,
      action: form.action,
      priority: parseInt(form.priority) || 100,
      description: form.description || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      setShowForm(false)
      setForm({ targetType: 'group', userId: '', groupId: '', nodeId: '', targetNetwork: '', protocol: 'all', targetPort: '', action: 'allow', priority: '100', description: '' })
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

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => api.delete(`/api/v1/policies/${id}`)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      setSelectedPolicies(new Set())
      toast.success('Policies deleted successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const togglePolicy = (policyId: string) => {
    const newSelected = new Set(selectedPolicies)
    if (newSelected.has(policyId)) {
      newSelected.delete(policyId)
    } else {
      newSelected.add(policyId)
    }
    setSelectedPolicies(newSelected)
  }

  const toggleAll = (policyList: Policy[]) => {
    const policyIds = policyList.map(p => p.id)
    const allSelected = policyIds.every(id => selectedPolicies.has(id))
    
    if (allSelected) {
      const newSelected = new Set(selectedPolicies)
      policyIds.forEach(id => newSelected.delete(id))
      setSelectedPolicies(newSelected)
    } else {
      setSelectedPolicies(new Set([...selectedPolicies, ...policyIds]))
    }
  }

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedPolicies.size} polic${selectedPolicies.size === 1 ? 'y' : 'ies'}?`)) {
      bulkDeleteMutation.mutate(Array.from(selectedPolicies))
    }
  }

  // Filter policies
  const userPolicies = policies.filter(p => p.userId)
  const groupPolicies = policies.filter(p => p.groupId)
  const globalPolicies = policies.filter(p => !p.userId && !p.groupId)

  // Search filter
  const filterPolicies = (policyList: Policy[]) => {
    if (!searchQuery) return policyList
    const query = searchQuery.toLowerCase()
    return policyList.filter(p => 
      (p.username?.toLowerCase().includes(query)) ||
      (p.group_name?.toLowerCase().includes(query)) ||
      p.target_network.toLowerCase().includes(query) ||
      (p.target_port?.toLowerCase().includes(query)) ||
      (p.description?.toLowerCase().includes(query))
    )
  }

  const filteredUserPolicies = filterPolicies(userPolicies)
  const filteredGroupPolicies = filterPolicies(groupPolicies)
  const filteredGlobalPolicies = filterPolicies(globalPolicies)

  const PolicyTable = ({ policies: policyList, type }: { policies: Policy[]; type: 'user' | 'group' | 'global' }) => {
    const policyIds = policyList.map(p => p.id)
    const allSelected = policyList.length > 0 && policyIds.every(id => selectedPolicies.has(id))

    return (
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
        {policyList.length === 0 ? (
          <div className="py-16 text-center">
            <Shield className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="font-medium text-foreground">No {type} policies found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchQuery ? 'Try a different search term' : `Create network access rules for ${type}s`}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-5 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => toggleAll(policyList)}
                    className="rounded border-input text-primary focus:ring-primary"
                  />
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {type === 'global' ? 'Target' : (type === 'user' ? 'User' : 'Group')}
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Routing Node</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target Network</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Port/Proto</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Priority</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policyList.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-5 py-4">
                    <input
                      type="checkbox"
                      checked={selectedPolicies.has(p.id)}
                      onChange={() => togglePolicy(p.id)}
                      className="rounded border-input text-primary focus:ring-primary"
                    />
                  </td>
                  <td className="px-5 py-4 text-foreground font-medium whitespace-nowrap">
                    {type === 'global' ? <span className="text-muted-foreground italic">All Clients</span> : (type === 'user' ? (p.username ?? p.userId) : (p.group_name ?? p.groupId))}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    {p.node_name ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {p.node_name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Global</span>
                    )}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-muted-foreground whitespace-nowrap">{p.target_network}</td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="font-mono text-xs text-muted-foreground uppercase bg-muted px-1.5 py-0.5 rounded">{p.protocol}</span>
                    {p.target_port && <span className="font-mono text-xs text-muted-foreground ml-1">:{p.target_port}</span>}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                      p.action === 'allow'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}>
                      {p.action}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{p.priority}</td>
                  <td className="px-5 py-4 text-muted-foreground max-w-xs truncate">
                    {p.description && p.description.length > 0 ? p.description : '—'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => { if (confirm('Delete policy?')) deleteMutation.mutate(p.id) }}
                      className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Network Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {policies.length} rule{policies.length !== 1 ? 's' : ''} defined
            {selectedPolicies.size > 0 && ` • ${selectedPolicies.size} selected`}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedPolicies.size > 0 && (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete ({selectedPolicies.size})
            </Button>
          )}
          <Button
            id="btn-add-policy"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => setShowForm(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Policy
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search policies by user, group, network, or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Tabs */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading policies...</div>
      ) : (
        <Tabs defaultValue="user" className="space-y-4">
          <TabsList>
            <TabsTrigger value="group" className="gap-2">
              <UsersRound className="h-4 w-4" />
              Group Policies ({groupPolicies.length})
            </TabsTrigger>
            <TabsTrigger value="user" className="gap-2">
              <Users className="h-4 w-4" />
              User Policies ({userPolicies.length})
            </TabsTrigger>
            <TabsTrigger value="global" className="gap-2">
              <Shield className="h-4 w-4" />
              Global Policies ({globalPolicies.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="group">
            <PolicyTable policies={filteredGroupPolicies} type="group" />
          </TabsContent>

          <TabsContent value="user">
            <PolicyTable policies={filteredUserPolicies} type="user" />
          </TabsContent>

          <TabsContent value="global">
            <PolicyTable policies={filteredGlobalPolicies} type="global" />
          </TabsContent>
        </Tabs>
      )}

      {/* Add Policy Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-background rounded-xl shadow-xl border border-border w-full max-w-md my-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="font-semibold text-foreground">Add Policy</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Define network access rules</p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={e => { e.preventDefault(); createMutation.mutate() }}
              className="p-5 space-y-4"
            >
              <div>
                <Label className="block text-sm font-medium mb-1.5">Target Node</Label>
                <select
                  value={form.nodeId}
                  onChange={e => setForm({ ...form, nodeId: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                >
                  <option value="">Global (All Nodes)</option>
                  {nodes.map(n => <option key={n.id} value={n.id}>{n.hostname}</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Bind this policy to a specific node. Keep "Global" to apply evenly across all nodes.</p>
              </div>

              <div>
                <Label className="block text-sm font-medium mb-1.5">Target Type <span className="text-red-500">*</span></Label>
                <select
                  value={form.targetType}
                  onChange={e => setForm({ ...form, targetType: e.target.value as 'user' | 'group' | 'global', userId: '', groupId: '' })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                >
                  <option value="group">Group</option>
                  <option value="user">User</option>
                  <option value="global">Global (All Clients)</option>
                </select>
              </div>

              {form.targetType === 'user' && (
                <div>
                  <Label className="block text-sm font-medium mb-1.5">User <span className="text-red-500">*</span></Label>
                  <select
                    value={form.userId}
                    onChange={e => setForm({ ...form, userId: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                  >
                    <option value="">Select user...</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                  </select>
                </div>
              )}

              {form.targetType === 'group' && (
                <div>
                  <Label className="block text-sm font-medium mb-1.5">Group <span className="text-red-500">*</span></Label>
                  <select
                    value={form.groupId}
                    onChange={e => setForm({ ...form, groupId: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                  >
                    <option value="">Select group...</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label className="block text-sm font-medium mb-1.5">Target Network IP / CIDR <span className="text-red-500">*</span></Label>
                  <Input
                    type="text"
                    value={form.targetNetwork}
                    onChange={e => setForm({ ...form, targetNetwork: e.target.value })}
                    placeholder="172.31.6.140/32"
                    required
                    className="font-mono bg-background text-foreground"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Specify full CIDR block like /24 or /32 for single IP.</p>
                </div>
                <div>
                  <Label className="block text-sm font-medium mb-1.5">Protocol</Label>
                  <select
                    value={form.protocol}
                    onChange={e => setForm({ ...form, protocol: e.target.value as any })}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
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
                    onChange={e => setForm({ ...form, targetPort: e.target.value })}
                    placeholder="e.g. 5432, 80:443"
                    disabled={form.protocol === 'all' || form.protocol === 'icmp'}
                    className={form.protocol === 'all' || form.protocol === 'icmp' ? 'opacity-50 cursor-not-allowed' : 'bg-background text-foreground'}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Leave empty for all ports</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="block text-sm font-medium mb-1.5">Action</Label>
                  <select
                    value={form.action}
                    onChange={e => setForm({ ...form, action: e.target.value as 'allow' | 'deny' })}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
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
                    onChange={e => setForm({ ...form, priority: e.target.value })}
                    placeholder="100"
                    min="1"
                    max="1000"
                    className="bg-background text-foreground"
                  />
                </div>
              </div>
              <div>
                <Label className="block text-sm font-medium mb-1.5">Description</Label>
                <Input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description"
                  className="bg-background text-foreground"
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
                  className="flex-1"
                >
                  {createMutation.isPending ? 'Adding...' : 'Add Policy'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
