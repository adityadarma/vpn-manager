import type { AgentEnv } from '../config/env'
import type { TaskAction } from '@vpn/shared'
import type { VpnDriver } from '../drivers'
import { handleCreateUser } from '../handlers/create-user'
import { handleRevokeUser } from '../handlers/revoke-user'
import { handleReloadOpenvpn } from '../handlers/reload-openvpn'
import { handleGenerateConfig } from '../handlers/generate-config'
import { handleAddFirewallRule } from '../handlers/add-firewall-rule'
import { handleRemoveFirewallRule } from '../handlers/remove-firewall-rule'
import { handleGenerateClientCert } from '../handlers/generate-client-cert'
import { handleUpdateServerConfig } from '../handlers/update-server-config'
import { handleSyncCertificates } from '../handlers/sync-certificates'
import { handleSyncServerConfig } from '../handlers/sync-server-config'
import { handleKickSession } from '../handlers/kick-session'
import { handleUnkickSession } from '../handlers/unkick-session'
import { handleWriteClientCcd } from '../handlers/write-client-ccd'
import { handleApplyNetworkPolicy } from '../handlers/apply-network-policy'

interface Task {
  id: string
  action: string
  payload: Record<string, unknown>
}

type HandlerFn = (payload: Record<string, unknown>, driver: VpnDriver) => Promise<Record<string, unknown>>

const HANDLERS: Partial<Record<TaskAction, HandlerFn>> = {
  create_vpn_user: handleCreateUser,
  revoke_vpn_user: handleRevokeUser,
  reload_openvpn: handleReloadOpenvpn,
  generate_client_config: handleGenerateConfig,
  generate_client_cert: handleGenerateClientCert,
  add_firewall_rule: handleAddFirewallRule,
  remove_firewall_rule: handleRemoveFirewallRule,
  update_server_config: handleUpdateServerConfig,
  sync_certificates: handleSyncCertificates,
  sync_server_config: handleSyncServerConfig,
  kick_vpn_session: handleKickSession,
  unkick_vpn_session: handleUnkickSession,
  write_client_ccd: handleWriteClientCcd,
  apply_network_policy: handleApplyNetworkPolicy,
}

export async function executeTask(env: AgentEnv, task: Task, driver: VpnDriver): Promise<void> {
  const handler = HANDLERS[task.action as TaskAction]

  let status: 'success' | 'failed' = 'failed'
  let result: Record<string, unknown> = {}
  let errorMessage: string | undefined

  if (!handler) {
    console.warn(`[executor] Unknown task action: ${task.action}`)
    errorMessage = `Unknown action: ${task.action}`
  } else {
    try {
      result = await handler(task.payload, driver)
      status = 'success'
    } catch (err) {
      console.error(`[executor] Task ${task.id} failed:`, (err as Error).message)
      errorMessage = (err as Error).message
    }
  }

  // Report result back to manager
  try {
    const reportUrl = `${env.AGENT_MANAGER_URL}/api/v1/tasks/${task.id}/result`
    console.log(`[executor] Reporting result to: ${reportUrl}`)
    
    const response = await fetch(reportUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENT_SECRET_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status, result, errorMessage }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[executor] Failed to report result: HTTP ${response.status} - ${errorText}`)
    } else {
      console.log(`[executor] ✓ Task result reported successfully`)
    }
  } catch (err) {
    console.error(`[executor] Failed to report result for task ${task.id}:`, (err as Error).message)
  }
}
