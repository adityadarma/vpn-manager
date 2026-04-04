export interface VpnSession {
  id: string
  user_id: string
  username?: string
  email?: string
  node_id: string
  node_hostname?: string
  node_region?: string
  vpn_ip: string
  real_ip?: string
  client_version?: string
  device_name?: string
  geo_country?: string
  geo_city?: string
  bytes_sent: number
  bytes_received: number
  connected_at: string
  disconnected_at: string | null
  last_activity_at?: string
  duration_seconds?: number
  disconnect_reason?: string
}
