import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import {
  Activity,
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
  Search,
  X,
  UsersRound,
  Settings2,
  Ban,
  ExternalLink,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useRealtimeConnected } from '@/components/realtime-provider'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import { toast } from 'sonner'
import { formatBrowserDateTime } from '@vpn/shared'

export const Route = createFileRoute('/_layout/dns')({ component: ManagedDnsPage })

interface Node {
  id: string
  hostname: string
  managed_dns_enabled: boolean
  dns_sync_status: 'disabled' | 'pending' | 'syncing' | 'healthy' | 'degraded' | 'failed'
  dns_config_revision: number
  dns_last_sync_error: string | null
  dns_last_synced_at: string | null
}

interface Zone {
  id: string
  name: string
  description: string | null
  enabled: boolean
  record_count: number
}

interface DnsRecord {
  id: string
  name: string
  type: string
  value: string
  ttl: number
}

interface Group {
  id: string
  name: string
  vpn_subnet?: string | null
}

interface Policy {
  id: string
  group_id: string
  group_name?: string
  domain_pattern: string
  action: string
  scope: string
  priority: number
  sinkhole_ipv4?: string | null
}

interface Allocation {
  group_id: string
  node_id: string
  enabled: boolean | number
  vpn_subnet: string
  listener_ip: string | null
  listener_port: number
  public_default_action: string
  upstreams: string
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
}

interface ConfigureDnsFormContentProps {
  alloc: GroupAllocation
  initialValues: {
    enabled: boolean
    vpn_subnet: string
    listener_ip: string
    listener_port: string
    public_default_action: string
    upstreams: string
  }
  zones: Zone[]
  initialAssignedZoneIds: string[]
  onClose: () => void
  allocKey: (string | undefined)[]
}

// eslint-disable-next-line react-refresh/only-export-components
function ConfigureDnsFormContent({
  alloc,
  initialValues,
  zones,
  initialAssignedZoneIds,
  onClose,
  allocKey,
}: ConfigureDnsFormContentProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initialValues)
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(
    () => new Set(initialAssignedZoneIds),
  )

  const toggleZone = (zoneId: string) => {
    setSelectedZoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(zoneId)) next.delete(zoneId)
      else next.add(zoneId)
      return next
    })
  }

  const saveAlloc = useMutation({
    mutationFn: async () => {
      await api.put(`/api/v1/groups/${alloc.group_id}/nodes/${alloc.node_id}/dns`, {
        enabled: form.enabled,
        vpn_subnet: form.vpn_subnet.trim(),
        listener_ip: form.listener_ip.trim() || null,
        listener_port: Number(form.listener_port),
        public_default_action: form.public_default_action,
        upstreams: form.upstreams
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      })
      await api.put(`/api/v1/groups/${alloc.group_id}/dns/zones`, {
        zone_ids: Array.from(selectedZoneIds),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: allocKey })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['group-allocations'] })
      queryClient.invalidateQueries({ queryKey: ['group-dns-zones', alloc.group_id] })
      toast.success('DNS settings saved and queued for sync')
      onClose()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Modal open={true} onClose={onClose} className="max-w-xl">
      <ModalHeader
        title={`DNS Resolver: ${alloc.group_name} on ${alloc.node_hostname}`}
        description="Manage dedicated CoreDNS listener, upstreams, and private zone resolution"
        onClose={onClose}
      />
      <ModalBody className="space-y-4">
        {/* Context bar */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/60 text-xs">
          <div>
            <span className="text-muted-foreground">Allocated Subnet:</span>
            <code className="ml-1.5 font-mono font-semibold text-foreground">
              {alloc.vpn_subnet}
            </code>
          </div>
          <Badge variant="outline" className="text-[11px] font-normal">
            Node Pool: {alloc.node_pool}
          </Badge>
        </div>

        {/* Managed DNS Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 bg-card">
          <div>
            <div className="font-medium text-sm text-foreground">Enable Managed DNS Resolver</div>
            <div className="text-xs text-muted-foreground">
              Start a dedicated CoreDNS listener for this group on this node
            </div>
          </div>
          <input
            type="checkbox"
            className="size-4 rounded border-input text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
        </div>

        {/* Listener Settings */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="alloc-listener-ip">DNS Listener IP</Label>
            <Input
              id="alloc-listener-ip"
              value={form.listener_ip}
              onChange={(e) => setForm({ ...form, listener_ip: e.target.value })}
              placeholder="e.g. 10.8.10.53"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Usually the .53 host inside the group's VPN subnet.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alloc-listener-port">Listener Port</Label>
            <Input
              id="alloc-listener-port"
              value={form.listener_port}
              onChange={(e) => setForm({ ...form, listener_port: e.target.value })}
              placeholder="53"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Standard DNS port is 53.</p>
          </div>
        </div>

        {/* Upstreams & Public default */}
        <div className="space-y-1.5">
          <Label htmlFor="alloc-upstreams">Upstream Resolvers (comma-separated)</Label>
          <Input
            id="alloc-upstreams"
            value={form.upstreams}
            onChange={(e) => setForm({ ...form, upstreams: e.target.value })}
            placeholder="1.1.1.1, 8.8.8.8"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alloc-public-action">Public Default Action</Label>
          <select
            id="alloc-public-action"
            className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            value={form.public_default_action}
            onChange={(e) => setForm({ ...form, public_default_action: e.target.value })}
          >
            <option value="allow">allow (Permit public queries)</option>
            <option value="deny">deny (Block public queries)</option>
          </select>
        </div>

        {/* Assigned Private Zones */}
        <div className="border-t border-border/60 pt-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Assigned Private Zones
              </span>
              {zones.length > 1 && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-muted-foreground/40">•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedZoneIds(new Set(zones.map((z) => z.id)))}
                    className="text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground/40">/</span>
                  <button
                    type="button"
                    onClick={() => setSelectedZoneIds(new Set())}
                    className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {selectedZoneIds.size} of {zones.length} assigned
            </span>
          </div>
          {zones.length === 0 ? (
            <div className="text-xs text-muted-foreground p-3 rounded-lg border border-dashed border-border/70 text-center">
              No private zones defined yet. Create zones in the "Private Zones" tab.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 max-h-40 overflow-y-auto">
              {zones.map((zone) => {
                const isAssigned = selectedZoneIds.has(zone.id)
                return (
                  <label
                    key={zone.id}
                    className={`flex items-center justify-between rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                      isAssigned
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-border/60 hover:border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-input text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        checked={isAssigned}
                        onChange={() => toggleZone(zone.id)}
                      />
                      <span className="font-mono font-medium truncate">{zone.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {zone.record_count} rec
                    </Badge>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} className="cursor-pointer">
          Cancel
        </Button>
        <Button
          onClick={() => saveAlloc.mutate()}
          disabled={saveAlloc.isPending || !form.vpn_subnet.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs"
        >
          {saveAlloc.isPending ? 'Saving...' : 'Save DNS Settings'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ConfigureDnsModal({
  alloc,
  onClose,
  zones,
}: {
  alloc: GroupAllocation
  onClose: () => void
  zones: Zone[]
}) {
  const allocKey = useMemo(
    () => ['group-node-dns', alloc.group_id, alloc.node_id],
    [alloc.group_id, alloc.node_id],
  )

  const { data: existingAlloc, isLoading: isAllocLoading } = useQuery<Allocation | null>({
    queryKey: allocKey,
    queryFn: () =>
      api
        .get<Allocation>(`/api/v1/groups/${alloc.group_id}/nodes/${alloc.node_id}/dns`)
        .catch(() => null),
  })

  const { data: assignedZones = [], isLoading: isZonesLoading } = useQuery<Zone[]>({
    queryKey: ['group-dns-zones', alloc.group_id],
    queryFn: () => api.get(`/api/v1/groups/${alloc.group_id}/dns/zones`),
  })

  const defaultValues = useMemo(() => {
    if (!existingAlloc) {
      let defaultIp = ''
      if (alloc.vpn_subnet && alloc.vpn_subnet.includes('/')) {
        const baseIp = alloc.vpn_subnet.split('/')[0]
        const parts = baseIp.split('.')
        if (parts.length === 4) defaultIp = `${parts[0]}.${parts[1]}.${parts[2]}.53`
      }
      return {
        enabled: true,
        vpn_subnet: alloc.vpn_subnet,
        listener_ip: defaultIp,
        listener_port: '53',
        public_default_action: 'allow',
        upstreams: '1.1.1.1, 8.8.8.8',
      }
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

    return {
      enabled: Boolean(existingAlloc.enabled),
      vpn_subnet: existingAlloc.vpn_subnet ?? alloc.vpn_subnet,
      listener_ip: defaultListenerIp,
      listener_port: String(existingAlloc.listener_port ?? 53),
      public_default_action: existingAlloc.public_default_action ?? 'allow',
      upstreams,
    }
  }, [alloc, existingAlloc])

  if (isAllocLoading || isZonesLoading) {
    return (
      <Modal open={true} onClose={onClose} className="max-w-xl">
        <ModalHeader
          title={`DNS Resolver: ${alloc.group_name} on ${alloc.node_hostname}`}
          onClose={onClose}
        />
        <ModalBody className="py-12 text-center text-sm text-muted-foreground">
          Loading DNS configuration...
        </ModalBody>
      </Modal>
    )
  }

  return (
    <ConfigureDnsFormContent
      key={`${alloc.group_id}-${alloc.node_id}`}
      alloc={alloc}
      initialValues={defaultValues}
      zones={zones}
      initialAssignedZoneIds={assignedZones.map((z) => z.id)}
      onClose={onClose}
      allocKey={allocKey}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ManagedDnsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const realtimeConnected = useRealtimeConnected()

  // Queries
  const { data: nodes = [], isLoading: isNodesLoading } = useQuery<Node[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/api/v1/nodes'),
    refetchInterval: realtimeConnected ? false : 60_000,
  })

  const { data: zones = [], isLoading: isZonesLoading } = useQuery<Zone[]>({
    queryKey: ['dns-zones'],
    queryFn: () => api.get('/api/v1/dns/zones'),
  })

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/api/v1/groups'),
  })

  const { data: allocations = [], isLoading: isAllocLoading } = useQuery<GroupAllocation[]>({
    queryKey: ['group-allocations'],
    queryFn: () => api.get('/api/v1/networks/group-allocations'),
  })

  // Sync Mutation
  const sync = useMutation({
    mutationFn: (nodeId: string) =>
      api.post<{ task_id: string }>(`/api/v1/nodes/${nodeId}/dns/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('DNS sync queued')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const managed = useMemo(() => nodes.filter((node) => node.managed_dns_enabled), [nodes])
  const healthy = useMemo(
    () => managed.filter((node) => node.dns_sync_status === 'healthy').length,
    [managed],
  )

  // Tab State
  const [activeTab, setActiveTab] = useState<'allocations' | 'zones' | 'policies'>('allocations')

  // ─── TAB 1: ALLOCATIONS STATE ─────────────────────────────────────────────
  const [allocSearch, setAllocSearch] = useState('')
  const [allocDnsFilter, setAllocDnsFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [configAlloc, setConfigAlloc] = useState<GroupAllocation | null>(null)

  const filteredAllocations = useMemo(() => {
    return allocations.filter((a) => {
      if (allocDnsFilter === 'enabled' && !a.managed_dns_enabled) return false
      if (allocDnsFilter === 'disabled' && a.managed_dns_enabled) return false

      if (allocSearch.trim()) {
        const q = allocSearch.toLowerCase()
        const matchGroup = a.group_name.toLowerCase().includes(q)
        const matchNode = a.node_hostname.toLowerCase().includes(q)
        const matchSubnet = a.vpn_subnet.toLowerCase().includes(q)
        const matchIp = (a.listener_ip || '').toLowerCase().includes(q)
        if (!matchGroup && !matchNode && !matchSubnet && !matchIp) return false
      }
      return true
    })
  }, [allocations, allocDnsFilter, allocSearch])

  // ─── TAB 2: ZONES & RECORDS STATE ─────────────────────────────────────────
  const [zoneName, setZoneName] = useState('')
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [showAddRecordModal, setShowAddRecordModal] = useState(false)
  const [record, setRecord] = useState({ name: '', type: 'A', value: '', ttl: '60' })
  const [recordSearch, setRecordSearch] = useState('')
  const [recordTypeFilter, setRecordTypeFilter] = useState<'all' | 'A' | 'AAAA' | 'CNAME' | 'TXT'>(
    'all',
  )

  const activeZoneId = useMemo(() => {
    if (selectedZone && zones.some((z) => z.id === selectedZone)) return selectedZone
    return zones.length > 0 ? zones[0].id : null
  }, [selectedZone, zones])

  const selectedZoneObj = useMemo(
    () => zones.find((z) => z.id === activeZoneId),
    [zones, activeZoneId],
  )

  const { data: records = [], isLoading: isRecordsLoading } = useQuery<DnsRecord[]>({
    queryKey: ['dns-records', activeZoneId],
    enabled: !!activeZoneId,
    queryFn: () => api.get(`/api/v1/dns/zones/${activeZoneId}/records`),
  })

  const refreshDns = () => {
    queryClient.invalidateQueries({ queryKey: ['dns-zones'] })
    queryClient.invalidateQueries({ queryKey: ['dns-records'] })
    queryClient.invalidateQueries({ queryKey: ['dns-policies'] })
  }

  const createZone = useMutation({
    mutationFn: () => api.post<Zone>('/api/v1/dns/zones', { name: zoneName.trim() }),
    onSuccess: (zone) => {
      setZoneName('')
      setSelectedZone(zone.id)
      refreshDns()
      toast.success('Private zone created')
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
    mutationFn: () =>
      api.post(`/api/v1/dns/zones/${activeZoneId}/records`, {
        ...record,
        ttl: Number(record.ttl) || 60,
      }),
    onSuccess: () => {
      setRecord({ name: '', type: 'A', value: '', ttl: '60' })
      setShowAddRecordModal(false)
      refreshDns()
      toast.success('Record added')
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

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (recordTypeFilter !== 'all' && r.type !== recordTypeFilter) return false
      if (recordSearch.trim()) {
        const q = recordSearch.toLowerCase()
        if (!r.name.toLowerCase().includes(q) && !r.value.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [records, recordTypeFilter, recordSearch])

  // ─── TAB 3: DOMAIN POLICIES STATE ─────────────────────────────────────────
  const [policyGroupFilter, setPolicyGroupFilter] = useState('')
  const [policySearch, setPolicySearch] = useState('')
  const [policyActionFilter, setPolicyActionFilter] = useState<
    'all' | 'block' | 'sinkhole' | 'allow'
  >('all')
  const [showAddPolicyModal, setShowAddPolicyModal] = useState(false)
  const [policy, setPolicy] = useState({
    group_id: '',
    domain_pattern: '',
    action: 'block',
    scope: 'public',
    priority: '0',
    sinkhole_ipv4: '',
  })

  const { data: policies = [], isLoading: isPoliciesLoading } = useQuery<Policy[]>({
    queryKey: ['dns-policies'],
    queryFn: () => api.get('/api/v1/dns/policies'),
  })

  const createPolicy = useMutation({
    mutationFn: () => {
      const targetGroupId = policy.group_id || (groups.length > 0 ? groups[0].id : '')
      if (!targetGroupId) throw new Error('Please select a group')
      return api.post(`/api/v1/groups/${targetGroupId}/dns/policies`, {
        domain_pattern: policy.domain_pattern.trim(),
        action: policy.action,
        scope: policy.scope,
        priority: Number(policy.priority) || 0,
        sinkhole_ipv4: policy.action === 'sinkhole' ? policy.sinkhole_ipv4?.trim() || null : null,
      })
    },
    onSuccess: () => {
      setPolicy({
        group_id: policyGroupFilter || (groups[0]?.id ?? ''),
        domain_pattern: '',
        action: 'block',
        scope: 'public',
        priority: '0',
        sinkhole_ipv4: '',
      })
      setShowAddPolicyModal(false)
      refreshDns()
      toast.success('Domain policy created')
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

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (policyGroupFilter && p.group_id !== policyGroupFilter) return false
      if (policyActionFilter !== 'all' && p.action !== policyActionFilter) return false
      if (policySearch.trim()) {
        const q = policySearch.toLowerCase()
        const matchPattern = p.domain_pattern.toLowerCase().includes(q)
        const matchSinkhole = (p.sinkhole_ipv4 || '').toLowerCase().includes(q)
        const matchGroup = (p.group_name || '').toLowerCase().includes(q)
        if (!matchPattern && !matchSinkhole && !matchGroup) {
          return false
        }
      }
      return true
    })
  }, [policies, policyGroupFilter, policyActionFilter, policySearch])

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
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Managed DNS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure CoreDNS node resolvers, per-group subnet allocations, private authoritative
            zones, and domain policies.
          </p>
        </div>

        {/* Quick Summary Stat Cards */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2 shadow-xs">
            <Server className="size-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-xs font-bold text-foreground">
                {healthy} / {managed.length}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Healthy Nodes
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2 shadow-xs">
            <Globe className="size-4 text-blue-600 dark:text-blue-400" />
            <div>
              <div className="text-xs font-bold text-foreground">{zones.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Private Zones
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2 shadow-xs">
            <Network className="size-4 text-indigo-600 dark:text-indigo-400" />
            <div>
              <div className="text-xs font-bold text-foreground">{allocations.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Allocations
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fleet Nodes Overview Card */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="size-4 text-emerald-600 dark:text-emerald-400" />
            Resolver Fleet
          </h2>
          <span className="text-xs text-muted-foreground">Auto-refreshes every 10s</span>
        </div>

        {isNodesLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3"
              >
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        ) : managed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-card p-8 text-center text-sm text-muted-foreground">
            <Server className="mx-auto size-8 text-muted-foreground/40 mb-2" />
            No nodes currently have Managed DNS enabled. Enable Managed DNS in Node Settings to
            activate CoreDNS.
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
                <div
                  key={node.id}
                  className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs hover:border-border/80 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                          <span
                            className={`size-2 rounded-full ${
                              healthyNode ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          />
                          {node.hostname}
                        </h3>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Revision {node.dns_config_revision || '0'}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`gap-1 capitalize text-xs ${statusColor}`}
                      >
                        <Icon className="size-3" />
                        {node.dns_sync_status}
                      </Badge>
                    </div>

                    {node.dns_last_sync_error && (
                      <p className="rounded-md bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300 line-clamp-2 font-mono">
                        {node.dns_last_sync_error}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                    <span>
                      {node.dns_last_synced_at
                        ? `Synced ${formatBrowserDateTime(node.dns_last_synced_at)}`
                        : 'No sync yet'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs cursor-pointer hover:text-foreground"
                      onClick={() => sync.mutate(node.id)}
                      disabled={sync.isPending}
                    >
                      <RefreshCw
                        className={`mr-1.5 size-3 ${sync.isPending ? 'animate-spin' : ''}`}
                      />
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
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'allocations' | 'zones' | 'policies')}
        className="space-y-6"
      >
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="allocations" className="gap-2 cursor-pointer text-xs sm:text-sm">
              <Network className="size-4" />
              Allocations ({allocations.length})
            </TabsTrigger>
            <TabsTrigger value="zones" className="gap-2 cursor-pointer text-xs sm:text-sm">
              <Globe className="size-4" />
              Private Zones ({zones.length})
            </TabsTrigger>
            <TabsTrigger value="policies" className="gap-2 cursor-pointer text-xs sm:text-sm">
              <Shield className="size-4" />
              Domain Policies
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ─── TAB 1: GROUP & SUBNET ALLOCATIONS TABLE ──────────────────────── */}
        <TabsContent value="allocations" className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search allocations by group, node, or subnet..."
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

            {/* Filter pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setAllocDnsFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    allocDnsFilter === 'all'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All DNS
                </button>
                <button
                  type="button"
                  onClick={() => setAllocDnsFilter('enabled')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    allocDnsFilter === 'enabled'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Enabled
                </button>
                <button
                  type="button"
                  onClick={() => setAllocDnsFilter('disabled')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    allocDnsFilter === 'disabled'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Disabled
                </button>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 cursor-pointer"
                onClick={() => navigate({ to: '/networks' })}
              >
                <ExternalLink className="mr-1.5 size-3.5" />
                Manage Subnets
              </Button>
            </div>
          </div>

          {/* Directory Table */}
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
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Target Node
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      VPN Subnet
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Managed DNS
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Listener IP
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-28">
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
                            <Skeleton className="h-4 w-32" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-28 rounded-md" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24 rounded-md" />
                        </TableCell>
                        <TableCell className="text-center">
                          <Skeleton className="h-5 w-16 mx-auto rounded-full" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell className="text-right pr-5">
                          <Skeleton className="h-7 w-20 rounded-md ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredAllocations.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Network className="h-6 w-6 text-muted-foreground/70" />
                          </div>
                          <h3 className="font-semibold text-foreground text-base">
                            No allocations found
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {allocSearch || allocDnsFilter !== 'all'
                              ? 'No subnet allocations match your search or filter criteria.'
                              : 'No group subnet allocations exist yet. Allocate group subnets on target nodes in the Networks menu.'}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4 text-xs cursor-pointer"
                            onClick={() => {
                              if (allocSearch || allocDnsFilter !== 'all') {
                                setAllocSearch('')
                                setAllocDnsFilter('all')
                              } else {
                                navigate({ to: '/networks' })
                              }
                            }}
                          >
                            {allocSearch || allocDnsFilter !== 'all'
                              ? 'Clear filters'
                              : 'Go to Networks'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAllocations.map((a, index) => (
                      <TableRow
                        key={`${a.group_id}-${a.node_id}`}
                        className="hover:bg-muted/40 transition-colors"
                      >
                        <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                          {index + 1}
                        </TableCell>

                        {/* Group Name with Icon Box */}
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                              <UsersRound className="size-4" />
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-foreground">
                                {a.group_name}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Pool: {a.node_pool}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        {/* Node */}
                        <TableCell className="text-xs whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20">
                            <Server className="size-3" />
                            {a.node_hostname}
                          </span>
                        </TableCell>

                        {/* Subnet */}
                        <TableCell>
                          <code className="px-2 py-0.5 rounded-md font-mono text-xs font-medium bg-muted/60 text-foreground border border-border/70 whitespace-nowrap">
                            {a.vpn_subnet}
                          </code>
                        </TableCell>

                        {/* DNS Status */}
                        <TableCell className="text-center whitespace-nowrap">
                          {a.managed_dns_enabled ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                            >
                              Enabled
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[11px] text-muted-foreground">
                              Disabled
                            </Badge>
                          )}
                        </TableCell>

                        {/* Listener IP */}
                        <TableCell className="whitespace-nowrap">
                          {a.listener_ip ? (
                            <code className="px-2 py-0.5 rounded-md font-mono text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                              {a.listener_ip}:53
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">No listener</span>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right pr-5 whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8 cursor-pointer hover:bg-muted"
                            onClick={() => setConfigAlloc(a)}
                          >
                            <Settings2 className="mr-1.5 size-3.5 text-muted-foreground" />
                            Configure
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ─── TAB 2: PRIVATE ZONES & RECORDS ───────────────────────────────── */}
        <TabsContent value="zones" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Zones List (Left 4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              <Card className="rounded-xl border border-border shadow-xs overflow-hidden">
                <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">Authoritative Zones</CardTitle>
                      <CardDescription className="text-xs">
                        Private domains for internal VPN services
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">
                      {zones.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  {/* Create Zone Bar */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (zoneName.trim()) createZone.mutate()
                    }}
                    className="flex gap-2"
                  >
                    <Input
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value)}
                      placeholder="e.g. corp.internal"
                      className="h-9 text-xs font-mono"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!zoneName.trim() || createZone.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 cursor-pointer shadow-xs"
                    >
                      <Plus className="mr-1 size-3.5" />
                      Add
                    </Button>
                  </form>

                  {/* Zones List */}
                  <div className="space-y-2 pt-1 max-h-[500px] overflow-y-auto">
                    {isZonesLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-lg" />
                      ))
                    ) : zones.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground">
                        <Globe className="mx-auto size-6 text-muted-foreground/50 mb-1.5" />
                        No private zones created yet. Add one above.
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
                                : 'border-border/60 hover:border-border hover:bg-muted/30'
                            }`}
                          >
                            <button
                              type="button"
                              className="flex-1 cursor-pointer text-left min-w-0"
                              onClick={() => setSelectedZone(zone.id)}
                            >
                              <div className="font-mono text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
                                <Globe
                                  className={`size-3.5 shrink-0 ${
                                    isSelected
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-muted-foreground'
                                  }`}
                                />
                                {zone.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {zone.record_count} record{zone.record_count !== 1 ? 's' : ''}
                              </div>
                            </button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground/60 hover:text-red-600 hover:bg-red-500/10 cursor-pointer shrink-0"
                              aria-label={`Delete zone ${zone.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (
                                  confirm(`Delete private zone "${zone.name}" and all its records?`)
                                ) {
                                  deleteZone.mutate(zone.id)
                                }
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Records Management (Right 8 cols) */}
            <div className="lg:col-span-8 space-y-4">
              <Card className="rounded-xl border border-border shadow-xs overflow-hidden">
                <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">
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
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {records.length} records
                        </Badge>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer h-8 shadow-xs"
                          onClick={() => setShowAddRecordModal(true)}
                        >
                          <Plus className="mr-1 size-3.5" />
                          Add Record
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  {selectedZoneObj ? (
                    <>
                      {/* Records Toolbar */}
                      {records.length > 0 && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pb-1">
                          <div className="relative flex-1 max-w-xs">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                            <Input
                              type="text"
                              placeholder="Filter records by name or target..."
                              value={recordSearch}
                              onChange={(e) => setRecordSearch(e.target.value)}
                              className="pl-8 pr-7 h-8 text-xs font-mono"
                            />
                            {recordSearch && (
                              <button
                                type="button"
                                onClick={() => setRecordSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                                aria-label="Clear search"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>

                          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-[11px] self-start sm:self-auto">
                            {(['all', 'A', 'AAAA', 'CNAME', 'TXT'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setRecordTypeFilter(t)}
                                className={`px-2.5 py-0.5 rounded-md font-medium transition-all cursor-pointer ${
                                  recordTypeFilter === t
                                    ? 'bg-card text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {t === 'all' ? 'All Types' : t}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-border/70 overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/40">
                            <TableRow className="border-b border-border">
                              <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                #
                              </TableHead>
                              <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                                Name
                              </TableHead>
                              <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                                Type
                              </TableHead>
                              <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                                Value / Target
                              </TableHead>
                              <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                                TTL
                              </TableHead>
                              <TableHead className="text-right font-semibold text-xs uppercase tracking-wider text-muted-foreground pr-4 w-16">
                                Action
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="divide-y divide-border/60">
                            {isRecordsLoading ? (
                              Array.from({ length: 3 }).map((_, i) => (
                                <TableRow key={i}>
                                  <TableCell colSpan={6} className="py-4">
                                    <Skeleton className="h-5 w-full" />
                                  </TableCell>
                                </TableRow>
                              ))
                            ) : records.length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="py-12 text-center">
                                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2">
                                      <Layers className="size-5 text-muted-foreground/60" />
                                    </div>
                                    <div className="font-medium text-foreground text-sm">
                                      No records in this zone
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Create your first record to begin mapping domain names inside{' '}
                                      {selectedZoneObj.name}.
                                    </p>
                                    <Button
                                      size="sm"
                                      className="mt-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                                      onClick={() => setShowAddRecordModal(true)}
                                    >
                                      <Plus className="mr-1 size-3.5" />
                                      Add Record
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : filteredRecords.length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="py-10 text-center">
                                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                                    <p className="text-xs text-muted-foreground">
                                      No records match the current filter or search.
                                    </p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="mt-3 text-xs cursor-pointer"
                                      onClick={() => {
                                        setRecordSearch('')
                                        setRecordTypeFilter('all')
                                      }}
                                    >
                                      Clear filters
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : (
                              filteredRecords.map((item, index) => {
                                const typeColor =
                                  item.type === 'A'
                                    ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20'
                                    : item.type === 'AAAA'
                                      ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20'
                                      : item.type === 'CNAME'
                                        ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20'
                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'

                                return (
                                  <TableRow
                                    key={item.id}
                                    className="hover:bg-muted/40 transition-colors"
                                  >
                                    <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                                      {index + 1}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs font-semibold text-foreground py-2.5">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span>{item.name}</span>
                                        <span className="text-[10px] text-muted-foreground/80 font-normal">
                                          {item.name === '@'
                                            ? `(${selectedZoneObj.name})`
                                            : `.${selectedZoneObj.name}`}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={`font-mono text-[10px] uppercase ${typeColor}`}
                                      >
                                        {item.type}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                      <code className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground border border-border/70">
                                        {item.value}
                                      </code>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                      {item.ttl}s
                                    </TableCell>
                                    <TableCell className="text-right pr-4">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-7 text-muted-foreground/60 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                                        aria-label={`Delete record ${item.name}`}
                                        onClick={() => {
                                          if (
                                            confirm(
                                              `Delete record "${item.name}" (${item.type} ${item.value})?`,
                                            )
                                          ) {
                                            deleteRecord.mutate(item.id)
                                          }
                                        }}
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
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/80 p-12 text-center text-sm text-muted-foreground">
                      <Globe className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                      Select a private zone from the left panel to view and manage its DNS records.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── TAB 3: DOMAIN POLICIES ───────────────────────────────────────── */}
        <TabsContent value="policies" className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Group Filter & Search */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-xl">
              <div className="min-w-[180px]">
                <select
                  id="policy-group-filter"
                  className="h-9 w-full rounded-lg border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                  value={policyGroupFilter}
                  onChange={(e) => setPolicyGroupFilter(e.target.value)}
                >
                  <option value="">All Groups ({policies.length})</option>
                  {groups.map((group) => {
                    const count = policies.filter((p) => p.group_id === group.id).length
                    return (
                      <option key={group.id} value={group.id}>
                        {group.name} ({count})
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search rules by pattern, group, or IP..."
                  value={policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                  className="pl-9 pr-8 h-9 text-xs font-mono"
                />
                {policySearch && (
                  <button
                    type="button"
                    onClick={() => setPolicySearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Quick Filter Pills & Add Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPolicyActionFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    policyActionFilter === 'all'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All Actions
                </button>
                <button
                  type="button"
                  onClick={() => setPolicyActionFilter('block')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    policyActionFilter === 'block'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Block
                </button>
                <button
                  type="button"
                  onClick={() => setPolicyActionFilter('sinkhole')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    policyActionFilter === 'sinkhole'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sinkhole
                </button>
                <button
                  type="button"
                  onClick={() => setPolicyActionFilter('allow')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                    policyActionFilter === 'allow'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Allow
                </button>
              </div>

              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer h-9 shadow-xs"
                onClick={() => {
                  setPolicy((prev) => ({
                    ...prev,
                    group_id: policyGroupFilter || (groups[0]?.id ?? ''),
                  }))
                  setShowAddPolicyModal(true)
                }}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add Domain Rule
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="w-12 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[140px]">
                      Group
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Domain Pattern
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Action
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Scope
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Priority
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-5 w-24">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/60">
                  {isPoliciesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7} className="py-4">
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredPolicies.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-14 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Shield className="size-6 text-muted-foreground/60" />
                          </div>
                          <h3 className="font-semibold text-foreground text-sm">
                            No domain policies found
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {policySearch || policyActionFilter !== 'all' || policyGroupFilter
                              ? 'No rules match your search or filter criteria.'
                              : 'No domain filtering policies configured yet.'}
                          </p>
                          <Button
                            size="sm"
                            className="mt-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                            onClick={() => {
                              if (
                                policySearch ||
                                policyActionFilter !== 'all' ||
                                policyGroupFilter
                              ) {
                                setPolicySearch('')
                                setPolicyActionFilter('all')
                                setPolicyGroupFilter('')
                              } else {
                                setPolicy((prev) => ({
                                  ...prev,
                                  group_id: groups[0]?.id ?? '',
                                }))
                                setShowAddPolicyModal(true)
                              }
                            }}
                          >
                            {policySearch || policyActionFilter !== 'all' || policyGroupFilter
                              ? 'Clear filters'
                              : 'Add First Rule'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPolicies.map((item, index) => {
                      const actionBadge =
                        item.action === 'block'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                          : item.action === 'sinkhole'
                            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'

                      return (
                        <TableRow key={item.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground/70">
                            {index + 1}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                <UsersRound className="size-3.5" />
                              </div>
                              <span className="font-semibold text-xs text-foreground truncate">
                                {item.group_name || 'Group'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-foreground">
                            {item.domain_pattern}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`capitalize text-[11px] ${actionBadge}`}
                            >
                              {item.action === 'block' && <Ban className="mr-1 size-3" />}
                              {item.action === 'sinkhole' && (
                                <ShieldAlert className="mr-1 size-3" />
                              )}
                              {item.action === 'allow' && <CheckCircle2 className="mr-1 size-3" />}
                              {item.action}
                              {item.sinkhole_ipv4 ? ` (${item.sinkhole_ipv4})` : ''}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground capitalize">
                            {item.scope === 'public'
                              ? 'Public DNS only'
                              : item.scope === 'internal'
                                ? 'Private zones only'
                                : 'All queries'}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs text-muted-foreground">
                            <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded text-xs bg-muted/40 border border-border/60">
                              {item.priority}
                            </span>
                          </TableCell>
                          <TableCell className="text-right pr-5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-500/10 cursor-pointer ml-auto"
                              aria-label={`Delete policy ${item.domain_pattern}`}
                              onClick={() => {
                                if (confirm(`Delete domain policy for "${item.domain_pattern}"?`)) {
                                  deletePolicy.mutate(item.id)
                                }
                              }}
                            >
                              <Trash2 className="mr-1.5 size-3.5" />
                              Delete
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
        </TabsContent>
      </Tabs>

      {/* ─── MODAL: CONFIGURE GROUP DNS SETTINGS ───────────────────────────── */}
      {configAlloc && (
        <ConfigureDnsModal alloc={configAlloc} onClose={() => setConfigAlloc(null)} zones={zones} />
      )}

      {/* ─── MODAL: ADD RECORD TO ZONE ────────────────────────────────────── */}
      <Modal
        open={showAddRecordModal}
        onClose={() => setShowAddRecordModal(false)}
        className="max-w-md"
      >
        <ModalHeader
          title={selectedZoneObj ? `Add Record to ${selectedZoneObj.name}` : 'Add DNS Record'}
          description="Map hostnames to IPv4, IPv6, canonical names, or text"
          onClose={() => setShowAddRecordModal(false)}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (record.name && record.value) createRecord.mutate()
          }}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          <ModalBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="rec-name">
                  Record Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="rec-name"
                  value={record.name}
                  onChange={(e) => setRecord({ ...record, name: e.target.value })}
                  placeholder="e.g. git, api, @"
                  required
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-type">Type</Label>
                <select
                  id="rec-type"
                  className="h-10 w-full rounded-lg border bg-background px-2.5 text-sm font-mono font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  value={record.type}
                  onChange={(e) => setRecord({ ...record, type: e.target.value })}
                >
                  <option value="A">A</option>
                  <option value="AAAA">AAAA</option>
                  <option value="CNAME">CNAME</option>
                  <option value="TXT">TXT</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-value">
                Value / Target <span className="text-red-500">*</span>
              </Label>
              <Input
                id="rec-value"
                value={record.value}
                onChange={(e) => setRecord({ ...record, value: e.target.value })}
                placeholder={
                  record.type === 'A'
                    ? '10.20.10.15'
                    : record.type === 'AAAA'
                      ? '2001:db8::1'
                      : record.type === 'CNAME'
                        ? 'git-backend.corp.internal.'
                        : 'v=spf1 ...'
                }
                required
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-ttl">TTL (seconds)</Label>
              <Input
                id="rec-ttl"
                type="number"
                value={record.ttl}
                onChange={(e) => setRecord({ ...record, ttl: e.target.value })}
                placeholder="60"
                min="1"
                className="font-mono text-sm"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddRecordModal(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!record.name.trim() || !record.value.trim() || createRecord.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs"
            >
              {createRecord.isPending ? 'Adding...' : 'Add Record'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* ─── MODAL: ADD DOMAIN POLICY ─────────────────────────────────────── */}
      <Modal
        open={showAddPolicyModal}
        onClose={() => setShowAddPolicyModal(false)}
        className="max-w-md"
      >
        <ModalHeader
          title="Add Domain Policy"
          description="Filter or redirect DNS queries for a client group"
          onClose={() => setShowAddPolicyModal(false)}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (policy.group_id && policy.domain_pattern.trim()) createPolicy.mutate()
          }}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          <ModalBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pol-group">
                Target Group <span className="text-red-500">*</span>
              </Label>
              <select
                id="pol-group"
                className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                value={policy.group_id}
                onChange={(e) => setPolicy({ ...policy, group_id: e.target.value })}
                required
              >
                <option value="" disabled>
                  Select group...
                </option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Select the client group this domain rule applies to.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pol-pattern">
                Domain Pattern <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pol-pattern"
                value={policy.domain_pattern}
                onChange={(e) => setPolicy({ ...policy, domain_pattern: e.target.value })}
                placeholder="e.g. *.youtube.com or admin.internal"
                required
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Wildcard pattern to match queried domain names.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pol-action">Action</Label>
                <select
                  id="pol-action"
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                  value={policy.action}
                  onChange={(e) => setPolicy({ ...policy, action: e.target.value })}
                >
                  <option value="block">block (Drop query)</option>
                  <option value="sinkhole">sinkhole (Redirect IP)</option>
                  <option value="allow">allow (Permit)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pol-scope">Scope</Label>
                <select
                  id="pol-scope"
                  className="h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                  value={policy.scope}
                  onChange={(e) => setPolicy({ ...policy, scope: e.target.value })}
                >
                  <option value="public">Public DNS only</option>
                  <option value="internal">Private zones only</option>
                  <option value="any">Public + private zones</option>
                </select>
              </div>
            </div>

            {policy.action === 'sinkhole' && (
              <div className="space-y-1.5">
                <Label htmlFor="pol-sinkhole">
                  Sinkhole IPv4 Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="pol-sinkhole"
                  value={policy.sinkhole_ipv4}
                  onChange={(e) => setPolicy({ ...policy, sinkhole_ipv4: e.target.value })}
                  placeholder="e.g. 0.0.0.0 or 10.8.0.254"
                  required
                  className="font-mono text-sm"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pol-priority">Priority</Label>
              <Input
                id="pol-priority"
                type="number"
                value={policy.priority}
                onChange={(e) => setPolicy({ ...policy, priority: e.target.value })}
                placeholder="0"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Higher priority rules evaluate first.</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddPolicyModal(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!policy.group_id || !policy.domain_pattern.trim() || createPolicy.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs"
            >
              {createPolicy.isPending ? 'Adding...' : 'Add Rule'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  )
}
