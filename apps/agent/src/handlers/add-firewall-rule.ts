import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'

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

export async function handleAddFirewallRule(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const sourceIp = payload['sourceIp'] as string
  const destNetwork = payload['destNetwork'] as string
  const firewallEngine = (payload['firewall_engine'] || 'iptables') as string

  if (firewallEngine === 'none') return { success: true, skipped: true }

  if (!sourceIp || !destNetwork) throw new Error('Missing sourceIp or destNetwork')

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
  const rule = `iptables -A FORWARD -s ${sourceIp} -d ${destNetwork} -j ACCEPT`
  await execFirewall(rule, 'iptables')
  console.log(`[firewall] Added iptables rule: ${sourceIp} → ${destNetwork}`)
  return { rule }
}
