import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'
import { assertIpOrCidr } from '../core/net-validate'

const execAsync = promisify(exec)

async function execFirewall(cmd: string, engine: string) {
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

export async function handleRemoveFirewallRule(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const sourceIp = payload['sourceIp'] as string
  const destNetwork = payload['destNetwork'] as string
  const firewallEngine = (payload['firewall_engine'] || 'iptables') as string

  if (firewallEngine === 'none') return { success: true, skipped: true }

  if (!sourceIp || !destNetwork) throw new Error('Missing sourceIp or destNetwork')

  // Validate before interpolating into privileged firewall commands.
  assertIpOrCidr(sourceIp, 'sourceIp')
  assertIpOrCidr(destNetwork, 'destNetwork')

  if (firewallEngine === 'nftables') {
    // nftables requires handles for precise deletion; best-effort by exact match.
    const rule = `nft delete rule inet filter FORWARD ip saddr ${sourceIp} ip daddr ${destNetwork} accept`
    await execFirewall(rule, 'nftables').catch(e =>
      console.warn(`[firewall] nftables remove (best-effort): ${e.message}`)
    )
    console.log(`[firewall] Removed nftables rule for ${sourceIp} → ${destNetwork}`)
    return { rule }
  }

  if (firewallEngine === 'firewalld') {
    const richRule = `rule family=ipv4 source address=${sourceIp} destination address=${destNetwork} accept`
    await execFirewall(`firewall-cmd --permanent --remove-rich-rule="${richRule}"`, 'firewalld').catch(e =>
      console.warn(`[firewall] firewalld remove (best-effort): ${e.message}`)
    )
    await execFirewall('firewall-cmd --reload', 'firewalld').catch(() => {})
    console.log(`[firewall] Removed firewalld rule for ${sourceIp} → ${destNetwork}`)
    return { richRule }
  }

  // iptables — covers both 'iptables' and 'ufw' modes (ufw uses direct iptables for server routing)
  const rule = `iptables -D FORWARD -s ${sourceIp} -d ${destNetwork} -j ACCEPT`
  await execFirewall(rule, 'iptables')
  console.log(`[firewall] Removed iptables rule for ${sourceIp} → ${destNetwork}`)
  return { rule }
}
