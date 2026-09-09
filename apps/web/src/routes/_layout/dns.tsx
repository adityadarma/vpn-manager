import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Clock3, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

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
type Group = { id: string; name: string }
type Policy = { id: string; domain_pattern: string; action: string; scope: string; priority: number }
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
  const queryClient = useQueryClient()
  const { data: nodes = [], isLoading } = useQuery<Node[]>({ queryKey: ['nodes'], queryFn: () => api.get('/api/v1/nodes'), refetchInterval: 10_000 })
  const sync = useMutation({
    mutationFn: (nodeId: string) => api.post<{ task_id: string }>(`/api/v1/nodes/${nodeId}/dns/sync`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nodes'] }); toast.success('DNS sync queued') },
    onError: (error: Error) => toast.error(error.message),
  })
  const managed = nodes.filter((node) => node.managed_dns_enabled)
  const healthy = managed.filter((node) => node.dns_sync_status === 'healthy').length
  const [zoneName, setZoneName] = useState('')
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [record, setRecord] = useState({ name: '', type: 'A', value: '', ttl: '60' })
  const [selectedGroup, setSelectedGroup] = useState('')
  const [policy, setPolicy] = useState({ domain_pattern: '', action: 'block', scope: 'public', priority: '0', sinkhole_ipv4: '' })
  const { data: zones = [] } = useQuery<Zone[]>({ queryKey: ['dns-zones'], queryFn: () => api.get('/api/v1/dns/zones') })
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/v1/groups') })
  const { data: records = [] } = useQuery<Record[]>({ queryKey: ['dns-records', selectedZone], enabled: !!selectedZone, queryFn: () => api.get(`/api/v1/dns/zones/${selectedZone}/records`) })
  const { data: policies = [] } = useQuery<Policy[]>({ queryKey: ['dns-policies', selectedGroup], enabled: !!selectedGroup, queryFn: () => api.get(`/api/v1/groups/${selectedGroup}/dns/policies`) })
  const refreshDns = () => { queryClient.invalidateQueries({ queryKey: ['dns-zones'] }); queryClient.invalidateQueries({ queryKey: ['dns-records'] }); queryClient.invalidateQueries({ queryKey: ['dns-policies'] }) }
  const createZone = useMutation({ mutationFn: () => api.post<Zone>('/api/v1/dns/zones', { name: zoneName }), onSuccess: (zone) => { setZoneName(''); setSelectedZone(zone.id); refreshDns(); toast.success('Zone created') }, onError: (e: Error) => toast.error(e.message) })
  const deleteZone = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/dns/zones/${id}`), onSuccess: () => { setSelectedZone(null); refreshDns(); toast.success('Zone deleted') }, onError: (e: Error) => toast.error(e.message) })
  const createRecord = useMutation({ mutationFn: () => api.post(`/api/v1/dns/zones/${selectedZone}/records`, { ...record, ttl: Number(record.ttl) }), onSuccess: () => { setRecord({ name: '', type: 'A', value: '', ttl: '60' }); refreshDns(); toast.success('Record created') }, onError: (e: Error) => toast.error(e.message) })
  const deleteRecord = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/dns/records/${id}`), onSuccess: () => { refreshDns(); toast.success('Record deleted') }, onError: (e: Error) => toast.error(e.message) })
  const createPolicy = useMutation({ mutationFn: () => api.post(`/api/v1/groups/${selectedGroup}/dns/policies`, { ...policy, priority: Number(policy.priority), sinkhole_ipv4: policy.action === 'sinkhole' ? policy.sinkhole_ipv4 : null }), onSuccess: () => { setPolicy({ domain_pattern: '', action: 'block', scope: 'public', priority: '0', sinkhole_ipv4: '' }); refreshDns(); toast.success('Policy created') }, onError: (e: Error) => toast.error(e.message) })
  const deletePolicy = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/dns/policies/${id}`), onSuccess: () => { refreshDns(); toast.success('Policy deleted') }, onError: (e: Error) => toast.error(e.message) })

  // ── Group-node allocation + zone assignment ────────────────────────────────
  const [allocNode, setAllocNode] = useState('')
  const [alloc, setAlloc] = useState({ enabled: true, vpn_subnet: '', listener_ip: '', listener_port: '53', public_default_action: 'allow', upstreams: '1.1.1.1, 8.8.8.8' })
  const allocKey = ['group-node-dns', selectedGroup, allocNode]
  // A group/node pair with no allocation yet returns 404, which is a normal
  // empty state here rather than an error worth surfacing.
  const { data: existingAlloc } = useQuery<Allocation | null>({
    queryKey: allocKey,
    enabled: !!selectedGroup && !!allocNode,
    retry: false,
    queryFn: () => api.get<Allocation>(`/api/v1/groups/${selectedGroup}/nodes/${allocNode}/dns`).catch(() => null),
  })
  const saveAlloc = useMutation({
    mutationFn: () => api.put(`/api/v1/groups/${selectedGroup}/nodes/${allocNode}/dns`, {
      enabled: alloc.enabled,
      vpn_subnet: alloc.vpn_subnet.trim(),
      listener_ip: alloc.listener_ip.trim() || null,
      listener_port: Number(alloc.listener_port),
      public_default_action: alloc.public_default_action,
      upstreams: alloc.upstreams.split(',').map((value) => value.trim()).filter(Boolean),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: allocKey }); queryClient.invalidateQueries({ queryKey: ['nodes'] }); toast.success('Allocation saved and DNS sync queued') },
    onError: (error: Error) => toast.error(error.message),
  })
  const { data: assignedZones = [] } = useQuery<Zone[]>({ queryKey: ['group-dns-zones', selectedGroup], enabled: !!selectedGroup, queryFn: () => api.get(`/api/v1/groups/${selectedGroup}/dns/zones`) })
  const assignZones = useMutation({
    mutationFn: (zoneIds: string[]) => api.put(`/api/v1/groups/${selectedGroup}/dns/zones`, { zone_ids: zoneIds }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['group-dns-zones', selectedGroup] }); toast.success('Zone assignment updated') },
    onError: (error: Error) => toast.error(error.message),
  })
  const assignedZoneIds = new Set(assignedZones.map((zone) => zone.id))
  const toggleZone = (zoneId: string) => {
    const next = new Set(assignedZoneIds)
    if (next.has(zoneId)) next.delete(zoneId)
    else next.add(zoneId)
    assignZones.mutate([...next])
  }

  // Mirror the stored allocation into the form when a group/node pair is picked.
  useEffect(() => {
    if (!existingAlloc) return
    let upstreams = '1.1.1.1, 8.8.8.8'
    try {
      const parsed = JSON.parse(existingAlloc.upstreams || '[]')
      if (Array.isArray(parsed) && parsed.length > 0) upstreams = parsed.join(', ')
    } catch {
      // Leave the default when the stored value is not readable JSON.
    }
    setAlloc({
      enabled: Boolean(existingAlloc.enabled),
      vpn_subnet: existingAlloc.vpn_subnet ?? '',
      listener_ip: existingAlloc.listener_ip ?? '',
      listener_port: String(existingAlloc.listener_port ?? 53),
      public_default_action: existingAlloc.public_default_action ?? 'allow',
      upstreams,
    })
  }, [existingAlloc])

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Resolver Fleet</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Managed DNS</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">CoreDNS runs only on opted-in VPN nodes. A healthy revision is required before clients receive a group DNS listener.</p>
      </div>
      <div className="rounded-xl border bg-card px-4 py-3 text-right shadow-sm"><div className="text-2xl font-bold">{healthy}/{managed.length}</div><div className="text-xs text-muted-foreground">Healthy DNS nodes</div></div>
    </div>
    {isLoading ? <div className="text-sm text-muted-foreground">Loading nodes...</div> : managed.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No nodes have Managed DNS enabled. Enable it in a node configuration, then configure group-node DNS allocation.</div> : <div className="grid gap-4 lg:grid-cols-2">
      {managed.map((node) => {
        const healthyNode = node.dns_sync_status === 'healthy'
        const Icon = healthyNode ? CheckCircle2 : node.dns_sync_status === 'failed' || node.dns_sync_status === 'degraded' ? XCircle : Clock3
        const color = healthyNode ? 'text-emerald-600' : node.dns_sync_status === 'failed' || node.dns_sync_status === 'degraded' ? 'text-red-600' : 'text-amber-600'
        return <div key={node.id} className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{node.hostname}</h2><p className="mt-1 text-xs text-muted-foreground">Revision {node.dns_config_revision || 'not applied'}</p></div><div className={`flex items-center gap-1.5 text-sm font-medium ${color}`}><Icon className="size-4" />{node.dns_sync_status}</div></div>
          {node.dns_last_sync_error && <p className="mt-4 rounded-md bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">{node.dns_last_sync_error}</p>}
          <div className="mt-5 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground"><span>{node.dns_last_synced_at ? `Last sync: ${new Date(node.dns_last_synced_at).toLocaleString()}` : 'No successful sync yet'}</span><Button size="sm" variant="outline" onClick={() => sync.mutate(node.id)} disabled={sync.isPending}><RefreshCw className={`mr-2 size-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />Sync</Button></div>
        </div>
      })}
    </div>}
    <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground"><Activity className="mr-2 inline size-4" />Domain policies need a healthy CoreDNS revision. DNS-over-HTTPS is outside ordinary UDP/TCP port 53 firewall enforcement.</div>

    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Group Allocation per Node</h2>
      <p className="mt-1 text-xs text-muted-foreground">Each group gets its own subnet and DNS listener inside the target node VPN pool. Saving queues a DNS sync for that node.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
          <option value="">Select group</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={allocNode} onChange={(e) => setAllocNode(e.target.value)}>
          <option value="">Select node</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.hostname}</option>)}
        </select>
      </div>
      {selectedGroup && allocNode ? <>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Group subnet<Input className="mt-1" value={alloc.vpn_subnet} onChange={(e) => setAlloc({ ...alloc, vpn_subnet: e.target.value })} placeholder="10.8.10.0/24" /></label>
          <label className="text-xs text-muted-foreground">DNS listener IP<Input className="mt-1" value={alloc.listener_ip} onChange={(e) => setAlloc({ ...alloc, listener_ip: e.target.value })} placeholder="10.8.10.53" /></label>
          <label className="text-xs text-muted-foreground">Listener port<Input className="mt-1" value={alloc.listener_port} onChange={(e) => setAlloc({ ...alloc, listener_port: e.target.value })} placeholder="53" /></label>
          <label className="text-xs text-muted-foreground">Upstream resolvers<Input className="mt-1" value={alloc.upstreams} onChange={(e) => setAlloc({ ...alloc, upstreams: e.target.value })} placeholder="1.1.1.1, 8.8.8.8" /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={alloc.enabled} onChange={(e) => setAlloc({ ...alloc, enabled: e.target.checked })} />Managed DNS enabled for this group</label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Public default
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={alloc.public_default_action} onChange={(e) => setAlloc({ ...alloc, public_default_action: e.target.value })}>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <Button size="sm" onClick={() => saveAlloc.mutate()} disabled={!alloc.vpn_subnet || saveAlloc.isPending}>Save allocation</Button>
        </div>
        {alloc.public_default_action === 'deny' && <p className="mt-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">A deny default is stored but rejected by the Agent: stock CoreDNS cannot enforce allow-list-only resolution.</p>}
        <div className="mt-5 border-t pt-4">
          <h3 className="font-medium">Private zones visible to this group</h3>
          <p className="mt-1 text-xs text-muted-foreground">Unassigned zones stay hidden from the group resolver.</p>
          <div className="mt-3 space-y-1">
            {zones.length === 0 ? <p className="text-xs text-muted-foreground">No zones defined yet.</p> : zones.map((zone) => (
              <label key={zone.id} className="flex items-center gap-2 rounded border px-3 py-2 text-xs">
                <input type="checkbox" checked={assignedZoneIds.has(zone.id)} onChange={() => toggleZone(zone.id)} disabled={assignZones.isPending} />
                <span className="font-mono">{zone.name}</span>
              </label>
            ))}
          </div>
        </div>
      </> : <p className="mt-3 text-xs text-muted-foreground">Select a group and a node to edit its allocation.</p>}
    </section>
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="text-lg font-semibold">Private Zones</h2><p className="mt-1 text-xs text-muted-foreground">Create authoritative records for VPN services.</p><div className="mt-4 flex gap-2"><Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="corp.internal" /><Button onClick={() => createZone.mutate()} disabled={!zoneName || createZone.isPending}><Plus className="mr-1 size-4" />Zone</Button></div><div className="mt-4 space-y-2">{zones.map((zone) => <div key={zone.id} className={`flex items-center justify-between rounded-lg border p-3 ${selectedZone === zone.id ? 'border-emerald-500 bg-emerald-500/5' : ''}`}><button className="text-left" onClick={() => setSelectedZone(zone.id)}><div className="font-mono text-sm font-medium">{zone.name}</div><div className="text-xs text-muted-foreground">{zone.record_count} records</div></button><Button size="icon" variant="ghost" onClick={() => deleteZone.mutate(zone.id)}><Trash2 className="size-4 text-red-600" /></Button></div>)}</div>
      {selectedZone && <div className="mt-5 border-t pt-4"><h3 className="font-medium">Records</h3><div className="mt-3 grid gap-2 sm:grid-cols-4"><Input value={record.name} onChange={(e) => setRecord({ ...record, name: e.target.value })} placeholder="git" /><select className="h-9 rounded-md border bg-background px-2 text-sm" value={record.type} onChange={(e) => setRecord({ ...record, type: e.target.value })}><option>A</option><option>AAAA</option><option>CNAME</option><option>TXT</option></select><Input value={record.value} onChange={(e) => setRecord({ ...record, value: e.target.value })} placeholder="10.20.10.15" /><Button onClick={() => createRecord.mutate()} disabled={!record.name || !record.value}>Add</Button></div><div className="mt-3 space-y-1">{records.map((item) => <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2 text-xs"><span className="font-mono">{item.name} {item.type} {item.value}</span><Button size="icon" variant="ghost" onClick={() => deleteRecord.mutate(item.id)}><Trash2 className="size-3.5 text-red-600" /></Button></div>)}</div></div>}</section>
      <section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="text-lg font-semibold">Domain Policies</h2><p className="mt-1 text-xs text-muted-foreground">Block or sinkhole public domains for a VPN group.</p><select className="mt-4 h-9 w-full rounded-md border bg-background px-2 text-sm" value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}><option value="">Select group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>{selectedGroup && <><div className="mt-3 grid gap-2 sm:grid-cols-4"><Input value={policy.domain_pattern} onChange={(e) => setPolicy({ ...policy, domain_pattern: e.target.value })} placeholder="*.youtube.com" /><select className="h-9 rounded-md border bg-background px-2 text-sm" value={policy.action} onChange={(e) => setPolicy({ ...policy, action: e.target.value })}><option value="block">block</option><option value="sinkhole">sinkhole</option><option value="allow">allow</option></select><select className="h-9 rounded-md border bg-background px-2 text-sm" value={policy.scope} onChange={(e) => setPolicy({ ...policy, scope: e.target.value })}><option value="public">public</option><option value="any">any</option></select><Button onClick={() => createPolicy.mutate()} disabled={!policy.domain_pattern}>Add</Button></div>{policy.action === 'sinkhole' && <Input className="mt-2" value={policy.sinkhole_ipv4} onChange={(e) => setPolicy({ ...policy, sinkhole_ipv4: e.target.value })} placeholder="Sinkhole IPv4" />}<div className="mt-3 space-y-1">{policies.map((item) => <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2 text-xs"><span className="font-mono">{item.action} {item.domain_pattern} <span className="text-muted-foreground">{item.scope} / {item.priority}</span></span><Button size="icon" variant="ghost" onClick={() => deletePolicy.mutate(item.id)}><Trash2 className="size-3.5 text-red-600" /></Button></div>)}</div></>}</section>
    </div>
  </div>
}
