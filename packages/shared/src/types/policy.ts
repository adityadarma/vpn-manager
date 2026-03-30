export type PolicyAction = 'allow' | 'deny'

export interface VpnPolicy {
  id: string
  user_id: string
  target_network: string
  action: PolicyAction
  priority: number
  description: string | null
  created_at: string
}
