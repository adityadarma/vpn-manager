import { afterEach, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import type { VpnDriver } from '../src/drivers'
import { handleApplyNetworkPolicy } from '../src/handlers/apply-network-policy'

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
  afterEach(() => {
    try { execSync(`firewall-cmd --permanent --remove-rich-rule='${richRule}'`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rules ipv4 mangle ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-chain ipv4 mangle ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`firewall-cmd --permanent --direct --remove-rule ipv4 mangle PREROUTING 0 -i tun+ -j ${preroutingChain}`, { stdio: 'ignore' }) } catch {}
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
    expect(execSync(`firewall-cmd --permanent --direct --get-all-rules ipv4 mangle ${preroutingChain}`, { encoding: 'utf8' })).toContain('--dport 3306 -j DROP')
  })
})
