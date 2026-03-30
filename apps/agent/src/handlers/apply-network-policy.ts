import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'

const execAsync = promisify(exec)

interface PolicyPayload {
  id: string
  action: 'allow' | 'deny'
  protocol: 'tcp' | 'udp' | 'icmp' | 'all'
  target_network: string
  target_port: string | null
  priority: number
  user_ip: string | null
  group_subnet: string | null
}

export async function handleApplyNetworkPolicy(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const policies = (payload.policies || []) as PolicyPayload[]

  console.log(`[firewall] Applying ${policies.length} policies to VPN_FWWD chain.`)

  try {
    // 1. Ensure custom chain exists
    await execAsync(`iptables -N VPN_FWWD`).catch(() => { /* ignore if already exists */ })

    // 2. Flush current rules from the custom chain
    await execAsync(`iptables -F VPN_FWWD`)

    // 3. Ensure FORWARD jumps to our custom chain BEFORE default accept
    const checkJump = await execAsync(`iptables -C FORWARD -i tun+ -j VPN_FWWD`).catch(() => null)
    if (!checkJump) {
      await execAsync(`iptables -I FORWARD 1 -i tun+ -j VPN_FWWD`)
      console.log(`[firewall] Hooked VPN_FWWD into FORWARD chain.`)
    }

    let appliedCount = 0

    // 4. Apply policies ordered by priority (DB already sorts it, so we append them in sequence)
    for (const p of policies) {
      try {
        let rule = `iptables -A VPN_FWWD`

        // Source IP / Subnet
        if (p.user_ip) {
          rule += ` -s ${p.user_ip}/32`
        } else if (p.group_subnet) {
          rule += ` -s ${p.group_subnet}`
        }
        // if neither -> applies to all VPN sources

        // Target Network
        rule += ` -d ${p.target_network}`

        // Protocol & Port
        if (p.protocol !== 'all') {
          rule += ` -p ${p.protocol}`
          if (p.target_port && ['tcp', 'udp'].includes(p.protocol)) {
            // iptables uses colon for port ranges e.g. 80:443
            const portFlag = p.target_port.includes(':') ? '--dport' : '--dport'
            rule += ` -m ${p.protocol} ${portFlag} ${p.target_port}`
          }
        }

        // Action
        const action = p.action.toUpperCase() === 'ALLOW' ? 'ACCEPT' : 'DROP'
        rule += ` -j ${action}`

        // Execute rule
        await execAsync(rule)
        appliedCount++
      } catch (err: any) {
        console.error(`[firewall] Failed to apply rule ${p.id}: ${err.message}`)
      }
    }

    // Default action: if it passes all above rules, RETURN to FORWARD chain
    await execAsync(`iptables -A VPN_FWWD -j RETURN`)

    console.log(`[firewall] Successfully applied ${appliedCount}/${policies.length} rules.`)
    
    return { success: true, count: appliedCount }
  } catch (error: any) {
    console.error(`[firewall] Critical error applying policies:`, error.message)
    throw error
  }
}
