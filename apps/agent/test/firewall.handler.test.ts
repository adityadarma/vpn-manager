import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VpnDriver } from '../src/drivers'

const { execAsync } = vi.hoisted(() => ({ execAsync: vi.fn() }))

vi.mock('node:child_process', () => ({ exec: vi.fn() }))
vi.mock('node:util', () => ({ promisify: () => execAsync }))

import { handleAddFirewallRule } from '../src/handlers/add-firewall-rule'
import { handleRemoveFirewallRule } from '../src/handlers/remove-firewall-rule'
import { handleApplyNetworkPolicy } from '../src/handlers/apply-network-policy'

const driver = {} as VpnDriver

describe('firewall handler security', () => {
  beforeEach(() => execAsync.mockReset())

  it.each([
    ['sourceIp', '10.0.0.1; id'],
    ['destNetwork', '10.0.0.0/24 && id'],
  ])('rejects shell syntax in add rule %s before command execution', async (field, value) => {
    await expect(handleAddFirewallRule({
      sourceIp: field === 'sourceIp' ? value : '10.0.0.1',
      destNetwork: field === 'destNetwork' ? value : '10.0.0.0/24',
      firewall_engine: 'iptables',
    }, driver)).rejects.toThrow('Invalid')
    expect(execAsync).not.toHaveBeenCalled()
  })

  it('rejects shell syntax in remove rule before command execution', async () => {
    await expect(handleRemoveFirewallRule({
      sourceIp: '10.0.0.1',
      destNetwork: '10.0.0.0/24; id',
      firewall_engine: 'iptables',
    }, driver)).rejects.toThrow('Invalid')
    expect(execAsync).not.toHaveBeenCalled()
  })

  it('does not execute an injected policy protocol', async () => {
    const result = await handleApplyNetworkPolicy({
      firewall_engine: 'none',
      policies: [{
        id: 'injected-protocol', action: 'allow', protocol: 'tcp; id',
        target_network: '10.0.0.0/24', target_port: '443', priority: 1,
        user_ip: null, group_subnet: null, user_id: null, group_id: null,
      }],
    }, driver)

    expect(result).toEqual({ success: true, count: 0, skipped: true })
    expect(execAsync).not.toHaveBeenCalled()
  })

  it('fails when the firewall binary is missing instead of reporting success', async () => {
    execAsync.mockRejectedValueOnce(new Error('iptables: command not found'))
    await expect(handleAddFirewallRule({
      sourceIp: '10.0.0.1', destNetwork: '10.0.0.0/24', firewall_engine: 'iptables',
    }, driver)).rejects.toThrow('iptables command failed')
  })
})

/**
 * Firewall commands used to run with no timeout and no xtables lock wait. A
 * concurrent lock holder (Docker, ufw, fail2ban) made iptables block forever,
 * so the handler never returned and the task sat in 'running' indefinitely.
 */
describe('firewall command execution is bounded', () => {
  beforeEach(() => execAsync.mockReset())

  it('waits for the xtables lock instead of failing fast', async () => {
    execAsync.mockResolvedValue({ stdout: '', stderr: '' })
    await handleAddFirewallRule({
      sourceIp: '10.0.0.1', destNetwork: '10.0.0.0/24', firewall_engine: 'iptables',
    }, driver)

    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining('iptables -w 5 -A FORWARD'),
      expect.anything(),
    )
  })

  it('passes -w to remove as well, so teardown cannot wedge either', async () => {
    execAsync.mockResolvedValue({ stdout: '', stderr: '' })
    await handleRemoveFirewallRule({
      sourceIp: '10.0.0.1', destNetwork: '10.0.0.0/24', firewall_engine: 'iptables',
    }, driver)

    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining('iptables -w 5 -D FORWARD'),
      expect.anything(),
    )
  })

  it('applies a hard timeout to every firewall command', async () => {
    execAsync.mockResolvedValue({ stdout: '', stderr: '' })
    await handleAddFirewallRule({
      sourceIp: '10.0.0.1', destNetwork: '10.0.0.0/24', firewall_engine: 'iptables',
    }, driver)

    const [, options] = execAsync.mock.calls[0]!
    expect(options).toMatchObject({ timeout: 30_000 })
  })

  it('reports a wedged command as a timeout rather than a generic failure', async () => {
    // `timeout` kills the child with a signal; that is what distinguishes a
    // wedged command from one that merely exited non-zero.
    execAsync.mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }),
    )

    await expect(handleAddFirewallRule({
      sourceIp: '10.0.0.1', destNetwork: '10.0.0.0/24', firewall_engine: 'iptables',
    }, driver)).rejects.toThrow(/timed out after 30000ms/)
  })

  it('still surfaces a non-zero exit as a plain failure', async () => {
    execAsync.mockRejectedValueOnce(
      Object.assign(new Error('Bad rule'), { code: 2 }),
    )

    await expect(handleAddFirewallRule({
      sourceIp: '10.0.0.1', destNetwork: '10.0.0.0/24', firewall_engine: 'iptables',
    }, driver)).rejects.toThrow('iptables command failed: Bad rule')
  })

  it('bounds policy application commands too', async () => {
    execAsync.mockResolvedValue({ stdout: '', stderr: '' })
    await handleApplyNetworkPolicy({
      firewall_engine: 'iptables',
      vpn_type: 'openvpn',
      policies: [{
        id: 'p1', action: 'deny', protocol: 'tcp',
        target_network: '10.10.0.0/24', target_port: '3306', priority: 1,
        user_ip: null, group_subnet: null, user_id: null, group_id: null,
      }],
    }, driver)

    // Every invocation, including the probes, must carry -w and a timeout.
    const iptablesCalls = execAsync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.startsWith('iptables'),
    )
    expect(iptablesCalls.length).toBeGreaterThan(0)
    for (const [cmd, options] of iptablesCalls) {
      expect(cmd).toMatch(/^iptables(-legacy)? -w 5 /)
      expect(options).toMatchObject({ timeout: 30_000 })
    }
  })
})
