import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/nodes')({
  component: NodesPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, MapPin, Clock, Activity, Server, X, Copy, CheckCircle2, Settings, RefreshCw, Edit } from 'lucide-react'
import type { VpnNode } from '@vpn/shared'
import { Button } from '@/components/ui/button'

interface NodeForm {
  hostname: string
  ipAddress: string
  region: string
}

interface NodeConfig {
  port: number
  protocol: 'udp' | 'tcp'
  tunnel_mode: 'full' | 'split'
  vpn_network: string
  vpn_netmask: string
  dns_servers: string
  push_routes: string
  cipher: string
  auth_digest: string
  compression: string
  keepalive_ping: number
  keepalive_timeout: number
  max_clients: number
  custom_push_directives: string
}

interface RegisterResponse extends VpnNode {
  token?: string
}

function NodesPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NodeForm>({ hostname: '', ipAddress: '', region: '' })
  const [registeredNode, setRegisteredNode] = useState<{ id: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set())
  const [configNode, setConfigNode] = useState<string | null>(null)
  const [editNode, setEditNode] = useState<VpnNode | null>(null)
  const [editForm, setEditForm] = useState<NodeForm>({ hostname: '', ipAddress: '', region: '' })
  const [nodeConfig, setNodeConfig] = useState<NodeConfig>({
    port: 1194,
    protocol: 'udp',
    tunnel_mode: 'full',
    vpn_network: '10.8.0.0',
    vpn_netmask: '255.255.255.0',
    dns_servers: '8.8.8.8,1.1.1.1',
    push_routes: '',
    cipher: 'AES-256-GCM',
    auth_digest: 'SHA256',
    compression: 'lz4-v2',
    keepalive_ping: 10,
    keepalive_timeout: 120,
    max_clients: 100,
    custom_push_directives: '',
  })

  const { data: nodes = [], isLoading } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  const createMutation = useMutation({
    mutationFn: (data: NodeForm) => api.post<RegisterResponse>('/api/v1/nodes/register', {
      hostname: data.hostname,
      ip: data.ipAddress,
      region: data.region,
      version: 'web-registered',
      port: 1194,
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      if (data.id && data.token) {
        setRegisteredNode({ id: data.id, token: data.token })
      } else {
        setShowForm(false)
        setForm({ hostname: '', ipAddress: '', region: '' })
      }
      toast.success('Node registered successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const copyCredentials = () => {
    if (!registeredNode) return
    const text = `AGENT_NODE_ID=${registeredNode.id}\nAGENT_SECRET_TOKEN=${registeredNode.token}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Credentials copied to clipboard')
  }

  const closeRegistration = () => {
    setRegisteredNode(null)
    setShowForm(false)
    setForm({ hostname: '', ipAddress: '', region: '' })
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/nodes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('Node removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => api.delete(`/api/v1/nodes/${id}`)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      setSelectedNodes(new Set())
      toast.success('Nodes deleted successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openConfigModal = async (nodeId: string) => {
    try {
      const config = await api.get<NodeConfig>(`/api/v1/nodes/${nodeId}/config`)
      setNodeConfig(config)
      setConfigNode(nodeId)
    } catch (error: any) {
      toast.error(error.message || 'Failed to load configuration')
    }
  }

  const updateConfigMutation = useMutation({
    mutationFn: (data: { nodeId: string; config: NodeConfig }) =>
      api.put(`/api/v1/nodes/${data.nodeId}/config`, data.config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      setConfigNode(null)
      toast.success('Configuration updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const syncCertsMutation = useMutation({
    mutationFn: (nodeId: string) =>
      api.post(`/api/v1/tasks`, {
        node_id: nodeId,
        action: 'sync_certificates',
        payload: {}
      }),
    onSuccess: () => {
      toast.success('Certificate sync task created. Check node logs for progress.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openEditModal = (node: VpnNode) => {
    setEditNode(node)
    setEditForm({
      hostname: node.hostname,
      ipAddress: node.ip_address,
      region: node.region || ''
    })
  }

  const updateNodeMutation = useMutation({
    mutationFn: (data: { nodeId: string; updates: Partial<NodeForm> }) =>
      api.put(`/api/v1/nodes/${data.nodeId}`, {
        hostname: data.updates.hostname,
        ip_address: data.updates.ipAddress,
        region: data.updates.region || null
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      setEditNode(null)
      toast.success('Node updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleUpdateNode = () => {
    if (!editNode) return
    updateNodeMutation.mutate({
      nodeId: editNode.id,
      updates: editForm
    })
  }

  const toggleNode = (nodeId: string) => {
    const newSelected = new Set(selectedNodes)
    if (newSelected.has(nodeId)) {
      newSelected.delete(nodeId)
    } else {
      newSelected.add(nodeId)
    }
    setSelectedNodes(newSelected)
  }

  const toggleAll = () => {
    if (selectedNodes.size === nodes.length) {
      setSelectedNodes(new Set())
    } else {
      setSelectedNodes(new Set(nodes.map(n => n.id)))
    }
  }

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedNodes.size} node(s)?`)) {
      bulkDeleteMutation.mutate(Array.from(selectedNodes))
    }
  }

  const onlineCount = nodes.filter(n => n.status === 'online').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VPN Nodes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {onlineCount}/{nodes.length} nodes online
            {selectedNodes.size > 0 && ` • ${selectedNodes.size} selected`}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedNodes.size > 0 && (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete ({selectedNodes.size})
            </Button>
          )}
          <Button
            id="btn-add-node"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setShowForm(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Node
          </Button>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground/70">Loading nodes...</div>
      ) : nodes.length === 0 ? (
        <div className="bg-card text-card-foreground rounded-xl border border-dashed border-border p-12 text-center">
          <Server className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-foreground">No nodes registered</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Add your first VPN node to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Select All Checkbox */}
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={nodes.length > 0 && selectedNodes.size === nodes.length}
              onChange={toggleAll}
              className="rounded border-input text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-muted-foreground">Select all</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {nodes.map((node) => (
              <div key={node.id} className="bg-card text-card-foreground rounded-xl border border-border shadow-sm p-5 relative">
                {/* Checkbox */}
                <div className="absolute top-3 left-3">
                  <input
                    type="checkbox"
                    checked={selectedNodes.has(node.id)}
                    onChange={() => toggleNode(node.id)}
                    className="rounded border-input text-emerald-600 focus:ring-emerald-500"
                  />
                </div>

                {/* Status & Hostname */}
                <div className="flex items-start justify-between mb-4 ml-7">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${node.status === 'online' ? 'bg-emerald-500 shadow-sm shadow-emerald-200' : 'bg-gray-300'
                      }`} />
                    <div>
                      <p className="font-semibold text-foreground">{node.hostname}</p>
                      <p className="text-xs font-mono text-muted-foreground/70 mt-0.5">{node.ip_address}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${node.status === 'online'
                      ? 'bg-emerald-50 text-emerald-700'
                      : node.status === 'offline'
                        ? 'bg-red-50 text-red-600'
                        : 'bg-amber-50 text-amber-600'
                    }`}>
                    {node.status}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-1.5 text-xs text-muted-foreground ml-7">
                  {node.region && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-gray-300" /> {node.region}
                    </div>
                  )}
                  {node.version && (
                    <div className="flex items-center gap-2">
                      <Server className="h-3.5 w-3.5 text-gray-300" /> {node.version}
                    </div>
                  )}
                  {node.last_seen && (
                    <div className="flex items-center gap-2" >
                      <Clock className="h-3.5 w-3.5 text-gray-300" />
                      Last seen {new Date(node.last_seen).toLocaleString()}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5 text-gray-300" /> {node.active_sessions ?? 0} active sessions
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-4 pt-4 border-t border-border/50 flex justify-end gap-2 ml-7">
                  <button
                    onClick={() => syncCertsMutation.mutate(node.id)}
                    disabled={syncCertsMutation.isPending || node.status === 'offline'}
                    className="p-2 text-muted-foreground/70 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={node.status === 'offline' ? 'Node must be online' : 'Sync Certificates'}
                  >
                    <RefreshCw className={`h-4 w-4 ${syncCertsMutation.isPending ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => openEditModal(node)}
                    className="p-2 text-muted-foreground/70 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit Node"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openConfigModal(node.id)}
                    className="p-2 text-muted-foreground/70 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                    title="Configure"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete node "${node.hostname}"?`)) {
                        deleteMutation.mutate(node.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="p-2 text-muted-foreground/70 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete Node"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Node Modal */}
      {(showForm || registeredNode) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            {registeredNode ? (
              // Success / Agent Credentials View
              <div className="p-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 mb-4">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-center text-foreground mb-2">Node Registered!</h3>
                <p className="text-sm text-center text-muted-foreground mb-6">
                  Save these credentials now. The secret token will <strong className="text-foreground">never be shown again</strong>. Deploy your agent using these environment variables:
                </p>

                <div className="bg-muted/50 rounded-lg p-4 border border-border/50 mb-6 relative group">
                  <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap break-all">
                    <span className="text-emerald-600">AGENT_NODE_ID</span>={registeredNode.id}{'\n'}
                    <span className="text-emerald-600">AGENT_SECRET_TOKEN</span>={registeredNode.token}
                  </pre>
                  <button
                    onClick={copyCredentials}
                    className="absolute top-2 right-2 p-1.5 bg-card text-card-foreground border border-border rounded text-muted-foreground/70 hover:text-muted-foreground shadow-sm transition opacity-0 group-hover:opacity-100"
                    title="Copy to clipboard"
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>

                <Button
                  onClick={closeRegistration}
                  className="w-full bg-gray-900 hover:bg-gray-800"
                >
                  I have saved these credentials
                </Button>
              </div>
            ) : (
              // Registration Form
              <>
                <div className="flex items-center justify-between p-5 border-b border-border/50">
                  <div>
                    <h2 className="font-semibold text-foreground">Add Node</h2>
                    <p className="text-sm text-muted-foreground/70 mt-0.5">Register a new VPN node</p>
                  </div>
                  <button onClick={() => setShowForm(false)} className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <form
                  onSubmit={e => { e.preventDefault(); createMutation.mutate(form) }}
                  className="p-5 space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Hostname <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={form.hostname}
                      onChange={e => setForm({ ...form, hostname: e.target.value })}
                      placeholder="vpn-node-1"
                      required
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">IP Address <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={form.ipAddress}
                      onChange={e => setForm({ ...form, ipAddress: e.target.value })}
                      placeholder="203.0.113.1"
                      required
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Region</label>
                    <input
                      type="text"
                      value={form.region}
                      onChange={e => setForm({ ...form, region: e.target.value })}
                      placeholder="Singapore"
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
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      {createMutation.isPending ? 'Adding...' : 'Add Node'}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit Node Modal */}
      {editNode && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="font-semibold text-foreground">Edit Node</h2>
                <p className="text-sm text-muted-foreground/70 mt-0.5">Update node information</p>
              </div>
              <button onClick={() => setEditNode(null)} className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={e => { e.preventDefault(); handleUpdateNode() }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Hostname <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={editForm.hostname}
                  onChange={e => setEditForm({ ...editForm, hostname: e.target.value })}
                  placeholder="vpn-node-1"
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">IP Address <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={editForm.ipAddress}
                  onChange={e => setEditForm({ ...editForm, ipAddress: e.target.value })}
                  placeholder="203.0.113.1"
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Region</label>
                <input
                  type="text"
                  value={editForm.region}
                  onChange={e => setEditForm({ ...editForm, region: e.target.value })}
                  placeholder="Singapore"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditNode(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateNodeMutation.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  {updateNodeMutation.isPending ? 'Updating...' : 'Update Node'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Configure Node Modal */}
      {configNode && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="font-semibold text-foreground">Node Configuration</h2>
                <p className="text-sm text-muted-foreground/70 mt-0.5">Update VPN server settings</p>
              </div>
              <button onClick={() => setConfigNode(null)} className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault()
                updateConfigMutation.mutate({ nodeId: configNode, config: nodeConfig })
              }}
              className="p-5 space-y-4 max-h-[70vh] overflow-y-auto"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Port</label>
                  <input
                    type="number"
                    value={nodeConfig.port}
                    onChange={e => setNodeConfig({ ...nodeConfig, port: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Protocol</label>
                  <select
                    value={nodeConfig.protocol}
                    onChange={e => setNodeConfig({ ...nodeConfig, protocol: e.target.value as 'udp' | 'tcp' })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="udp">UDP</option>
                    <option value="tcp">TCP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Tunnel Mode</label>
                <select
                  value={nodeConfig.tunnel_mode}
                  onChange={e => setNodeConfig({ ...nodeConfig, tunnel_mode: e.target.value as 'full' | 'split' })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="full">Full Tunnel (All traffic through VPN)</option>
                  <option value="split">Split Tunnel (Only specific routes)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">VPN Network</label>
                  <input
                    type="text"
                    value={nodeConfig.vpn_network}
                    onChange={e => setNodeConfig({ ...nodeConfig, vpn_network: e.target.value })}
                    placeholder="10.8.0.0"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Netmask</label>
                  <input
                    type="text"
                    value={nodeConfig.vpn_netmask}
                    onChange={e => setNodeConfig({ ...nodeConfig, vpn_netmask: e.target.value })}
                    placeholder="255.255.255.0"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">DNS Servers</label>
                <input
                  type="text"
                  value={nodeConfig.dns_servers}
                  onChange={e => setNodeConfig({ ...nodeConfig, dns_servers: e.target.value })}
                  placeholder="8.8.8.8,1.1.1.1"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
                <p className="text-xs text-muted-foreground/70 mt-1">Comma-separated DNS server IPs (generates <code className="bg-muted px-1 rounded">push "dhcp-option DNS ...</code>)</p>
              </div>

              {/* Custom Push Directives */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-foreground">Custom Push Directives</label>
                  <span className="text-xs text-muted-foreground/70 bg-muted px-2 py-0.5 rounded">Optional</span>
                </div>
                <textarea
                  value={nodeConfig.custom_push_directives}
                  onChange={e => setNodeConfig({ ...nodeConfig, custom_push_directives: e.target.value })}
                  rows={5}
                  placeholder={`dhcp-option DNS 172.31.6.140\ndhcp-option DOMAIN corp.internal\ndhcp-option DOMAIN internal.example.com\nDNS 94.140.14.14\nroute 172.31.0.0 255.255.0.0`}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono resize-y"
                />
                <div className="mt-1.5 space-y-0.5">
                  <p className="text-xs text-muted-foreground/70">One directive per line — prepended with <code className="bg-muted px-1 rounded">push "..."</code> automatically.</p>
                  <p className="text-xs text-muted-foreground/70">These are appended <em>after</em> the DNS Servers above. Both fields can be used together.</p>
                  <p className="text-xs text-amber-600 mt-1">Example:</p>
                  <pre className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5 font-mono">{`dhcp-option DNS 172.31.6.140
dhcp-option DOMAIN corp.internal
route 172.31.0.0 255.255.0.0`}</pre>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Push Routes</label>
                <input
                  type="text"
                  value={nodeConfig.push_routes}
                  onChange={e => setNodeConfig({ ...nodeConfig, push_routes: e.target.value })}
                  placeholder="192.168.1.0/24,10.0.0.0/8"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
                <p className="text-xs text-muted-foreground/70 mt-1">Comma-separated routes (for split tunnel)</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Cipher</label>
                  <select
                    value={nodeConfig.cipher}
                    onChange={e => setNodeConfig({ ...nodeConfig, cipher: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="AES-256-GCM">AES-256-GCM</option>
                    <option value="AES-128-GCM">AES-128-GCM</option>
                    <option value="AES-256-CBC">AES-256-CBC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Auth Digest</label>
                  <select
                    value={nodeConfig.auth_digest}
                    onChange={e => setNodeConfig({ ...nodeConfig, auth_digest: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="SHA256">SHA256</option>
                    <option value="SHA384">SHA384</option>
                    <option value="SHA512">SHA512</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Compression</label>
                <select
                  value={nodeConfig.compression}
                  onChange={e => setNodeConfig({ ...nodeConfig, compression: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="lz4-v2">LZ4-v2 (Recommended)</option>
                  <option value="lz4">LZ4</option>
                  <option value="lzo">LZO</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Keepalive Ping</label>
                  <input
                    type="number"
                    value={nodeConfig.keepalive_ping}
                    onChange={e => setNodeConfig({ ...nodeConfig, keepalive_ping: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-xs text-muted-foreground/70 mt-1">seconds</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Keepalive Timeout</label>
                  <input
                    type="number"
                    value={nodeConfig.keepalive_timeout}
                    onChange={e => setNodeConfig({ ...nodeConfig, keepalive_timeout: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-xs text-muted-foreground/70 mt-1">seconds</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Max Clients</label>
                  <input
                    type="number"
                    value={nodeConfig.max_clients}
                    onChange={e => setNodeConfig({ ...nodeConfig, max_clients: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfigNode(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateConfigMutation.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  {updateConfigMutation.isPending ? 'Updating...' : 'Update Configuration'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
