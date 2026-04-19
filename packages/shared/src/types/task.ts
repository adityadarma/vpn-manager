export type TaskStatus = 'pending' | 'running' | 'done' | 'failed'

export type TaskAction =
  | 'create_vpn_user'
  | 'revoke_vpn_user'
  | 'reload_openvpn'
  | 'generate_client_config'
  | 'generate_client_cert'
  | 'add_firewall_rule'
  | 'remove_firewall_rule'
  | 'apply_network_policy'
  | 'update_server_config'
  | 'sync_certificates'
  | 'sync_server_config'
  | 'kick_vpn_session'
  | 'unkick_vpn_session'
  | 'write_client_ccd'
  | 'delete_client_ccd'

export interface Task {
  id: string
  node_id: string
  action: TaskAction
  payload: Record<string, unknown>
  status: TaskStatus
  result: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export type CreateTaskInput = {
  node_id: string
  action: TaskAction
  payload: Record<string, unknown>
}
