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
