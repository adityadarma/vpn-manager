import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { isValidIpv4, isValidIpv4Cidr, isValidPortNumber } from '../core/net-validate'

const execFileAsync = promisify(execFile)
const INPUT_CHAIN = 'VPN_DNS_INPUT'
const FORWARD_CHAIN = 'VPN_DNS_FWWD'
const NFT_TABLE = 'vpn_manager_dns'
const NFT_INPUT_CHAIN = 'VPN_DNS_INPUT'
const NFT_FORWARD_CHAIN = 'VPN_DNS_FWWD'

export type DnsFirewallGroup = { vpn_subnet: string; listener_ip: string; listener_port: number }

function assertGroups(groups: DnsFirewallGroup[]): void {
  for (const group of groups) {
    if (!isValidIpv4Cidr(group.vpn_subnet)) throw new Error(`Invalid DNS group subnet: ${group.vpn_subnet}`)
    if (!isValidIpv4(group.listener_ip)) throw new Error(`Invalid DNS listener IP: ${group.listener_ip}`)
    if (!isValidPortNumber(group.listener_port)) throw new Error(`Invalid DNS listener port: ${group.listener_port}`)
  }
}

async function run(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args)
}

/**
 * Feeds a ruleset to `nft -f -` over stdin.
 *
 * `execFile` has no `input` option — that only exists on the *Sync variants —
 * so the script has to be written to the child's stdin explicitly. Applying
 * the whole ruleset in one `nft` call also makes it atomic: a syntax error
 * leaves the previous DNS rules untouched instead of half-applying them.
 */
function runNftScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('nft', ['-f', '-'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`nft exited with code ${code}: ${stderr.trim()}`))
    })
    child.stdin?.end(script)
  })
}

async function ensureHook(command: string, chain: 'INPUT' | 'FORWARD', dnsChain: string, vpnInterface: string): Promise<void> {
  try {
    await run(command, ['-C', chain, '-i', vpnInterface, '-j', dnsChain])
  } catch {
    await run(command, ['-I', chain, '1', '-i', vpnInterface, '-j', dnsChain])
  }
}

/**
 * nftables variant.
 *
 * Uses a dedicated `inet vpn_manager_dns` table so Managed DNS never edits the
 * table that carries network policy. Recreating the table is the flush: it
 * keeps the apply idempotent without leaving a window where the accept rules
 * are gone but the drop rules are already installed.
 */
async function applyNftablesDnsRules(
  groups: DnsFirewallGroup[],
  vpnInterface: string,
  blockDot = false,
): Promise<void> {
  const lines: string[] = []
  lines.push(`add table inet ${NFT_TABLE}`)
  // priority -10 keeps these hooks ahead of the filter chains used elsewhere.
  lines.push(`add chain inet ${NFT_TABLE} ${NFT_INPUT_CHAIN} { type filter hook input priority -10 ; policy accept ; }`)
  lines.push(`add chain inet ${NFT_TABLE} ${NFT_FORWARD_CHAIN} { type filter hook forward priority -10 ; policy accept ; }`)
  lines.push(`flush chain inet ${NFT_TABLE} ${NFT_INPUT_CHAIN}`)
  lines.push(`flush chain inet ${NFT_TABLE} ${NFT_FORWARD_CHAIN}`)

  // Accept the group's own resolver first.
  for (const group of groups) {
    lines.push(
      `add rule inet ${NFT_TABLE} ${NFT_INPUT_CHAIN} iifname "${vpnInterface}" ip saddr ${group.vpn_subnet}` +
      ` ip daddr ${group.listener_ip} meta l4proto { tcp, udp } th dport ${group.listener_port} accept`,
    )
  }
  // Then drop every other ordinary DNS request from managed subnets.
  const blockedPorts = blockDot ? ['53', '853'] : ['53']
  for (const group of groups) {
    lines.push(
      `add rule inet ${NFT_TABLE} ${NFT_INPUT_CHAIN} iifname "${vpnInterface}" ip saddr ${group.vpn_subnet}` +
      ` meta l4proto { tcp, udp } th dport { ${blockedPorts.join(', ')} } drop`,
    )
    lines.push(
      `add rule inet ${NFT_TABLE} ${NFT_FORWARD_CHAIN} iifname "${vpnInterface}" ip saddr ${group.vpn_subnet}` +
      ` meta l4proto { tcp, udp } th dport { ${blockedPorts.join(', ')} } drop`,
    )
  }

  await runNftScript(`${lines.join('\n')}\n`)
}

async function firewalld(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('firewall-cmd', args)
  return stdout
}

async function ignoreAlreadyExists(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (error) {
    const message = String((error as Error).message ?? '')
    if (!/ALREADY_ENABLED|COMMAND_FAILED.*exists/i.test(message)) throw error
  }
}

/**
 * Uses firewalld's Direct interface because assigning VPN source subnets to a
 * dedicated firewalld zone would also change the policy for all non-DNS
 * traffic from those subnets. Dedicated Direct chains affect port 53 only and
 * match the existing firewalld integration used by network policy.
 */
async function applyFirewalldDnsRules(
  groups: DnsFirewallGroup[],
  vpnType: string,
  blockDot = false,
): Promise<void> {
  // firewalld 2.4 with its nftables backend rejects runtime Direct operations
  // with INVALID_IPV, although the same permanent Direct operations succeed.
  // Apply runtime enforcement through our isolated nft table, then persist an
  // equivalent Direct ruleset for the next firewalld start/reload.
  //
  // Do not call `firewall-cmd --reload`: on a real CentOS host that global
  // reload removed Docker bridge/NAT rules and disconnected unrelated
  // containers.
  await applyNftablesDnsRules(groups, vpnType === 'wireguard' ? 'wg*' : 'tun*', blockDot)
  await applyFirewalldPermanentRules(groups, vpnType === 'wireguard' ? 'wg+' : 'tun+', blockDot)
}

async function applyFirewalldPermanentRules(
  groups: DnsFirewallGroup[],
  vpnInterface: string,
  blockDot: boolean,
): Promise<void> {
  const prefix = ['--permanent']
  for (const chain of [INPUT_CHAIN, FORWARD_CHAIN]) {
    await ignoreAlreadyExists(firewalld([...prefix, '--direct', '--add-chain', 'ipv4', 'filter', chain]))
    await firewalld([...prefix, '--direct', '--remove-rules', 'ipv4', 'filter', chain])
  }

  for (const [parent, child] of [['INPUT', INPUT_CHAIN], ['FORWARD', FORWARD_CHAIN]] as const) {
    const hook = [...prefix, '--direct', '--remove-rule', 'ipv4', 'filter', parent, '0', '-i', vpnInterface, '-j', child]
    await firewalld(hook).catch(() => undefined)
    await firewalld([...prefix, '--direct', '--add-rule', 'ipv4', 'filter', parent, '0', '-i', vpnInterface, '-j', child])
  }

  let priority = 0
  for (const group of groups) {
    for (const protocol of ['udp', 'tcp']) {
      await firewalld([
        ...prefix, '--direct', '--add-rule', 'ipv4', 'filter', INPUT_CHAIN, String(priority++),
        '-s', group.vpn_subnet, '-d', group.listener_ip, '-p', protocol,
        '--dport', String(group.listener_port), '-j', 'ACCEPT',
      ])
    }
  }
  // Drop rules use later priorities so each group's own-listener accepts are
  // evaluated first regardless of firewalld's command insertion behaviour.
  priority = 1000
  const blockedPorts = blockDot ? ['53', '853'] : ['53']
  for (const group of groups) {
    for (const protocol of ['udp', 'tcp']) {
      for (const port of blockedPorts) {
        await firewalld([
          ...prefix, '--direct', '--add-rule', 'ipv4', 'filter', INPUT_CHAIN, String(priority++),
          '-s', group.vpn_subnet, '-p', protocol, '--dport', port, '-j', 'DROP',
        ])
        await firewalld([
          ...prefix, '--direct', '--add-rule', 'ipv4', 'filter', FORWARD_CHAIN, String(priority++),
          '-s', group.vpn_subnet, '-p', protocol, '--dport', port, '-j', 'DROP',
        ])
    }
  }
  }

}

/**
 * Applies only rules owned by Managed DNS. DNS requests to the local listener
 * are accepted before all other port-53 requests from managed VPN subnets drop.
 */
export async function applyManagedDnsFirewall(
  groups: DnsFirewallGroup[],
  firewallEngine: string,
  vpnType: string,
  blockDot = false,
): Promise<void> {
  assertGroups(groups)
  if (firewallEngine === 'none') return
  if (firewallEngine === 'firewalld') {
    await applyFirewalldDnsRules(groups, vpnType, blockDot)
    return
  }

  if (firewallEngine === 'nftables') {
    // nftables uses `*` as its interface wildcard, iptables uses `+`.
    await applyNftablesDnsRules(groups, vpnType === 'wireguard' ? 'wg*' : 'tun*', blockDot)
    return
  }

  const command = 'iptables'
  const vpnInterface = vpnType === 'wireguard' ? 'wg+' : 'tun+'
  for (const chain of [INPUT_CHAIN, FORWARD_CHAIN]) {
    try { await run(command, ['-N', chain]) } catch {}
    await run(command, ['-F', chain])
  }
  await ensureHook(command, 'INPUT', INPUT_CHAIN, vpnInterface)
  await ensureHook(command, 'FORWARD', FORWARD_CHAIN, vpnInterface)

  for (const group of groups) {
    for (const protocol of ['udp', 'tcp']) {
      await run(command, ['-A', INPUT_CHAIN, '-s', group.vpn_subnet, '-d', group.listener_ip, '-p', protocol, '--dport', String(group.listener_port), '-j', 'ACCEPT'])
    }
  }
  const blockedPorts = blockDot ? ['53', '853'] : ['53']
  for (const group of groups) {
    for (const protocol of ['udp', 'tcp']) {
      for (const port of blockedPorts) {
        await run(command, ['-A', INPUT_CHAIN, '-s', group.vpn_subnet, '-p', protocol, '--dport', port, '-j', 'DROP'])
        await run(command, ['-A', FORWARD_CHAIN, '-s', group.vpn_subnet, '-p', protocol, '--dport', port, '-j', 'DROP'])
      }
    }
  }
}
