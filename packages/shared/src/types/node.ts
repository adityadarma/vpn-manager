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
}
