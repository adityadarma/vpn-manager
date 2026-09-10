import { afterEach, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import type { VpnDriver } from '../src/drivers'
import { handleApplyNetworkPolicy } from '../src/handlers/apply-network-policy'
import { applyManagedDnsFirewall } from '../src/services/managed-dns-firewall'

const driver = {} as VpnDriver
const policy = {
  id: 'ci-firewall-policy',
  action: 'deny' as const,
  protocol: 'tcp' as const,
  target_network: '198.18.0.10/32',
  target_port: '3306',
  priority: 100,
  user_ip: '198.18.0.2',
  group_subnet: null,
  user_id: 'ci-user',
  group_id: null,
}
const richRule = 'rule family=ipv4 source address=198.18.0.2/32 destination address=198.18.0.10/32 port port=3306 protocol=tcp drop'
const preroutingChain = 'VPN_POLICY_PRE'

const hasUfw = (() => {
  try {
    execSync('ufw --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const hasFirewalld = (() => {
  try {
    execSync('firewall-cmd --state', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.runIf(hasUfw)('UFW policy integration', () => {
  const chain = 'VPN_POLICY_FWWD'

  afterEach(() => {
    try { execSync(`iptables -D FORWARD -i tun+ -j ${chain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`iptables -D INPUT -i tun+ -j ${chain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`iptables -F ${chain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`iptables -X ${chain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`iptables -t mangle -D PREROUTING -i tun+ -j ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`iptables -t mangle -F ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`iptables -t mangle -X ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
  })

  it('applies VPN policy through iptables while UFW is installed', async () => {
    const result = await handleApplyNetworkPolicy({
      firewall_engine: 'ufw',
      vpn_type: 'openvpn',
      policies: [policy],
    }, driver)

    expect(result).toMatchObject({ success: true, count: 1 })
    expect(execSync(`iptables -S ${chain}`, { encoding: 'utf8' })).toContain('--dport 3306 -j DROP')
    expect(execSync(`iptables -t mangle -S ${preroutingChain}`, { encoding: 'utf8' })).toContain('--dport 3306 -j DROP')
  })
})

describe.runIf(hasFirewalld)('firewalld policy integration', () => {
  const dnsInputChain = 'VPN_DNS_INPUT'
  const dnsForwardChain = 'VPN_DNS_FWWD'

  afterEach(() => {
    try { execSync(`firewall-cmd --permanent --remove-rich-rule='${richRule}'`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rules ipv4 mangle ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-chain ipv4 mangle ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rule ipv4 mangle PREROUTING 0 -i tun+ -j ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rule ipv4 filter INPUT 0 -i tun+ -j ${dnsInputChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rule ipv4 filter FORWARD 0 -i tun+ -j ${dnsForwardChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rules ipv4 filter ${dnsInputChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rules ipv4 filter ${dnsForwardChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-chain ipv4 filter ${dnsInputChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-chain ipv4 filter ${dnsForwardChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync('nft delete table inet vpn_manager_dns', { stdio: 'ignore' }) } catch {}
    try { execSync('firewall-cmd --reload', { stdio: 'ignore' }) } catch {}
  })

  it('persists a deny policy as a firewalld rich rule', async () => {
    const result = await handleApplyNetworkPolicy({
      firewall_engine: 'firewalld',
      vpn_type: 'openvpn',
      policies: [policy],
    }, driver)

    expect(result).toMatchObject({ success: true, count: 1 })
    expect(() => execSync(`firewall-cmd --permanent --query-rich-rule='${richRule}'`, { stdio: 'ignore' })).not.toThrow()
    expect(execSync('firewall-cmd --permanent --direct --get-all-rules', { encoding: 'utf8' })).toContain(`ipv4 mangle ${preroutingChain} 0 -s 198.18.0.2/32 -d 198.18.0.10/32 -p tcp --dport 3306 -j DROP`)
  })

  it('applies idempotent Managed DNS Direct chains with accepts before drops', async () => {
    const groups = [{ vpn_subnet: '10.88.10.0/24', listener_ip: '10.88.10.53', listener_port: 53 }]
    await applyManagedDnsFirewall(groups, 'firewalld', 'openvpn')
    await applyManagedDnsFirewall(groups, 'firewalld', 'openvpn')

    const inputRules = execSync(
      `firewall-cmd --permanent --direct --get-rules ipv4 filter ${dnsInputChain}`,
      { encoding: 'utf8' },
    ).trim().split('\n')
    expect(inputRules).toEqual([
      '0 -s 10.88.10.0/24 -d 10.88.10.53 -p udp --dport 53 -j ACCEPT',
      '1 -s 10.88.10.0/24 -d 10.88.10.53 -p tcp --dport 53 -j ACCEPT',
      '1000 -s 10.88.10.0/24 -p udp --dport 53 -j DROP',
      '1002 -s 10.88.10.0/24 -p tcp --dport 53 -j DROP',
    ])
    expect(execSync(
      `firewall-cmd --permanent --direct --get-rules ipv4 filter ${dnsForwardChain}`,
      { encoding: 'utf8' },
    )).toContain('-s 10.88.10.0/24 -p udp --dport 53 -j DROP')
    expect(execSync('nft list table inet vpn_manager_dns', { encoding: 'utf8' })).toContain('iifname "tun*"')
  })
})
