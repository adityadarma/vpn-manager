import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'

const execAsync = promisify(exec)

const IPTABLES_POLICY_CHAIN = 'VPN_POLICY_FWWD'
const IPTABLES_LEGACY_POLICY_CHAIN = 'VPN_FWWD'
const NFTABLES_FILTER_TABLE = 'vpn_manager_filter'
const NFTABLES_FORWARD_CHAIN = 'FORWARD'
const NFTABLES_POLICY_CHAIN = 'VPN_POLICY_FWWD'

async function execFirewall(cmd: string, engine: 'iptables' | 'nftables' | 'firewalld' | 'ufw') {
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

// ── Input validation (defense-in-depth) ─────────────────────────────────────
// Policy values are interpolated into privileged firewall shell commands. They
// must NEVER contain shell metacharacters. We accept only strict IPv4 / CIDR /
// port formats and reject everything else, regardless of upstream validation.
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV4_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/
const PORT_RE = /^\d{1,5}(:\d{1,5})?$/

function octetsValid(parts: string[]): boolean {
  return parts.every((o) => {
    const n = Number(o)
    return Number.isInteger(n) && n >= 0 && n <= 255
  })
}

function isValidIpv4(value: string): boolean {
  const m = IPV4_RE.exec(value)
  return !!m && octetsValid(m.slice(1, 5))
}

function isValidIpv4Cidr(value: string): boolean {
  const m = IPV4_CIDR_RE.exec(value)
  if (!m) return false
  if (!octetsValid(m.slice(1, 5))) return false
  const prefix = Number(m[5])
  return prefix >= 0 && prefix <= 32
}

function isValidIpOrCidr(value: string): boolean {
  return isValidIpv4(value) || isValidIpv4Cidr(value)
}

function isValidPort(value: string): boolean {
  const m = PORT_RE.exec(value)
  if (!m) return false
  return value.split(':').every((p) => {
    const n = Number(p)
    return Number.isInteger(n) && n >= 0 && n <= 65535
  })
}

// Returns a sanitized copy of the policy if every user-controlled field is safe,
// or null if the policy must be skipped (logged by caller).
function sanitizePolicy(p: PolicyPayload): PolicyPayload | null {
  if (p.target_network != null && !isValidIpOrCidr(p.target_network)) return null
  if (p.user_ip != null && !isValidIpv4(p.user_ip)) return null
  if (p.group_subnet != null && !isValidIpOrCidr(p.group_subnet)) return null
  if (p.target_port != null && p.target_port !== '' && !isValidPort(p.target_port)) return null
  return p
}

function filterSafePolicies(policies: PolicyPayload[]): PolicyPayload[] {
  const safe: PolicyPayload[] = []
  for (const p of policies) {
    if (sanitizePolicy(p)) {
      safe.push(p)
    } else {
      console.warn(
        `[firewall] Policy ${p?.id} rejected: invalid IP/CIDR/port value (possible injection). Skipping.`,
      )
    }
  }
  return safe
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
  const rawPolicies = (payload.policies || []) as PolicyPayload[]
  const firewallEngine = (payload.firewall_engine || 'iptables') as string
  const vpnType = (payload.vpn_type || 'openvpn') as string

  // Reject any policy whose user-controlled fields contain non-IP/CIDR/port
  // values before they reach privileged firewall shell commands.
  const policies = filterSafePolicies(rawPolicies)

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

  if (firewallEngine === 'firewalld') {
    return applyFirewalldPolicies(policies, vpnInterface)
  }

  // iptables — covers both 'iptables' and 'ufw' modes.
  // UFW uses direct iptables rules for server-side routing (intentional, see install-node.sh).
  if (firewallEngine === 'ufw') {
    console.log('[firewall] UFW mode: applying policies via iptables (server-side routing, not ufw cli).')
  }
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

async function applyFirewalldPolicies(policies: PolicyPayload[], _vpnInterface: string) {
  // firewalld does not support custom chains — policies are applied as rich-rules.
  // Note: unlike iptables/nftables, we cannot flush a single "chain" atomically.
  // The manager should always send the complete desired policy set.
  let appliedCount = 0
  const failedRuleIds: string[] = []

  for (const p of policies) {
    try {
      let richRule = `rule family=ipv4`

      if (p.user_id) {
        if (!p.user_ip) {
          console.warn(`[firewall] Policy ${p.id} targets user ${p.user_id} but has no VPN IP. Skipping.`)
          continue
        }
        richRule += ` source address=${p.user_ip}/32`
      } else if (p.group_id) {
        if (!p.group_subnet) {
          console.warn(`[firewall] Policy ${p.id} targets group ${p.group_id} but has no VPN Subnet. Skipping.`)
          continue
        }
        richRule += ` source address=${p.group_subnet}`
      }

      richRule += ` destination address=${p.target_network}`

      if (p.protocol !== 'all') {
        if (p.target_port && ['tcp', 'udp'].includes(p.protocol)) {
          richRule += ` ${p.protocol} port port=${p.target_port}`
        }
      }

      const action = p.action.toUpperCase() === 'ALLOW' ? 'accept' : 'drop'
      richRule += ` ${action}`

      await execFirewall(`firewall-cmd --permanent --add-rich-rule="${richRule}"`, 'firewalld')
      appliedCount++
    } catch (err: any) {
      console.error(`[firewall] Failed to apply firewalld rule ${p.id}: ${err.message}`)
      failedRuleIds.push(p.id)
    }
  }

  if (appliedCount > 0) {
    await execFirewall('firewall-cmd --reload', 'firewalld').catch(() => {})
  }

  if (failedRuleIds.length > 0) {
    throw new Error(`Failed to apply firewalld rules: ${failedRuleIds.join(', ')}`)
  }

  console.log(`[firewall] Successfully applied ${appliedCount}/${policies.length} firewalld rules.`)
  return { success: true, count: appliedCount }
}
