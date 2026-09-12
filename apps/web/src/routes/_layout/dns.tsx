import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Globe,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { formatBrowserDateTime } from '@vpn/shared'

export const Route = createFileRoute('/_layout/dns')({ component: ManagedDnsPage })

type Node = {
  id: string
  hostname: string
  managed_dns_enabled: boolean
  dns_sync_status: 'disabled' | 'pending' | 'syncing' | 'healthy' | 'degraded' | 'failed'
  dns_config_revision: number
  dns_last_sync_error: string | null
  dns_last_synced_at: string | null
}
type Zone = { id: string; name: string; description: string | null; enabled: boolean; record_count: number }
type Record = { id: string; name: string; type: string; value: string; ttl: number }
type Group = { id: string; name: string; vpn_subnet?: string | null }
type Policy = { id: string; domain_pattern: string; action: string; scope: string; priority: number; sinkhole_ipv4?: string | null }
type Allocation = {
  group_id: string
  node_id: string
  enabled: boolean | number
  vpn_subnet: string
  listener_ip: string | null
  listener_port: number
  public_default_action: string
  upstreams: string
}

function ManagedDnsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: nodes = [], isLoading } = useQuery<Node[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
    refetchInterval: 10_000,
  })

  const sync = useMutation({
    mutationFn: (nodeId: string) => api.post<{ task_id: string }>(`/api/v1/nodes/${nodeId}/dns/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('DNS sync queued')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const managed = nodes.filter((node) => node.managed_dns_enabled)
  const healthy = managed.filter((node) => node.dns_sync_status === 'healthy').length

  // Zones & Records state
  const [zoneName, setZoneName] = useState('')
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [record, setRecord] = useState({ name: '', type: 'A', value: '', ttl: '60' })

  // Domain Policies state
  const [policyGroup, setPolicyGroup] = useState('')
  const [policy, setPolicy] = useState({
    domain_pattern: '',
    action: 'block',
    scope: 'public',
    priority: '0',
    sinkhole_ipv4: '',
  })

  // Queries
  const { data: zones = [] } = useQuery<Zone[]>({
    queryKey: ['dns-zones'],
    queryFn: () => api.get('/api/v1/dns/zones'),
  })
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/api/v1/groups'),
  })
  const { data: records = [] } = useQuery<Record[]>({
    queryKey: ['dns-records', selectedZone],
    enabled: !!selectedZone,
    queryFn: () => api.get(`/api/v1/dns/zones/${selectedZone}/records`),
  })
  const { data: policies = [] } = useQuery<Policy[]>({
    queryKey: ['dns-policies', policyGroup],
    enabled: !!policyGroup,
    queryFn: () => api.get(`/api/v1/groups/${policyGroup}/dns/policies`),
  })

  const refreshDns = () => {
    queryClient.invalidateQueries({ queryKey: ['dns-zones'] })
    queryClient.invalidateQueries({ queryKey: ['dns-records'] })
    queryClient.invalidateQueries({ queryKey: ['dns-policies'] })
  }

  const createZone = useMutation({
    mutationFn: () => api.post<Zone>('/api/v1/dns/zones', { name: zoneName }),
    onSuccess: (zone) => {
      setZoneName('')
      setSelectedZone(zone.id)
      refreshDns()
      toast.success('Zone created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteZone = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/dns/zones/${id}`),
    onSuccess: () => {
      setSelectedZone(null)
      refreshDns()
      toast.success('Zone deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createRecord = useMutation({
    mutationFn: () => api.post(`/api/v1/dns/zones/${selectedZone}/records`, { ...record, ttl: Number(record.ttl) || 60 }),
    onSuccess: () => {
      setRecord({ name: '', type: 'A', value: '', ttl: '60' })
      refreshDns()
      toast.success('Record created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRecord = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/dns/records/${id}`),
    onSuccess: () => {
      refreshDns()
      toast.success('Record deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createPolicy = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/groups/${policyGroup}/dns/policies`, {
        ...policy,
        priority: Number(policy.priority) || 0,
        sinkhole_ipv4: policy.action === 'sinkhole' ? policy.sinkhole_ipv4 : null,
      }),
    onSuccess: () => {
      setPolicy({ domain_pattern: '', action: 'block', scope: 'public', priority: '0', sinkhole_ipv4: '' })
      refreshDns()
      toast.success('Policy created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deletePolicy = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/dns/policies/${id}`),
    onSuccess: () => {
      refreshDns()
      toast.success('Policy deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Group-node allocation state
  const [selectedGroup, setSelectedGroup] = useState('')
  const [allocNode, setAllocNode] = useState('')
  const [alloc, setAlloc] = useState({
    enabled: true,
    vpn_subnet: '',
    listener_ip: '',
    listener_port: '53',
    public_default_action: 'allow',
    upstreams: '1.1.1.1, 8.8.8.8',
  })

  const allocKey = ['group-node-dns', selectedGroup, allocNode]
  const { data: existingAlloc } = useQuery<Allocation | null>({
    queryKey: allocKey,
    enabled: !!selectedGroup && !!allocNode,
    retry: false,
    queryFn: () => api.get<Allocation>(`/api/v1/groups/${selectedGroup}/nodes/${allocNode}/dns`).catch(() => null),
  })

  const saveAlloc = useMutation({
    mutationFn: () =>
      api.put(`/api/v1/groups/${selectedGroup}/nodes/${allocNode}/dns`, {
        enabled: alloc.enabled,
        vpn_subnet: alloc.vpn_subnet.trim(),
        listener_ip: alloc.listener_ip.trim() || null,
        listener_port: Number(alloc.listener_port),
        public_default_action: alloc.public_default_action,
        upstreams: alloc.upstreams.split(',').map((value) => value.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: allocKey })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('Allocation saved and DNS sync queued')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { data: assignedZones = [] } = useQuery<Zone[]>({
    queryKey: ['group-dns-zones', selectedGroup],
    enabled: !!selectedGroup,
    queryFn: () => api.get(`/api/v1/groups/${selectedGroup}/dns/zones`),
  })

  const assignZones = useMutation({
    mutationFn: (zoneIds: string[]) => api.put(`/api/v1/groups/${selectedGroup}/dns/zones`, { zone_ids: zoneIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-dns-zones', selectedGroup] })
      toast.success('Zone assignment updated')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const assignedZoneIds = new Set(assignedZones.map((zone) => zone.id))
  const toggleZone = (zoneId: string) => {
    const next = new Set(assignedZoneIds)
    if (next.has(zoneId)) next.delete(zoneId)
    else next.add(zoneId)
    assignZones.mutate([...next])
  }

  useEffect(() => {
    if (!existingAlloc) {
      setAlloc({
        enabled: true,
        vpn_subnet: '',
        listener_ip: '',
        listener_port: '53',
        public_default_action: 'allow',
        upstreams: '1.1.1.1, 8.8.8.8',
      })
      return
    }
    let upstreams = '1.1.1.1, 8.8.8.8'
    try {
      const parsed = JSON.parse(existingAlloc.upstreams || '[]')
      if (Array.isArray(parsed) && parsed.length > 0) upstreams = parsed.join(', ')
    } catch {
      // Keep default
    }

    let defaultListenerIp = existingAlloc.listener_ip ?? ''
    if (!defaultListenerIp && existingAlloc.vpn_subnet && existingAlloc.vpn_subnet.includes('/')) {
      const baseIp = existingAlloc.vpn_subnet.split('/')[0]
      const parts = baseIp.split('.')
      if (parts.length === 4) {
        defaultListenerIp = `${parts[0]}.${parts[1]}.${parts[2]}.53`
      }
    }

    setAlloc({
      enabled: Boolean(existingAlloc.enabled),
      vpn_subnet: existingAlloc.vpn_subnet ?? '',
      listener_ip: defaultListenerIp,
      listener_port: String(existingAlloc.listener_port ?? 53),
      public_default_action: existingAlloc.public_default_action ?? 'allow',
      upstreams,
    })
  }, [existingAlloc])

  const selectedZoneObj = zones.find((z) => z.id === selectedZone)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              DNS Infrastructure
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Managed DNS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage CoreDNS node resolvers, per-group subnet allocations, private authoritative zones, and domain policies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
            <Server className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold">
                {healthy} / {managed.length}
              </div>
              <div className="text-[11px] text-muted-foreground">Healthy DNS Nodes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Fleet Nodes Overview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="size-4 text-emerald-600" />
            Resolver Fleet
          </h2>
          <span className="text-xs text-muted-foreground">Auto-refreshes every 10s</span>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Loading DNS nodes...
          </div>
        ) : managed.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No nodes have Managed DNS enabled. Enable it in Node configuration to activate DNS services.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {managed.map((node) => {
              const healthyNode = node.dns_sync_status === 'healthy'
              const Icon = healthyNode
                ? CheckCircle2
                : node.dns_sync_status === 'failed' || node.dns_sync_status === 'degraded'
                  ? XCircle
                  : Clock3
              const statusColor = healthyNode
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                : node.dns_sync_status === 'failed' || node.dns_sync_status === 'degraded'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'

              return (
                <div key={node.id} className="flex flex-col justify-between rounded-xl border bg-card p-4 shadow-sm">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-sm leading-none">{node.hostname}</h3>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Rev {node.dns_config_revision || 'none'}
                        </p>
                      </div>
                      <Badge variant="outline" className={`gap-1 capitalize text-xs ${statusColor}`}>
                        <Icon className="size-3" />
                        {node.dns_sync_status}
                      </Badge>
                    </div>

                    {node.dns_last_sync_error && (
                      <p className="rounded-md bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300 line-clamp-2">
                        {node.dns_last_sync_error}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
                    <span>
                      {node.dns_last_synced_at
                        ? `Synced ${formatBrowserDateTime(node.dns_last_synced_at)}`
                        : 'No sync yet'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => sync.mutate(node.id)}
                      disabled={sync.isPending}
                    >
                      <RefreshCw className={`mr-1.5 size-3 ${sync.isPending ? 'animate-spin' : ''}`} />
                      Sync
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Main Tabs Section */}
      <Tabs defaultValue="allocations" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md h-10">
          <TabsTrigger value="allocations" className="gap-2 text-xs sm:text-sm">
            <Network className="size-4" />
            Allocations
          </TabsTrigger>
          <TabsTrigger value="zones" className="gap-2 text-xs sm:text-sm">
            <Globe className="size-4" />
            Private Zones
          </TabsTrigger>
          <TabsTrigger value="policies" className="gap-2 text-xs sm:text-sm">
            <Shield className="size-4" />
            Domain Policies
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: GROUP ALLOCATIONS ─────────────────────────────────────── */}
        <TabsContent value="allocations" className="space-y-6">
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg">Group Allocation per Node</CardTitle>
              <CardDescription>
                Assign dedicated subnet, local DNS listener IP, and private zones for a group on a specific node.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-6">
              {/* Selectors */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="alloc-group">Target Group</Label>
                  <select
                    id="alloc-group"
                    className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                    <option value="">Select a group...</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="alloc-node">Target Node</Label>
                  <select
                    id="alloc-node"
                    className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    value={allocNode}
                    onChange={(e) => setAllocNode(e.target.value)}
                  >
                    <option value="">Select a node...</option>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.hostname}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedGroup && allocNode ? (
                !existingAlloc?.vpn_subnet ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center space-y-3">
                    <AlertTriangle className="mx-auto size-8 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-foreground">
                        No Subnet Allocated for this Group on this Node
                      </div>
                      <p className="text-xs text-muted-foreground max-w-md mx-auto">
                        This group does not have an allocated VPN subnet on this node yet. Subnet allocations are managed in the <strong>Networks</strong> menu.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-amber-500/30 hover:bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      onClick={() => navigate({ to: '/networks' })}
                    >
                      Go to Networks & Allocate Subnet
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6 pt-2">
                    {/* Allocation Settings Grid */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="vpn-subnet">Group Subnet</Label>
                          <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                            Allocated in Networks
                          </Badge>
                        </div>
                        <Input
                          id="vpn-subnet"
                          value={alloc.vpn_subnet}
                          readOnly
                          disabled
                          className="font-mono text-sm bg-muted/50 cursor-not-allowed"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="listener-ip">
                          DNS Listener IP
                          <span className="ml-1 text-xs text-muted-foreground font-normal">
                            (inside group subnet)
                          </span>
                        </Label>
                        <Input
                          id="listener-ip"
                          value={alloc.listener_ip}
                          onChange={(e) => setAlloc({ ...alloc, listener_ip: e.target.value })}
                          placeholder="10.8.10.53"
                          className="font-mono text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="listener-port">Listener Port</Label>
                        <Input
                          id="listener-port"
                          value={alloc.listener_port}
                          onChange={(e) => setAlloc({ ...alloc, listener_port: e.target.value })}
                          placeholder="53"
                          className="font-mono text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="upstreams">Upstream Resolvers (comma-separated)</Label>
                        <Input
                          id="upstreams"
                          value={alloc.upstreams}
                          onChange={(e) => setAlloc({ ...alloc, upstreams: e.target.value })}
                          placeholder="1.1.1.1, 8.8.8.8"
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>

                    {/* Options row */}
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center gap-6">
                        <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input text-emerald-600 focus:ring-emerald-500"
                            checked={alloc.enabled}
                            onChange={(e) => setAlloc({ ...alloc, enabled: e.target.checked })}
                          />
                          Managed DNS enabled for this group
                        </label>

                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Public default:</span>
                          <select
                            className="h-8 rounded-md border bg-background px-2 text-xs font-medium"
                            value={alloc.public_default_action}
                            onChange={(e) =>
                              setAlloc({ ...alloc, public_default_action: e.target.value })
                            }
                          >
                            <option value="allow">allow</option>
                            <option value="deny">deny</option>
                          </select>
                        </div>
                      </div>

                      <Button
                        onClick={() => saveAlloc.mutate()}
                        disabled={saveAlloc.isPending}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        {saveAlloc.isPending ? 'Saving...' : 'Save DNS Settings'}
                      </Button>
                    </div>

                  {alloc.public_default_action === 'deny' && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="size-4 shrink-0" />
                      <span>
                        A deny default is stored but rejected by the Agent: stock CoreDNS cannot enforce
                        allow-list-only resolution.
                      </span>
                    </div>
                  )}

                  {/* Assigned Private Zones */}
                  <div className="border-t pt-5 space-y-3">
                    <div>
                      <h3 className="font-semibold text-sm">Private Zones Visible to this Group</h3>
                      <p className="text-xs text-muted-foreground">
                        Select which private authoritative zones are resolved by this group's DNS listener.
                      </p>
                    </div>

                    {zones.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                        No private zones defined yet. Create zones in the "Private Zones" tab to assign them here.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {zones.map((zone) => {
                          const isAssigned = assignedZoneIds.has(zone.id)
                          return (
                            <label
                              key={zone.id}
                              className={`flex items-center justify-between rounded-lg border p-3 text-xs cursor-pointer transition-colors ${
                                isAssigned
                                  ? 'border-emerald-500/50 bg-emerald-500/5'
                                  : 'hover:border-border/80'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  className="size-4 rounded border-input text-emerald-600 focus:ring-emerald-500"
                                  checked={isAssigned}
                                  onChange={() => toggleZone(zone.id)}
                                  disabled={assignZones.isPending}
                                />
                                <span className="font-mono font-medium">{zone.name}</span>
                              </div>
                              <Badge variant="secondary" className="text-[10px]">
                                {zone.record_count} records
                              </Badge>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) ) : (
                <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                  <Network className="mx-auto size-8 text-muted-foreground/50 mb-2" />
                  Select both a group and a node above to configure its allocation and zone permissions.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 2: PRIVATE ZONES & RECORDS ───────────────────────────────── */}
        <TabsContent value="zones" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Zones List (Left) */}
            <div className="lg:col-span-4 space-y-4">
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base">Authoritative Zones</CardTitle>
                  <CardDescription className="text-xs">
                    Define private domains for internal VPN services.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  {/* Create Zone Bar */}
                  <div className="flex gap-2">
                    <Input
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value)}
                      placeholder="corp.internal"
                      className="h-9 text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => createZone.mutate()}
                      disabled={!zoneName || createZone.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                    >
                      <Plus className="mr-1 size-3.5" />
                      Add
                    </Button>
                  </div>

                  {/* Zones List */}
                  <div className="space-y-2 pt-1 max-h-[500px] overflow-y-auto">
                    {zones.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                        No zones created yet. Add one above.
                      </div>
                    ) : (
                      zones.map((zone) => {
                        const isSelected = selectedZone === zone.id
                        return (
                          <div
                            key={zone.id}
                            className={`group flex items-center justify-between rounded-lg border p-3 transition-all ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-500/5 shadow-xs'
                                : 'hover:border-border/80 hover:bg-muted/30'
                            }`}
                          >
                            <button
                              type="button"
                              className="flex-1 cursor-pointer text-left"
                              onClick={() => setSelectedZone(isSelected ? null : zone.id)}
                            >
                              <div className="font-mono text-sm font-semibold text-foreground">
                                {zone.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {zone.record_count} record{zone.record_count !== 1 ? 's' : ''}
                              </div>
                            </button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteZone.mutate(zone.id)
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Records Management (Right) */}
            <div className="lg:col-span-8 space-y-4">
              <Card>
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        {selectedZoneObj ? (
                          <span className="flex items-center gap-2">
                            <span>Records in</span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-400">
                              {selectedZoneObj.name}
                            </span>
                          </span>
                        ) : (
                          'Zone Records'
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {selectedZoneObj
                          ? `Manage A, AAAA, CNAME, and TXT entries for ${selectedZoneObj.name}`
                          : 'Select a zone from the left to view and edit its DNS records.'}
                      </CardDescription>
                    </div>
                    {selectedZoneObj && (
                      <Badge variant="secondary" className="font-mono text-xs">
                        {records.length} records
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {selectedZoneObj ? (
                    <>
                      {/* Add Record Form */}
                      <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                        <div className="text-xs font-semibold text-foreground">Add New Record</div>
                        <div className="grid gap-2 sm:grid-cols-12">
                          <div className="sm:col-span-3">
                            <Input
                              value={record.name}
                              onChange={(e) => setRecord({ ...record, name: e.target.value })}
                              placeholder="Name (e.g. git)"
                              className="h-9 font-mono text-xs"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <select
                              className="h-9 w-full rounded-md border bg-background px-2 text-xs font-mono font-medium"
                              value={record.type}
                              onChange={(e) => setRecord({ ...record, type: e.target.value })}
                            >
                              <option value="A">A</option>
                              <option value="AAAA">AAAA</option>
                              <option value="CNAME">CNAME</option>
                              <option value="TXT">TXT</option>
                            </select>
                          </div>
                          <div className="sm:col-span-4">
                            <Input
                              value={record.value}
                              onChange={(e) => setRecord({ ...record, value: e.target.value })}
                              placeholder="Value (e.g. 10.20.10.15)"
                              className="h-9 font-mono text-xs"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Input
                              type="number"
                              value={record.ttl}
                              onChange={(e) => setRecord({ ...record, ttl: e.target.value })}
                              placeholder="TTL"
                              className="h-9 font-mono text-xs"
                            />
                          </div>
                          <div className="sm:col-span-1">
                            <Button
                              size="sm"
                              className="h-9 w-full bg-emerald-600 hover:bg-emerald-700 text-white p-0"
                              onClick={() => createRecord.mutate()}
                              disabled={!record.name || !record.value || createRecord.isPending}
                            >
                              <Plus className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Records Table */}
                      <div className="rounded-lg border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="font-semibold text-xs">Name</TableHead>
                              <TableHead className="font-semibold text-xs">Type</TableHead>
                              <TableHead className="font-semibold text-xs">Value / Target</TableHead>
                              <TableHead className="font-semibold text-xs">TTL</TableHead>
                              <TableHead className="text-right font-semibold text-xs">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {records.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                                  No records in this zone yet. Add one using the form above.
                                </TableCell>
                              </TableRow>
                            ) : (
                              records.map((item) => (
                                <TableRow key={item.id} className="hover:bg-muted/40">
                                  <TableCell className="font-mono text-xs font-medium">
                                    {item.name}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                                      {item.type}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs text-muted-foreground">
                                    {item.value}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs text-muted-foreground">
                                    {item.ttl}s
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-7 text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
                                      onClick={() => deleteRecord.mutate(item.id)}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                      <Layers className="mx-auto size-8 text-muted-foreground/50 mb-2" />
                      Select a zone from the left to view or add DNS records.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── TAB 3: DOMAIN POLICIES ───────────────────────────────────────── */}
        <TabsContent value="policies" className="space-y-6">
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg">Group Domain Policies</CardTitle>
              <CardDescription>
                Enforce domain-level filtering (block, sinkhole, allow) for clients in a VPN group.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-6">
              {/* Group Selector */}
              <div className="max-w-md space-y-1.5">
                <Label htmlFor="policy-group">Select Target Group</Label>
                <select
                  id="policy-group"
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  value={policyGroup}
                  onChange={(e) => setPolicyGroup(e.target.value)}
                >
                  <option value="">Select a group...</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>

              {policyGroup ? (
                <div className="space-y-6">
                  {/* Add Policy Form */}
                  <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <div className="text-xs font-semibold text-foreground">Add Domain Rule</div>
                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <Label className="text-[11px] text-muted-foreground mb-1 block">Domain Pattern</Label>
                        <Input
                          value={policy.domain_pattern}
                          onChange={(e) => setPolicy({ ...policy, domain_pattern: e.target.value })}
                          placeholder="*.youtube.com or adservice.*"
                          className="h-9 font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Label className="text-[11px] text-muted-foreground mb-1 block">Action</Label>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-xs font-medium"
                          value={policy.action}
                          onChange={(e) => setPolicy({ ...policy, action: e.target.value })}
                        >
                          <option value="block">block (Drop query)</option>
                          <option value="sinkhole">sinkhole (Redirect IP)</option>
                          <option value="allow">allow (Permit)</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground mb-1 block">Scope</Label>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-xs font-medium"
                          value={policy.scope}
                          onChange={(e) => setPolicy({ ...policy, scope: e.target.value })}
                        >
                          <option value="public">public</option>
                          <option value="any">any</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground mb-1 block">Priority</Label>
                        <Input
                          type="number"
                          value={policy.priority}
                          onChange={(e) => setPolicy({ ...policy, priority: e.target.value })}
                          placeholder="0"
                          className="h-9 font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-end">
                        <Button
                          size="sm"
                          className="h-9 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => createPolicy.mutate()}
                          disabled={!policy.domain_pattern || createPolicy.isPending}
                        >
                          Add
                        </Button>
                      </div>
                    </div>

                    {policy.action === 'sinkhole' && (
                      <div className="max-w-xs pt-1">
                        <Label className="text-[11px] text-muted-foreground mb-1 block">
                          Sinkhole IPv4 Address
                        </Label>
                        <Input
                          value={policy.sinkhole_ipv4}
                          onChange={(e) => setPolicy({ ...policy, sinkhole_ipv4: e.target.value })}
                          placeholder="e.g. 0.0.0.0 or 10.8.0.254"
                          className="h-9 font-mono text-xs"
                        />
                      </div>
                    )}
                  </div>

                  {/* Policies Table */}
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="font-semibold text-xs">Domain Pattern</TableHead>
                          <TableHead className="font-semibold text-xs">Action</TableHead>
                          <TableHead className="font-semibold text-xs">Scope</TableHead>
                          <TableHead className="font-semibold text-xs">Priority</TableHead>
                          <TableHead className="text-right font-semibold text-xs">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {policies.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                              No domain policies defined for this group. Queries resolve as default.
                            </TableCell>
                          </TableRow>
                        ) : (
                          policies.map((item) => {
                            const actionBadge =
                              item.action === 'block'
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                                : item.action === 'sinkhole'
                                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'

                            return (
                              <TableRow key={item.id} className="hover:bg-muted/40">
                                <TableCell className="font-mono text-xs font-semibold">
                                  {item.domain_pattern}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`capitalize text-[11px] ${actionBadge}`}>
                                    {item.action}
                                    {item.sinkhole_ipv4 ? ` (${item.sinkhole_ipv4})` : ''}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground capitalize">
                                  {item.scope}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.priority}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-7 text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
                                    onClick={() => deletePolicy.mutate(item.id)}
                                  >
                                    <Trash2 className="size-3.5" />
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
              ) : (
                <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                  <ShieldAlert className="mx-auto size-8 text-muted-foreground/50 mb-2" />
                  Select a group above to manage its domain block and sinkhole rules.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
