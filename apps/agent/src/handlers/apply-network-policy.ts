import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'

const execAsync = promisify(exec)

async function execFirewall(cmd: string, engine: 'iptables' | 'nftables') {
  try {
    await execAsync(cmd)
  } catch (err: any) {
    if (err.message.includes('not found')) {
      console.warn(`[firewall] ${engine} not found, mocked: ${cmd}`)
    } else {
      throw err
    }
  }
}

interface PolicyPayload {
  id: string
  action: 'allow' | 'deny'
  protocol: 'tcp' | 'udp' | 'icmp' | 'all'
  target_network: string
  target_port: string | null
  priority: number
  user_ip: string | null
  group_subnet: string | null
  user_id: string | null
  group_id: string | null
}

export async function handleApplyNetworkPolicy(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const policies = (payload.policies || []) as PolicyPayload[]
  const firewallEngine = (payload.firewall_engine || 'iptables') as string

  if (firewallEngine === 'none') {
    console.log('[firewall] Firewall engine set to NONE. Skipping policy application.')
    return { success: true, count: 0, skipped: true }
  }

  console.log(`[firewall] Applying ${policies.length} policies using ${firewallEngine}.`)

  if (firewallEngine === 'nftables') {
    return applyNftablesPolicies(policies)
  }

  // Default: iptables / iptables-nft wrapper
  return applyIptablesPolicies(policies)
}

async function applyIptablesPolicies(policies: PolicyPayload[]) {
  try {
    // 1. Ensure custom chain exists
    await execFirewall(`iptables -N VPN_FWWD`, 'iptables').catch(() => { /* ignore if already exists */ })

    // 2. Flush current rules from the custom chain
    await execFirewall(`iptables -F VPN_FWWD`, 'iptables')

    // 3. Ensure FORWARD jumps to our custom chain BEFORE default accept
    try {
      await execAsync(`iptables -C FORWARD -i tun+ -j VPN_FWWD`)
    } catch (checkErr: any) {
      if (checkErr.message?.includes('not found') || checkErr.code === 1) { // code 1 = rule doesn't exist
        await execFirewall(`iptables -I FORWARD 1 -i tun+ -j VPN_FWWD`, 'iptables')
        console.log(`[firewall] Hooked VPN_FWWD into FORWARD chain.`)
      } else if (!checkErr.message?.includes('not found')) {
         throw checkErr
      }
    }

    let appliedCount = 0

    // 4. Apply policies ordered by priority (DB already sorts it, so we append them in sequence)
    for (const p of policies) {
      try {
        let rule = `iptables -A VPN_FWWD`

        // Source IP / Subnet
        if (p.user_id) {
          if (!p.user_ip) {
            console.warn(`[firewall] Policy ${p.id} targets user ${p.user_id} but user has no VPN IP. Skipping.`)
            continue
          }
          rule += ` -s ${p.user_ip}/32`
        } else if (p.group_id) {
          if (!p.group_subnet) {
            console.warn(`[firewall] Policy ${p.id} targets group ${p.group_id} but group has no VPN Subnet. Skipping.`)
            continue
          }
          rule += ` -s ${p.group_subnet}`
        }
        // if neither user_id nor group_id is set -> applies to all VPN sources globally

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
        await execFirewall(rule, 'iptables')
        appliedCount++
      } catch (err: any) {
        console.error(`[firewall] Failed to apply rule ${p.id}: ${err.message}`)
      }
    }

    // Default action: if it passes all above rules, RETURN to FORWARD chain
    await execFirewall(`iptables -A VPN_FWWD -j RETURN`, 'iptables')

    console.log(`[firewall] Successfully applied ${appliedCount}/${policies.length} rules.`)
    
    return { success: true, count: appliedCount }
  } catch (error: any) {
    console.error(`[firewall] Critical error applying policies:`, error.message)
    throw error
  }
}

async function applyNftablesPolicies(policies: PolicyPayload[]) {
  try {
    // 1. Ensure table and chain exist
    await execFirewall(`nft add table inet filter`, 'nftables').catch(() => {})
    await execFirewall(`nft add chain inet filter VPN_FWWD`, 'nftables').catch(() => {})
    await execFirewall(`nft flush chain inet filter VPN_FWWD`, 'nftables').catch(() => {})

    // 2. Hook into forward chain
    const checkHook = await execAsync(`nft list chain inet filter FORWARD`).catch(() => ({ stdout: '' }))
    if (!checkHook.stdout?.includes('VPN_FWWD')) {
      await execFirewall(`nft add rule inet filter FORWARD iifname "tun*" jump VPN_FWWD`, 'nftables').catch(err => {
        console.warn(`[firewall/dev] nft hook failed:`, err.message)
      })
    }

    let appliedCount = 0
    for (const p of policies) {
      try {
        let rule = `nft add rule inet filter VPN_FWWD`

        if (p.user_id) {
          if (!p.user_ip) {
            console.warn(`[firewall] Policy ${p.id} targets user ${p.user_id} but user has no VPN IP. Skipping.`)
            continue
          }
          rule += ` ip saddr ${p.user_ip}`
        } else if (p.group_id) {
          if (!p.group_subnet) {
            console.warn(`[firewall] Policy ${p.id} targets group ${p.group_id} but group has no VPN Subnet. Skipping.`)
            continue
          }
          rule += ` ip saddr ${p.group_subnet}`
        }

        rule += ` ip daddr ${p.target_network}`

        if (p.protocol !== 'all') {
          rule += ` ${p.protocol}`
          if (p.target_port && ['tcp', 'udp'].includes(p.protocol)) {
            rule += ` dport ${p.target_port}` // Simplified. Note: nftables uses dport inside the protocol matcher.
          }
        }

        const action = p.action.toUpperCase() === 'ALLOW' ? 'accept' : 'drop'
        rule += ` ${action}`

        await execFirewall(rule, 'nftables')
        appliedCount++
      } catch (err: any) {
        console.error(`[firewall] Failed to apply nftables rule ${p.id}: ${err.message}`)
      }
    }

    await execFirewall(`nft add rule inet filter VPN_FWWD return`, 'nftables').catch(() => {})
    console.log(`[firewall] Successfully applied ${appliedCount}/${policies.length} nftables rules.`)
    return { success: true, count: appliedCount }
  } catch (error: any) {
    console.error(`[firewall] Critical error applying nftables:`, error.message)
    if (error.message.includes('not found')) {
      console.warn('[firewall] nftables command not found.')
    }
    throw error
  }
}
