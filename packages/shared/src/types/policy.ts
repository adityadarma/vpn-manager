export type PolicyAction = 'allow' | 'deny'

export interface VpnPolicy {
  id: string
  user_id: string | null
  group_id: string | null
  node_id: string | null
  target_network: string
  protocol: string
  target_port: string | null
  action: PolicyAction
  priority: number
  description: string | null
  created_at: string
  
  // Joined fields from DB
  username?: string
  group_name?: string
  node_name?: string
}
