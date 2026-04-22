import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'

const execAsync = promisify(exec)

const IPTABLES_POLICY_CHAIN = 'VPN_POLICY_FWWD'
const IPTABLES_LEGACY_POLICY_CHAIN = 'VPN_FWWD'
const NFTABLES_FILTER_TABLE = 'vpn_manager_filter'
const NFTABLES_FORWARD_CHAIN = 'FORWARD'
const NFTABLES_POLICY_CHAIN = 'VPN_POLICY_FWWD'

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

function getVpnInterfaceMatcher(
  vpnType: string,
  firewallEngine: string,
): string {
  // iptables prefix wildcard uses '+', nftables uses '*'.
  if (firewallEngine === 'nftables') {
    return vpnType === 'wireguard' ? 'wg*' : 'tun*'
  }

  return vpnType === 'wireguard' ? 'wg+' : 'tun+'
}

export async function handleApplyNetworkPolicy(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const policies = (payload.policies || []) as PolicyPayload[]
  const firewallEngine = (payload.firewall_engine || 'iptables') as string
  const vpnType = (payload.vpn_type || 'openvpn') as string

  // Determine interface matcher per firewall engine syntax.
  const vpnInterface = getVpnInterfaceMatcher(vpnType, firewallEngine)

  if (firewallEngine === 'none') {
    console.log('[firewall] Firewall engine set to NONE. Skipping policy application.')
    return { success: true, count: 0, skipped: true }
  }

  console.log(`[firewall] Applying ${policies.length} policies using ${firewallEngine} on interface ${vpnInterface} (vpn_type: ${vpnType}).`)

  if (firewallEngine === 'nftables') {
    return applyNftablesPolicies(policies, vpnInterface)
  }

  // Default: iptables / iptables-nft wrapper
  return applyIptablesPolicies(policies, vpnInterface)
}

async function applyIptablesPolicies(policies: PolicyPayload[], vpnInterface: string) {
  try {
    // Clean up legacy dynamic hook/chain from older installs.
    await execFirewall(`iptables -D FORWARD -i ${vpnInterface} -j ${IPTABLES_LEGACY_POLICY_CHAIN}`, 'iptables').catch(() => {})
    await execFirewall(`iptables -F ${IPTABLES_LEGACY_POLICY_CHAIN}`, 'iptables').catch(() => {})
    await execFirewall(`iptables -X ${IPTABLES_LEGACY_POLICY_CHAIN}`, 'iptables').catch(() => {})

    // 1. Ensure custom chain exists
    await execFirewall(`iptables -N ${IPTABLES_POLICY_CHAIN}`, 'iptables').catch(() => { /* ignore if already exists */ })

    // 2. Flush current rules from the custom chain
    await execFirewall(`iptables -F ${IPTABLES_POLICY_CHAIN}`, 'iptables')

    // 3. Ensure FORWARD jumps to our custom chain BEFORE default accept
    try {
      await execAsync(`iptables -C FORWARD -i ${vpnInterface} -j ${IPTABLES_POLICY_CHAIN}`)
    } catch (checkErr: any) {
      if (checkErr.message?.includes('not found') || checkErr.code === 1) { // code 1 = rule doesn't exist
        await execFirewall(`iptables -I FORWARD 1 -i ${vpnInterface} -j ${IPTABLES_POLICY_CHAIN}`, 'iptables')
        console.log(`[firewall] Hooked ${IPTABLES_POLICY_CHAIN} into FORWARD chain for interface ${vpnInterface}.`)
      } else if (!checkErr.message?.includes('not found')) {
         throw checkErr
      }
    }

    let appliedCount = 0

    // 4. Apply policies ordered by priority (DB already sorts it, so we append them in sequence)
    for (const p of policies) {
      try {
        let rule = `iptables -A ${IPTABLES_POLICY_CHAIN}`

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
    await execFirewall(`iptables -A ${IPTABLES_POLICY_CHAIN} -j RETURN`, 'iptables')

    console.log(`[firewall] Successfully applied ${appliedCount}/${policies.length} rules.`)
    
    return { success: true, count: appliedCount }
  } catch (error: any) {
    console.error(`[firewall] Critical error applying policies:`, error.message)
    throw error
  }
}

async function applyNftablesPolicies(policies: PolicyPayload[], vpnInterface: string) {
  try {
    // Clean up legacy dynamic hook/chain from older installs.
    await execFirewall(`nft delete rule inet filter forward iifname "${vpnInterface}" jump ${IPTABLES_LEGACY_POLICY_CHAIN}`, 'nftables').catch(() => {})
    await execFirewall(`nft flush chain inet filter ${IPTABLES_LEGACY_POLICY_CHAIN}`, 'nftables').catch(() => {})
    await execFirewall(`nft delete chain inet filter ${IPTABLES_LEGACY_POLICY_CHAIN}`, 'nftables').catch(() => {})

    // 1. Ensure table and chains exist
    await execFirewall(`nft add table inet ${NFTABLES_FILTER_TABLE}`, 'nftables').catch(() => {})
    // Ensure base FORWARD hook chain exists (idempotent — ignored if already present)
    await execFirewall(`nft add chain inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_FORWARD_CHAIN} { type filter hook forward priority 0 \\; policy accept \\; }`, 'nftables').catch(() => {})
    await execFirewall(`nft add chain inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_POLICY_CHAIN}`, 'nftables').catch(() => {})
    await execFirewall(`nft flush chain inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_POLICY_CHAIN}`, 'nftables').catch(() => {})

    // 2. Hook into forward chain if not already hooked
    const checkHook = await execAsync(`nft list chain inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_FORWARD_CHAIN}`).catch(() => ({ stdout: '' }))
    if (!checkHook.stdout?.includes(NFTABLES_POLICY_CHAIN)) {
      await execFirewall(`nft add rule inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_FORWARD_CHAIN} iifname "${vpnInterface}" jump ${NFTABLES_POLICY_CHAIN}`, 'nftables')

      // Verify the hook exists after insertion; if not, fail task so manager sees real status.
      const verifyHook = await execAsync(`nft list chain inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_FORWARD_CHAIN}`).catch(() => ({ stdout: '' }))
      if (!verifyHook.stdout?.includes(NFTABLES_POLICY_CHAIN)) {
        throw new Error(`nftables hook insertion failed for interface matcher ${vpnInterface}`)
      }
    }

    let appliedCount = 0
    const failedRuleIds: string[] = []
    for (const p of policies) {
      try {
        let rule = `nft add rule inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_POLICY_CHAIN}`

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
        failedRuleIds.push(p.id)
      }
    }

    if (failedRuleIds.length > 0) {
      throw new Error(`Failed to apply nftables rules: ${failedRuleIds.join(', ')}`)
    }

    await execFirewall(`nft add rule inet ${NFTABLES_FILTER_TABLE} ${NFTABLES_POLICY_CHAIN} return`, 'nftables').catch(() => {})
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
