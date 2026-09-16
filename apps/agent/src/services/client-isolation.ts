import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TABLE = 'vpn_manager_client_isolation'

async function run(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args)
}

async function ignoreMissing(command: string, args: string[]): Promise<void> {
  await run(command, args).catch(() => undefined)
}

async function firewalld(args: string[]): Promise<void> {
  await run('firewall-cmd', args)
}

async function runNftScript(script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('nft', ['-f', '-'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`nft exited with code ${code}: ${stderr.trim()}`)),
    )
    child.stdin.end(script)
  })
}

/**
 * Blocks only traffic whose ingress and egress are both the VPN interface.
 * LAN and internet traffic leave through a different interface and continue
 * through the normal routing and network-policy chains.
 */
export async function applyClientIsolation(
  vpnType: 'openvpn' | 'wireguard',
  firewallEngine: string | undefined,
  allowClientToClient: boolean,
): Promise<void> {
  const resolvedEngine = firewallEngine ?? 'iptables'

  if (resolvedEngine === 'none') {
    if (!allowClientToClient)
      throw new Error('A firewall engine is required when client-to-client traffic is disabled')
    return
  }

  const iptablesInterface = vpnType === 'openvpn' ? 'tun+' : 'wg+'
  const nftInterface = vpnType === 'openvpn' ? 'tun*' : 'wg*'

  if (resolvedEngine === 'nftables') {
    await ignoreMissing('nft', ['delete', 'table', 'inet', TABLE])
    if (allowClientToClient) return
    await runNftScript(`table inet ${TABLE} {
  chain forward {
    type filter hook forward priority -10; policy accept;
    iifname "${nftInterface}" oifname "${nftInterface}" drop
  }
}
`)
    return
  }

  if (resolvedEngine === 'firewalld') {
    await ignoreMissing('nft', ['delete', 'table', 'inet', TABLE])
    await applyFirewalldPersistent(iptablesInterface, allowClientToClient)
    if (allowClientToClient) return
    await runNftScript(`table inet ${TABLE} {
  chain forward {
    type filter hook forward priority -10; policy accept;
    iifname "${nftInterface}" oifname "${nftInterface}" drop
  }
}
`)
    return
  }

  // UFW uses the iptables-compatible path for VPN routing.
  const rule = ['-i', iptablesInterface, '-o', iptablesInterface, '-j', 'DROP']
  await ignoreMissing('iptables', ['-D', 'FORWARD', ...rule])
  if (!allowClientToClient) await run('iptables', ['-I', 'FORWARD', '1', ...rule])
}

async function applyFirewalldPersistent(
  vpnInterface: string,
  allowClientToClient: boolean,
): Promise<void> {
  const chain = 'VPN_CLIENT_ISOLATION'
  const base = ['--permanent', '--direct']

  await firewalld([...base, '--add-chain', 'ipv4', 'filter', chain]).catch(() => undefined)
  await firewalld([
    ...base,
    '--remove-rule',
    'ipv4',
    'filter',
    'FORWARD',
    '0',
    '-i',
    vpnInterface,
    '-o',
    vpnInterface,
    '-j',
    chain,
  ]).catch(() => undefined)
  await firewalld([...base, '--remove-rules', 'ipv4', 'filter', chain]).catch(() => undefined)
  if (allowClientToClient) return
  await firewalld([
    ...base,
    '--add-rule',
    'ipv4',
    'filter',
    'FORWARD',
    '0',
    '-i',
    vpnInterface,
    '-o',
    vpnInterface,
    '-j',
    chain,
  ])
  await firewalld([...base, '--add-rule', 'ipv4', 'filter', chain, '0', '-j', 'DROP'])
}
