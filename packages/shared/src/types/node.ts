export type NodeStatus = 'online' | 'offline'

export interface VpnNode {
  id: string
  hostname: string
  ip_address: string
  port: number
  region: string | null
  status: NodeStatus
  version: string | null
  last_seen: string | null
  created_at: string
  active_sessions?: number
  vpn_type: 'openvpn' | 'wireguard'
  public_key?: string | null
  private_key?: string | null
  endpoint_port?: number | null
  firewall_rules_dump?: string | null
  managed_dns_enabled?: boolean
  managed_dns_capable?: boolean
  dns_config_revision?: number
  dns_sync_status?: 'disabled' | 'pending' | 'syncing' | 'healthy' | 'degraded' | 'failed'
  dns_last_sync_error?: string | null
  dns_last_synced_at?: string | null
  dns_config_hash?: string | null
}
