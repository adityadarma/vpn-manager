import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Users, Server, Activity, Clock, TrendingUp } from 'lucide-react'
import type { User, VpnNode, VpnSession, Task } from '@vpn/shared'

export const Route = createFileRoute('/_layout/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: users = [] } = useQuery<User[]>({ queryKey: ['users'], queryFn: () => api.get('/api/v1/users') })
  const { data: nodes = [] } = useQuery<VpnNode[]>({ queryKey: ['nodes'], queryFn: () => api.get('/api/v1/nodes') })
  const { data: sessions = [] } = useQuery<VpnSession[]>({ queryKey: ['sessions'], queryFn: () => api.get('/api/v1/sessions') })
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ['tasks'], queryFn: () => api.get('/api/v1/tasks?status=pending') })

  const onlineNodes = nodes.filter((n) => n.status === 'online').length

  const stats = [
    { label: 'Total Users', value: users.length, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Active Sessions', value: sessions.length, icon: Activity, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'VPN Nodes', value: `${onlineNodes}/${nodes.length}`, sub: `${onlineNodes} online`, icon: Server, color: 'text-violet-500', bg: 'bg-violet-50' },
    { label: 'Pending Tasks', value: tasks.length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Overview of your VPN infrastructure</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card text-card-foreground rounded-xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">{label}</span>
              <div className={`${bg} p-2 rounded-lg`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            {sub && <div className="text-xs text-muted-foreground/70 mt-1">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        {/* Nodes Table */}
        <div className="lg:col-span-4 bg-card text-card-foreground rounded-xl border border-border shadow-sm">
          <div className="p-5 border-b border-border/50">
            <h2 className="font-semibold text-foreground">VPN Nodes</h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Recently registered infrastructure</p>
          </div>
          <div className="p-5">
            {nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground/70 text-center py-8">No nodes registered yet.</p>
            ) : (
              <div className="space-y-3">
                {nodes.slice(0, 5).map((node) => {
                  const activeCount = sessions.filter(s => s.node_id === node.id).length
                  return (
                    <div key={node.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{node.hostname}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-muted-foreground/70">{node.ip_address}</p>
                          <span className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1">
                            <Users className="w-3 h-3" /> {activeCount} {activeCount === 1 ? 'user' : 'users'}
                          </span>
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        node.status === 'online'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        {node.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sessions */}
        <div className="lg:col-span-3 bg-card text-card-foreground rounded-xl border border-border shadow-sm">
          <div className="p-5 border-b border-border/50">
            <h2 className="font-semibold text-foreground">Active Sessions</h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Users currently connected</p>
          </div>
          <div className="p-5">
            {sessions.length === 0 ? (
              <div className="text-center py-8">
                <TrendingUp className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/70">No active sessions</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.username}</p>
                      <p className="text-xs text-muted-foreground/70">
                        {s.vpn_ip} &bull; {new Date(s.connected_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
