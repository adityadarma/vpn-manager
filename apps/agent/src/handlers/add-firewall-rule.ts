import type { VpnDriver } from '../drivers'
import { assertIpOrCidr } from '../core/net-validate'
import { execFirewall, iptablesInvocation } from '../core/firewall-exec'

export async function handleAddFirewallRule(
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
    const rule = `nft add rule inet filter FORWARD ip saddr ${sourceIp} ip daddr ${destNetwork} accept`
    await execFirewall(rule, 'nftables')
    console.log(`[firewall] Added nftables rule: ${sourceIp} → ${destNetwork}`)
    return { rule }
  }

  if (firewallEngine === 'firewalld') {
    const richRule = `rule family=ipv4 source address=${sourceIp} destination address=${destNetwork} accept`
    await execFirewall(`firewall-cmd --permanent --add-rich-rule="${richRule}"`, 'firewalld')
    await execFirewall('firewall-cmd --reload', 'firewalld').catch(() => {})
    console.log(`[firewall] Added firewalld rule: ${sourceIp} → ${destNetwork}`)
    return { richRule }
  }

  // iptables — covers both 'iptables' and 'ufw' modes (ufw uses direct iptables for server routing)
  const rule = `${iptablesInvocation()} -A FORWARD -s ${sourceIp} -d ${destNetwork} -j ACCEPT`
  await execFirewall(rule, 'iptables')
  console.log(`[firewall] Added iptables rule: ${sourceIp} → ${destNetwork}`)
  return { rule }
}
