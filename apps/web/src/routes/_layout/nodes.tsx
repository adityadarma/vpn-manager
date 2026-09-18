import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  MapPin,
  Server,
  X,
  Copy,
  Check,
  CheckCircle2,
  Settings,
  RefreshCw,
  Edit,
  Shield,
  Archive,
  RotateCcw,
  Search,
  Users,
  Radio,
  AlertTriangle,
  MoreHorizontal,
  Terminal,
} from 'lucide-react'
import { APP_VERSION, formatBrowserDateTime, type VpnNode } from '@vpn/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'

export const Route = createFileRoute('/_layout/nodes')({
  component: NodesPage,
})

interface NodeForm {
  hostname: string
  ipAddress: string
  region: string
  managedDnsEnabled?: boolean
}

interface NodeConfig {
  port: number
  protocol: 'udp' | 'tcp'
  tunnel_mode: 'full' | 'split'
  vpn_network: string
  vpn_netmask: string
  dns_servers: string
  push_routes: string
  wireguard_allowed_ips?: string
  cipher: string
  auth_digest: string
  compression: string
  keepalive_ping: number
  keepalive_timeout: number
  max_clients: number
  custom_push_directives: string
  network_push_directives?: string
  managed_dns_directives?: string
  firewall_engine: string
  allow_client_to_client: boolean
}

interface RegisterResponse extends VpnNode {
  token?: string
}

type StatusFilter = 'all' | 'active' | 'online' | 'offline' | 'decommissioned'
type EngineFilter = 'all' | 'wireguard' | 'openvpn'

// eslint-disable-next-line react-refresh/only-export-components
function NodesPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()

  // Filter States
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal Dialog States
  const [showAddModal, setShowAddModal] = useState(false)
  const [registeredNode, setRegisteredNode] = useState<{ id: string; token: string } | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedIpId, setCopiedIpId] = useState<string | null>(null)

  const [form, setForm] = useState<NodeForm>({ hostname: '', ipAddress: '', region: '' })
  const [editNode, setEditNode] = useState<VpnNode | null>(null)
  const [editForm, setEditForm] = useState<NodeForm>({
    hostname: '',
    ipAddress: '',
    region: '',
    managedDnsEnabled: false,
  })

  const [configNode, setConfigNode] = useState<VpnNode | null>(null)
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
    firewall_engine: 'iptables',
    allow_client_to_client: false,
  })

  const [viewFirewallNode, setViewFirewallNode] = useState<VpnNode | null>(null)
  const [copiedFirewall, setCopiedFirewall] = useState(false)

  const confirmDecommissionNode = async (node: VpnNode) => {
    const ok = await confirm({
      title: 'Decommission VPN Node?',
      subtitle: 'Revoke agent and client access while preserving history',
      icon: <Archive />,
      tone: 'warning',
      target: { label: 'Target VPN Node', value: node.hostname },
      description:
        'Its agent secret token and active VPN client credentials will be immediately revoked. Its configuration and history will be preserved and can be restored later.',
      confirmLabel: 'Yes, Decommission Node',
    })
    if (ok) decommissionMutation.mutate(node.id)
  }

  const confirmDeleteNode = async (node: VpnNode) => {
    const ok = await confirm({
      title: 'Delete Node Permanently?',
      subtitle: 'Remove this archived node and all of its historical records',
      icon: <Trash2 />,
      target: { label: 'Target Archived Node', value: node.hostname },
      description: `Permanently delete archived node "${node.hostname}" and all its associated historical records?`,
      warning: 'This action is irreversible.',
      confirmLabel: 'Delete Permanently',
    })
    if (ok) deleteMutation.mutate(node.id)
  }

  // Fetch Nodes
  const { data: nodes = [], isLoading, isFetching } = useQuery<VpnNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: NodeForm) =>
      api.post<RegisterResponse>('/api/v1/nodes/register', {
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
        setShowAddModal(false)
        setForm({ hostname: '', ipAddress: '', region: '' })
      }
      toast.success('Node registered successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateNodeMutation = useMutation({
    mutationFn: (data: { nodeId: string; updates: Partial<NodeForm> }) =>
      api.put(`/api/v1/nodes/${data.nodeId}`, {
        hostname: data.updates.hostname,
        ip_address: data.updates.ipAddress,
        region: data.updates.region || null,
        managed_dns_enabled: data.updates.managedDnsEnabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      setEditNode(null)
      toast.success('Node updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const decommissionMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/nodes/${id}/decommission`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('Node decommissioned and access revoked')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post<RegisterResponse>(`/api/v1/nodes/${id}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      if (data.id && data.token) {
        setRegisteredNode({ id: data.id, token: data.token })
      }
      toast.success('Node restored. Please apply the newly issued agent token.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/nodes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('Node permanently deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

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
      api.post('/api/v1/tasks', {
        node_id: nodeId,
        action: 'sync_certificates',
        payload: {},
      }),
    onSuccess: () => {
      toast.success('Certificate sync task queued. Check Task Queue for progress.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Helpers
  const openConfigModal = async (node: VpnNode) => {
    try {
      const config = await api.get<NodeConfig>(`/api/v1/nodes/${node.id}/config`)
      setNodeConfig(config)
      setConfigNode(node)
    } catch (error: unknown) {
      const err = error as Error
      toast.error(err.message || 'Failed to load configuration')
    }
  }

  const openEditModal = (node: VpnNode) => {
    setEditNode(node)
    setEditForm({
      hostname: node.hostname,
      ipAddress: node.ip_address,
      region: node.region || '',
      managedDnsEnabled: Boolean((node as { managed_dns_enabled?: boolean }).managed_dns_enabled),
    })
  }

  const handleCopyToken = () => {
    if (!registeredNode) return
    const text = `AGENT_NODE_ID=${registeredNode.id}\nAGENT_SECRET_TOKEN=${registeredNode.token}\nFIREWALL_ENGINE=iptables`
    navigator.clipboard.writeText(text)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
    toast.success('Credentials copied to clipboard')
  }

  const handleCopyIp = (ip: string, id: string) => {
    navigator.clipboard.writeText(ip)
    setCopiedIpId(id)
    setTimeout(() => setCopiedIpId(null), 1800)
    toast.success(`Copied IP: ${ip}`)
  }

  const handleCopyFirewallDump = (dump: string) => {
    navigator.clipboard.writeText(dump)
    setCopiedFirewall(true)
    setTimeout(() => setCopiedFirewall(false), 2000)
    toast.success('Firewall rules copied')
  }

  const handleCloseRegistration = () => {
    setRegisteredNode(null)
    setShowAddModal(false)
    setForm({ hostname: '', ipAddress: '', region: '' })
  }

  // Summary KPI Counts
  const onlineCount = nodes.filter((n) => n.status === 'online').length
  const offlineCount = nodes.filter((n) => n.status === 'offline').length
  const decomCount = nodes.filter((n) => n.status === 'decommissioned').length
  const activeCount = nodes.filter((n) => n.status !== 'decommissioned').length
  const totalTunnels = nodes.reduce((acc, n) => acc + (n.active_sessions ?? 0), 0)
  const wgCount = nodes.filter((n) => n.vpn_type === 'wireguard').length
  const ovpnCount = nodes.filter((n) => n.vpn_type === 'openvpn').length

  // Filtered Nodes
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      // 1. Status Filter
      if (statusFilter === 'active' && node.status === 'decommissioned') return false
      if (statusFilter === 'online' && node.status !== 'online') return false
      if (statusFilter === 'offline' && node.status !== 'offline') return false
      if (statusFilter === 'decommissioned' && node.status !== 'decommissioned') return false

      // 2. Engine Filter
      if (engineFilter !== 'all' && node.vpn_type !== engineFilter) return false

      // 3. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchHost = node.hostname?.toLowerCase().includes(q)
        const matchIp = node.ip_address?.toLowerCase().includes(q)
        const matchRegion = node.region?.toLowerCase().includes(q)
        const matchType = node.vpn_type?.toLowerCase().includes(q)
        if (!matchHost && !matchIp && !matchRegion && !matchType) return false
      }

      return true
    })
  }, [nodes, statusFilter, engineFilter, searchQuery])

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">VPN Nodes</h1>
            <Badge
              variant="outline"
              className="gap-1.5 px-2.5 py-0.5 text-xs font-semibold border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
              <Radio className="size-3 animate-pulse" />
              {onlineCount} of {nodes.length} Online
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Manage VPN gateways, server firewall policies, and cryptographic daemon configurations
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['nodes'] })}
            disabled={isFetching}
            className="h-9 gap-1.5 border-border/80 bg-card hover:bg-muted text-xs cursor-pointer shadow-xs"
          >
            <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin text-emerald-500' : ''}`} />
            Refresh
          </Button>

          <Button
            id="btn-add-node"
            size="sm"
            onClick={() => setShowAddModal(true)}
            className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs cursor-pointer shadow-xs"
          >
            <Plus className="size-4" />
            Add Node
          </Button>
        </div>
      </div>

      {/* Overview KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Nodes */}
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`text-left rounded-xl border p-4 shadow-xs transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/30'
              : 'border-border bg-card hover:border-border/80'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Gateways</span>
            <div className="size-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center">
              <Server className="size-4" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground mt-2">{nodes.length}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {activeCount} active &bull; {decomCount} archived
          </p>
        </button>

        {/* Card 2: Online Nodes */}
        <button
          type="button"
          onClick={() => setStatusFilter('online')}
          className={`text-left rounded-xl border p-4 shadow-xs transition-all cursor-pointer ${
            statusFilter === 'online'
              ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30'
              : 'border-border bg-card hover:border-border/80'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Online Nodes</span>
            <div className="size-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <Radio className="size-4 animate-pulse" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-2">
            {onlineCount}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Ready for incoming tunnels</p>
        </button>

        {/* Card 3: Active Tunnels */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active Tunnels</span>
            <div className="size-8 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 flex items-center justify-center">
              <Users className="size-4" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground mt-2">{totalTunnels}</p>
          <p className="text-xs text-muted-foreground mt-1">Connected clients across all nodes</p>
        </div>

        {/* Card 4: Decommissioned / Offline */}
        <button
          type="button"
          onClick={() => setStatusFilter(offlineCount > 0 ? 'offline' : 'decommissioned')}
          className={`text-left rounded-xl border p-4 shadow-xs transition-all cursor-pointer ${
            statusFilter === 'offline' || statusFilter === 'decommissioned'
              ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30'
              : 'border-border bg-card hover:border-border/80'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Offline / Archived</span>
            <div className="size-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="size-4" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground mt-2">
            {offlineCount + decomCount}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {offlineCount} offline &bull; {decomCount} decommissioned
          </p>
        </button>
      </div>

      {/* Interactive Toolbar: Search, Filter Pills & View Mode */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-1">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search hostname, IP, region, or engine..."
            className="pl-9 pr-8 h-9 text-xs bg-background border-border/80"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filter Controls & Layout Toggle */}
        <div className="flex items-center gap-2 flex-wrap justify-between md:justify-end">
          {/* Status Filter Pills */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/60 text-xs">
            {(
              [
                { id: 'active', label: 'Active', count: activeCount },
                { id: 'all', label: 'All', count: nodes.length },
                { id: 'online', label: 'Online', count: onlineCount },
                { id: 'offline', label: 'Offline', count: offlineCount },
                { id: 'decommissioned', label: 'Archived', count: decomCount },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-medium ${
                  statusFilter === item.id
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label} <span className="opacity-60 text-[10px] ml-0.5">({item.count})</span>
              </button>
            ))}
          </div>

          {/* Engine Filter Pills */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/60 text-xs">
            {(
              [
                { id: 'all', label: 'All Engines' },
                { id: 'wireguard', label: `WG (${wgCount})` },
                { id: 'openvpn', label: `OVPN (${ovpnCount})` },
              ] as const
            ).map((engine) => (
              <button
                key={engine.id}
                type="button"
                onClick={() => setEngineFilter(engine.id)}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer font-medium ${
                  engineFilter === engine.id
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {engine.label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs divide-y divide-border/60">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="h-4 w-6 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-20 shrink-0" />
              <Skeleton className="h-4 w-14 shrink-0" />
              <Skeleton className="h-4 w-8 shrink-0" />
              <Skeleton className="h-4 w-32 shrink-0" />
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
              <Skeleton className="h-7 w-14 shrink-0" />
            </div>
          ))}
        </div>
      ) : filteredNodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Server className="size-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="font-semibold text-foreground text-base">No matching nodes found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {searchQuery || statusFilter !== 'all' || engineFilter !== 'all'
              ? 'Try resetting the active search query or status filter to see other nodes.'
              : 'No VPN nodes registered yet. Click "Add Node" to deploy your first VPN gateway.'}
          </p>
          {(searchQuery || statusFilter !== 'active' || engineFilter !== 'all') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('')
                setStatusFilter('active')
                setEngineFilter('all')
              }}
              className="mt-4 text-xs"
            >
              Reset Filters
            </Button>
          )}
        </div>
      ) : (
        /* --- DENSE DIRECTORY TABLE --- */
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-12 text-center text-xs">#</TableHead>
                <TableHead className="text-xs">Hostname & IP</TableHead>
                <TableHead className="text-xs">Engine</TableHead>
                <TableHead className="text-xs">Region</TableHead>
                <TableHead className="text-xs">Agent Version</TableHead>
                <TableHead className="text-xs text-center">Tunnels</TableHead>
                <TableHead className="text-xs">Last Seen</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
                {filteredNodes.map((node, index) => {
                const isOnline = node.status === 'online'
                const isDecom = node.status === 'decommissioned'
                const hasDnsSync = Boolean(
                  (node as { managed_dns_enabled?: boolean }).managed_dns_enabled
                )

                return (
                  <TableRow key={node.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">
                      {index + 1}
                    </TableCell>

                    <TableCell>
                      <div>
                        <p className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                          {node.hostname}
                          {hasDnsSync && (
                            <span
                              className="inline-flex shrink-0"
                              title="Managed DNS active / synchronized"
                            >
                              <Shield
                                className="size-3 text-emerald-600 dark:text-emerald-400"
                                aria-label="Managed DNS active / synchronized"
                                role="img"
                              />
                            </span>
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleCopyIp(node.ip_address, node.id)}
                          className="font-mono text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
                        >
                          {node.ip_address}
                          {copiedIpId === node.id ? (
                            <Check className="size-2.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-2.5" />
                          )}
                        </button>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 ${
                          node.vpn_type === 'wireguard'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                            : 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
                        }`}
                      >
                        {node.vpn_type === 'wireguard' ? 'WireGuard' : 'OpenVPN'}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {node.region ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3 text-muted-foreground/60" /> {node.region}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>

                    <TableCell className="text-xs font-mono">
                      {node.version ? (
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            node.version === APP_VERSION
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          }`}
                          title={
                            node.version === APP_VERSION
                              ? 'Agent matches manager version'
                              : `Manager is on v${APP_VERSION}`
                          }
                        >
                          v{node.version}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50">
                        <Users className="size-3 text-muted-foreground" />
                        {node.active_sessions ?? 0}
                      </span>
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {node.last_seen ? formatBrowserDateTime(node.last_seen) : '—'}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`capitalize text-xs font-medium ${
                          isOnline
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : isDecom
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                            : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full mr-1.5 ${
                            isOnline ? 'bg-emerald-500 animate-pulse' : isDecom ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                        />
                        {node.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {!isDecom && (
                              <DropdownMenuItem
                                onClick={() => openConfigModal(node)}
                                className="gap-2 cursor-pointer"
                              >
                                <Settings className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                Configuration
                              </DropdownMenuItem>
                            )}

                            {!isDecom && (
                              <DropdownMenuItem
                                onClick={() => syncCertsMutation.mutate(node.id)}
                                disabled={syncCertsMutation.isPending || !isOnline}
                                className="gap-2 cursor-pointer"
                                title={isOnline ? undefined : 'Node must be online'}
                              >
                                <RefreshCw
                                  className={`size-3.5 ${syncCertsMutation.isPending ? 'animate-spin' : ''}`}
                                />
                                Sync Certificates
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuItem onClick={() => openEditModal(node)} className="gap-2 cursor-pointer">
                              <Edit className="size-3.5" />
                              Edit Node
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onClick={() => setViewFirewallNode(node)}
                              className="gap-2 cursor-pointer"
                            >
                              <Terminal className="size-3.5 text-indigo-500" />
                              Firewall Rules
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            {isDecom ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => restoreMutation.mutate(node.id)}
                                  className="gap-2 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                                >
                                  <RotateCcw className="size-3.5" />
                                  Restore Node
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={() => confirmDeleteNode(node)}
                                  className="gap-2 text-red-600 dark:text-red-400 cursor-pointer"
                                >
                                  <Trash2 className="size-3.5" />
                                  Delete Permanently
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => confirmDecommissionNode(node)}
                                className="gap-2 text-amber-600 dark:text-amber-400 cursor-pointer"
                              >
                                <Archive className="size-3.5" />
                                Decommission
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* --- MODAL 1: ADD NODE / REGISTRATION SUCCESS --- */}
      {(showAddModal || registeredNode) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            {registeredNode ? (
              /* Success View */
              <div className="p-6">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mb-4">
                  <CheckCircle2 className="size-6" />
                </div>
                <h3 className="text-lg font-bold text-center text-foreground mb-1">
                  Node Registered Successfully!
                </h3>
                <p className="text-xs text-center text-muted-foreground mb-5">
                  Save these credentials immediately. The secret token will{' '}
                  <strong className="text-foreground">never be shown again</strong>. Deploy your agent using these
                  environment variables:
                </p>

                <div className="bg-muted/50 rounded-lg p-3.5 border border-border/60 mb-5 relative group">
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all leading-relaxed">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">AGENT_NODE_ID</span>=
                    {registeredNode.id}
                    {'\n'}
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      AGENT_SECRET_TOKEN
                    </span>=
                    {registeredNode.token}
                    {'\n'}
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      FIREWALL_ENGINE
                    </span>=iptables
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className="absolute top-2 right-2 p-1.5 bg-background border border-border rounded text-muted-foreground hover:text-foreground shadow-xs transition-opacity opacity-80 group-hover:opacity-100 cursor-pointer"
                    title="Copy environment variables"
                  >
                    {copiedToken ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>

                <Button onClick={handleCloseRegistration} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                  I have safely stored these credentials
                </Button>
              </div>
            ) : (
              /* Registration Form View */
              <>
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div>
                    <h2 className="font-bold text-foreground text-base">Add New Node</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Register a new VPN gateway and generate credentials
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="p-1 text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    createMutation.mutate(form)
                  }}
                  className="p-5 space-y-4 overflow-y-auto flex-1"
                >
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      Hostname <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={form.hostname}
                      onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                      placeholder="e.g. sg-node-1"
                      required
                      className="h-9 text-xs bg-background border-border"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      Public IP Address <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={form.ipAddress}
                      onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                      placeholder="e.g. 203.0.113.10"
                      required
                      className="h-9 text-xs font-mono bg-background border-border"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Region / Location</label>
                    <Input
                      type="text"
                      value={form.region}
                      onChange={(e) => setForm({ ...form, region: e.target.value })}
                      placeholder="e.g. Singapore (AWS ap-southeast-1)"
                      className="h-9 text-xs bg-background border-border"
                    />
                  </div>

                  <div className="flex gap-3 pt-3 border-t border-border/50">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAddModal(false)}
                      className="flex-1 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                    >
                      {createMutation.isPending ? 'Registering...' : 'Register Node'}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* --- MODAL 2: EDIT NODE MODAL --- */}
      {editNode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="font-bold text-foreground text-base">Edit Node Details</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Update metadata and DNS status for {editNode.hostname}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditNode(null)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!editNode) return
                updateNodeMutation.mutate({
                  nodeId: editNode.id,
                  updates: editForm,
                })
              }}
              className="p-5 space-y-4 overflow-y-auto flex-1"
            >
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Hostname <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={editForm.hostname}
                  onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })}
                  required
                  className="h-9 text-xs bg-background border-border"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Public IP Address <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={editForm.ipAddress}
                  onChange={(e) => setEditForm({ ...editForm, ipAddress: e.target.value })}
                  required
                  className="h-9 text-xs font-mono bg-background border-border"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Region</label>
                <Input
                  type="text"
                  value={editForm.region}
                  onChange={(e) => setEditForm({ ...editForm, region: e.target.value })}
                  placeholder="e.g. Frankfurt, Germany"
                  className="h-9 text-xs bg-background border-border"
                />
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <input
                  type="checkbox"
                  checked={Boolean(editForm.managedDnsEnabled)}
                  onChange={(e) =>
                    setEditForm({ ...editForm, managedDnsEnabled: e.target.checked })
                  }
                  className="mt-0.5"
                />
                <div>
                  <span className="block text-xs font-semibold text-foreground">Enable Managed DNS</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Allows this node to receive CoreDNS zone tasks. Uncheck to disable local DNS
                    enforcement for this node.
                  </span>
                </div>
              </label>

              <div className="flex gap-3 pt-3 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditNode(null)}
                  className="flex-1 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateNodeMutation.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                >
                  {updateNodeMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 3: CONFIGURE NODE MODAL --- */}
      {configNode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="font-bold text-foreground text-base">VPN Configuration</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daemon network routing and cryptographic parameters for {configNode.hostname}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfigNode(null)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                updateConfigMutation.mutate({ nodeId: configNode.id, config: nodeConfig })
              }}
              className="p-5 space-y-4 overflow-y-auto flex-1 text-xs"
            >
              {/* General Port & Protocol */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">Listening Port</label>
                  <Input
                    type="number"
                    value={nodeConfig.port}
                    onChange={(e) =>
                      setNodeConfig({ ...nodeConfig, port: parseInt(e.target.value) || 1194 })
                    }
                    className="h-9 text-xs font-mono bg-background border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">Transport Protocol</label>
                  {configNode.vpn_type === 'openvpn' ? (
                    <select
                      value={nodeConfig.protocol}
                      onChange={(e) =>
                        setNodeConfig({ ...nodeConfig, protocol: e.target.value as 'udp' | 'tcp' })
                      }
                      className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="udp">UDP (Recommended)</option>
                      <option value="tcp">TCP</option>
                    </select>
                  ) : (
                    <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                      UDP (WireGuard Standard)
                    </div>
                  )}
                </div>
              </div>

              {/* Tunnel Mode */}
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Routing Mode</label>
                <select
                  value={nodeConfig.tunnel_mode}
                  onChange={(e) =>
                    setNodeConfig({
                      ...nodeConfig,
                      tunnel_mode: e.target.value as 'full' | 'split',
                    })
                  }
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="full">Full Tunnel (All Internet traffic routed through VPN)</option>
                  <option value="split">Split Tunnel (Only designated network CIDRs routed)</option>
                </select>
              </div>

              {/* WireGuard Allowed IPs */}
              {configNode.vpn_type === 'wireguard' && nodeConfig.tunnel_mode === 'split' && (
                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">WireGuard Allowed IPs</label>
                  <Input
                    type="text"
                    value={nodeConfig.wireguard_allowed_ips ?? ''}
                    onChange={(e) =>
                      setNodeConfig({ ...nodeConfig, wireguard_allowed_ips: e.target.value })
                    }
                    placeholder="10.0.0.0/8, 172.16.0.0/12"
                    className="h-9 text-xs font-mono bg-background border-border"
                  />
                </div>
              )}

              {/* Client to Client */}
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <input
                  type="checkbox"
                  checked={nodeConfig.allow_client_to_client}
                  onChange={(e) =>
                    setNodeConfig({ ...nodeConfig, allow_client_to_client: e.target.checked })
                  }
                  className="mt-0.5"
                />
                <div>
                  <span className="block font-semibold text-foreground">Allow Client-to-Client Traffic</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Disabled by default. When disabled, clients on this node cannot communicate directly
                    with each other, isolating endpoint workstations.
                  </span>
                </div>
              </label>

              {/* Firewall Engine */}
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Firewall Management Engine</label>
                <select
                  value={nodeConfig.firewall_engine}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, firewall_engine: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="iptables">iptables (Standard Linux)</option>
                  <option value="nftables">nftables (Modern Linux / Debian 12+)</option>
                  <option value="ufw">UFW (Ubuntu)</option>
                  <option value="firewalld">Firewalld (RHEL / CentOS / Alma)</option>
                  <option value="none">None (Manage manually)</option>
                </select>
              </div>

              {/* VPN Subnet & Netmask */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">VPN Network Subnet</label>
                  <Input
                    type="text"
                    value={nodeConfig.vpn_network}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, vpn_network: e.target.value })}
                    placeholder="10.8.0.0"
                    className="h-9 text-xs font-mono bg-background border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">Netmask</label>
                  <Input
                    type="text"
                    value={nodeConfig.vpn_netmask}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, vpn_netmask: e.target.value })}
                    placeholder="255.255.255.0"
                    className="h-9 text-xs font-mono bg-background border-border"
                  />
                </div>
              </div>

              {/* Managed automatically — read-only, derived from other pages */}
              {nodeConfig.network_push_directives && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-medium text-foreground">Network Routes</label>
                    <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                      Managed automatically
                    </span>
                  </div>
                  <textarea
                    value={nodeConfig.network_push_directives}
                    readOnly
                    rows={Math.min(6, Math.max(2, nodeConfig.network_push_directives.split('\n').length))}
                    className="w-full p-2.5 rounded-md border border-border bg-muted text-muted-foreground font-mono text-xs resize-y"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Routes from networks assigned to this node. Change these on the Networks page.
                  </p>
                </div>
              )}

              {nodeConfig.managed_dns_directives && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-medium text-foreground">Managed DNS Listeners</label>
                    <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                      Managed automatically
                    </span>
                  </div>
                  <textarea
                    value={nodeConfig.managed_dns_directives}
                    readOnly
                    rows={Math.min(6, Math.max(2, nodeConfig.managed_dns_directives.split('\n').length))}
                    className="w-full p-2.5 rounded-md border border-border bg-muted text-muted-foreground font-mono text-xs resize-y"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Applied per group during profile generation, never pushed globally. Configure these on
                    the Managed DNS page.
                  </p>
                </div>
              )}

              {/* OpenVPN Specific Settings */}
              {configNode.vpn_type === 'openvpn' && (
                <>
                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground">DNS Servers</label>
                    <Input
                      type="text"
                      value={nodeConfig.dns_servers}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, dns_servers: e.target.value })}
                      placeholder="8.8.8.8, 1.1.1.1"
                      className="h-9 text-xs font-mono bg-background border-border"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground">Push Routes (Split Tunnel)</label>
                    <Input
                      type="text"
                      value={nodeConfig.push_routes}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, push_routes: e.target.value })}
                      placeholder="192.168.1.0/24, 10.0.0.0/8"
                      className="h-9 text-xs font-mono bg-background border-border"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground">Custom Push Directives (Advanced)</label>
                    <textarea
                      value={nodeConfig.custom_push_directives}
                      onChange={(e) =>
                        setNodeConfig({ ...nodeConfig, custom_push_directives: e.target.value })
                      }
                      rows={3}
                      placeholder={`dhcp-option DOMAIN corp.internal\nroute 172.31.0.0 255.255.0.0`}
                      className="w-full p-2.5 rounded-md border border-border bg-background font-mono text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  {/* Cryptography */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="font-medium text-foreground">Cipher Suite</label>
                      <select
                        value={nodeConfig.cipher}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, cipher: e.target.value })}
                        className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs"
                      >
                        <option value="AES-256-GCM">AES-256-GCM (Recommended)</option>
                        <option value="AES-128-GCM">AES-128-GCM</option>
                        <option value="AES-256-CBC">AES-256-CBC</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-medium text-foreground">Auth Digest</label>
                      <select
                        value={nodeConfig.auth_digest}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, auth_digest: e.target.value })}
                        className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs"
                      >
                        <option value="SHA256">SHA256</option>
                        <option value="SHA384">SHA384</option>
                        <option value="SHA512">SHA512</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="font-medium text-foreground">Compression</label>
                      <select
                        value={nodeConfig.compression}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, compression: e.target.value })}
                        className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs"
                      >
                        <option value="lz4-v2">LZ4-v2 (Recommended)</option>
                        <option value="lz4">LZ4</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-medium text-foreground">Keepalive Ping (s)</label>
                      <Input
                        type="number"
                        value={nodeConfig.keepalive_ping}
                        onChange={(e) =>
                          setNodeConfig({ ...nodeConfig, keepalive_ping: parseInt(e.target.value) || 10 })
                        }
                        className="h-9 text-xs bg-background border-border font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-medium text-foreground">Keepalive Timeout (s)</label>
                      <Input
                        type="number"
                        value={nodeConfig.keepalive_timeout}
                        onChange={(e) =>
                          setNodeConfig({
                            ...nodeConfig,
                            keepalive_timeout: parseInt(e.target.value) || 120,
                          })
                        }
                        className="h-9 text-xs bg-background border-border font-mono"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-3 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfigNode(null)}
                  className="flex-1 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateConfigMutation.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                >
                  {updateConfigMutation.isPending ? 'Saving...' : 'Apply Configuration'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 4: FIREWALL RULES TERMINAL MODAL --- */}
      {viewFirewallNode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between bg-muted/20">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Terminal className="size-4 text-indigo-500" />
                  Active Server Firewall Rules
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Synchronized iptables/nftables state on {viewFirewallNode.hostname} ({viewFirewallNode.ip_address})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewFirewallNode(null)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-4 bg-zinc-950 flex-1 overflow-y-auto">
              {!viewFirewallNode.firewall_rules_dump ? (
                <div className="text-center py-16">
                  <Shield className="size-12 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-300 font-semibold text-sm">No firewall rules reported yet</p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
                    The agent node has not yet synchronized its local firewall dump. It will be reported
                    automatically on the next periodic heartbeat.
                  </p>
                </div>
              ) : (
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() => handleCopyFirewallDump(viewFirewallNode.firewall_rules_dump!)}
                    className="absolute top-2 right-2 p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 cursor-pointer transition shadow-xs"
                  >
                    {copiedFirewall ? (
                      <>
                        <Check className="size-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" /> Copy
                      </>
                    )}
                  </button>
                  <pre className="text-xs font-mono text-zinc-300 leading-relaxed overflow-x-auto p-4 rounded-lg bg-zinc-900 border border-zinc-800 whitespace-pre-wrap">
                    {viewFirewallNode.firewall_rules_dump}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border flex justify-end bg-card">
              <Button variant="outline" size="sm" onClick={() => setViewFirewallNode(null)} className="text-xs">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
