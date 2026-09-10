import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFile, spawn } = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile, spawn }))

import { applyManagedDnsFirewall } from '../src/services/managed-dns-firewall'

const GROUPS = [
  { vpn_subnet: '10.20.10.0/24', listener_ip: '10.20.10.53', listener_port: 53 },
  { vpn_subnet: '10.20.20.0/24', listener_ip: '10.20.20.53', listener_port: 53 },
]

/** Captures the script written to `nft -f -` and reports a clean exit. */
function stubNft(exitCode = 0): { script: () => string } {
  let script = ''
  spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stdin: any; stderr: EventEmitter }
    child.stderr = new EventEmitter()
    child.stdin = { end: (value: string) => { script = value; setImmediate(() => child.emit('close', exitCode)) } }
    return child
  })
  return { script: () => script }
}

describe('Managed DNS firewall', () => {
  afterEach(() => vi.clearAllMocks())

  it('allows each group listener before blocking other DNS traffic', async () => {
    execFile.mockImplementation((_command: string, args: string[], callback: Function) => {
      callback(args[0] === '-C' ? new Error('rule absent') : null, '', '')
    })
    await applyManagedDnsFirewall([GROUPS[0]!], 'iptables', 'openvpn')
    const calls = execFile.mock.calls.map((call) => call[1].join(' '))
    expect(calls).toContain('-A VPN_DNS_INPUT -s 10.20.10.0/24 -d 10.20.10.53 -p udp --dport 53 -j ACCEPT')
    expect(calls).toContain('-A VPN_DNS_INPUT -s 10.20.10.0/24 -p udp --dport 53 -j DROP')
    expect(calls).toContain('-A VPN_DNS_FWWD -s 10.20.10.0/24 -p tcp --dport 53 -j DROP')
  })

  it('applies one atomic nftables ruleset with accepts before drops', async () => {
    const nft = stubNft()
    await applyManagedDnsFirewall(GROUPS, 'nftables', 'wireguard')

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]?.[1]).toEqual(['-f', '-'])

    const script = nft.script()
    // A dedicated table keeps network-policy rules untouched.
    expect(script).toContain('add table inet vpn_manager_dns')
    expect(script).toContain('flush chain inet vpn_manager_dns VPN_DNS_INPUT')
    expect(script).toContain('iifname "wg*" ip saddr 10.20.10.0/24 ip daddr 10.20.10.53 meta l4proto { tcp, udp } th dport 53 accept')
    expect(script).toContain('iifname "wg*" ip saddr 10.20.20.0/24 meta l4proto { tcp, udp } th dport { 53 } drop')

    // Ordering is the whole point: an accept must precede any drop.
    const firstDrop = script.split('\n').findIndex((line) => line.endsWith('drop'))
    const lastAccept = script.split('\n').reduce((last, line, index) => (line.endsWith('accept') ? index : last), -1)
    expect(lastAccept).toBeGreaterThan(-1)
    expect(lastAccept).toBeLessThan(firstDrop)
  })

  it('optionally drops DNS-over-TLS port 853', async () => {
    const nft = stubNft()
    await applyManagedDnsFirewall([GROUPS[0]!], 'nftables', 'openvpn', true)
    expect(nft.script()).toContain('th dport { 53, 853 } drop')
  })

  it('fails the task when nft rejects the ruleset', async () => {
    stubNft(1)
    await expect(applyManagedDnsFirewall(GROUPS, 'nftables', 'openvpn')).rejects.toThrow('nft exited with code 1')
  })

  it('applies firewalld direct rules with accepts before drops', async () => {
    stubNft()
    execFile.mockImplementation((_command: string, _args: string[], callback: Function) => callback(null, '', ''))
    await applyManagedDnsFirewall([GROUPS[0]!], 'firewalld', 'openvpn')

    const calls = execFile.mock.calls.map((call) => call[1] as string[])
    expect(calls).toContainEqual([
      '--permanent', '--direct', '--add-rule', 'ipv4', 'filter', 'INPUT', '0',
      '-i', 'tun+', '-j', 'VPN_DNS_INPUT',
    ])
    expect(calls).toContainEqual([
      '--permanent', '--direct', '--add-rule', 'ipv4', 'filter', 'VPN_DNS_INPUT', '0',
      '-s', '10.20.10.0/24', '-d', '10.20.10.53', '-p', 'udp', '--dport', '53', '-j', 'ACCEPT',
    ])
    expect(calls).toContainEqual([
      '--permanent', '--direct', '--add-rule', 'ipv4', 'filter', 'VPN_DNS_FWWD', '1001',
      '-s', '10.20.10.0/24', '-p', 'udp', '--dport', '53', '-j', 'DROP',
    ])
    expect(calls).not.toContainEqual(['--reload'])
    expect(spawn).toHaveBeenCalledWith('nft', ['-f', '-'], expect.any(Object))
  })
})
