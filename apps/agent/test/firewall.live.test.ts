import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'

const hasNetAdmin = (() => {
  if (process.platform !== 'linux') return false
  try {
    execSync('ip link add fwprobe0 type veth peer name fwprobe1 && ip link del fwprobe0', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const hasNftables = (() => {
  try {
    execSync('nft list tables', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const iptablesBackends = ['iptables', 'iptables-nft', 'iptables-legacy'].filter((command) => {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})

describe.runIf(hasNetAdmin)('Firewall kernel integration', () => {
  const namespace = 'fwclientns'
  const serverVeth = 'fwsrv0'
  const clientVeth = 'fwcli0'

  beforeEach(() => {
    execSync(`ip netns add ${namespace}`)
    execSync(`ip link add ${serverVeth} type veth peer name ${clientVeth}`)
    execSync(`ip link set ${clientVeth} netns ${namespace}`)
    execSync(`ip addr add 198.18.0.1/24 dev ${serverVeth}`)
    execSync(`ip link set ${serverVeth} up`)
    execSync(`ip netns exec ${namespace} ip link set lo up`)
    execSync(`ip netns exec ${namespace} ip addr add 198.18.0.2/24 dev ${clientVeth}`)
    execSync(`ip netns exec ${namespace} ip link set ${clientVeth} up`)
  })

  afterEach(() => {
    try { execSync(`ip netns del ${namespace}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`ip link del ${serverVeth}`, { stdio: 'ignore' }) } catch {}
  })

  it.each(iptablesBackends)('%s accepts valid policy syntax and blocks ICMP explicitly', (iptables) => {
    const chain = `VPN_TEST_${iptables.replace(/[^a-z]/g, '').toUpperCase()}`
    execSync(`${iptables} -N ${chain}`)
    execSync(`${iptables} -I INPUT 1 -i ${serverVeth} -j ${chain}`)
    execSync(`${iptables} -A ${chain} -s 198.18.0.2 -p icmp -j DROP`)

    expect(() => execSync(`ip netns exec ${namespace} ping -c 1 -W 1 198.18.0.1`, { stdio: 'ignore' })).toThrow()

    execSync(`${iptables} -D INPUT -i ${serverVeth} -j ${chain}`)
    execSync(`${iptables} -F ${chain}`)
    execSync(`${iptables} -X ${chain}`)
    expect(() => execSync(`ip netns exec ${namespace} ping -c 1 -W 1 198.18.0.1`, { stdio: 'ignore' })).not.toThrow()
  })

  it.runIf(hasNftables)('nftables accepts valid policy syntax and blocks an ICMP source explicitly', () => {
    const table = 'vpn_test_fw'
    const chain = 'input'
    execSync(`nft add table inet ${table}`)
    execSync(`nft add chain inet ${table} ${chain} '{ type filter hook input priority -1; policy accept; }'`)
    execSync(`nft add rule inet ${table} ${chain} iifname "${serverVeth}" ip saddr 198.18.0.2 icmp type echo-request drop`)

    expect(() => execSync(`ip netns exec ${namespace} ping -c 1 -W 1 198.18.0.1`, { stdio: 'ignore' })).toThrow()

    execSync(`nft delete table inet ${table}`)
    expect(() => execSync(`ip netns exec ${namespace} ping -c 1 -W 1 198.18.0.1`, { stdio: 'ignore' })).not.toThrow()
  })
})
