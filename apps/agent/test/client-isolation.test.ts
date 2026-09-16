import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const { execFileAsync, spawnMock } = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: spawnMock }))
vi.mock('node:util', () => ({ promisify: () => execFileAsync }))

import { applyClientIsolation } from '../src/services/client-isolation'

describe('client isolation', () => {
  beforeEach(() => {
    execFileAsync.mockReset().mockResolvedValue({ stdout: '', stderr: '' })
    spawnMock.mockReset().mockImplementation(() => {
      const stderr = new EventEmitter()
      let close: ((code: number) => void) | undefined
      return {
        stderr,
        once: (event: string, callback: (code: number) => void) => {
          if (event === 'close') close = callback
        },
        stdin: { end: () => close?.(0) },
      }
    })
  })

  it('installs an OpenVPN same-interface drop rule when client access is disabled', async () => {
    await applyClientIsolation('openvpn', 'iptables', false)

    expect(execFileAsync).toHaveBeenLastCalledWith('iptables', [
      '-I',
      'FORWARD',
      '1',
      '-i',
      'tun+',
      '-o',
      'tun+',
      '-j',
      'DROP',
    ])
  })

  it('removes the isolation rule when client access is enabled', async () => {
    await applyClientIsolation('wireguard', 'ufw', true)

    expect(execFileAsync).toHaveBeenCalledWith('iptables', [
      '-D',
      'FORWARD',
      '-i',
      'wg+',
      '-o',
      'wg+',
      '-j',
      'DROP',
    ])
  })

  it('persists firewalld isolation with a direct rule', async () => {
    await applyClientIsolation('openvpn', 'firewalld', false)

    expect(execFileAsync).toHaveBeenCalledWith('firewall-cmd', [
      '--permanent',
      '--direct',
      '--add-rule',
      'ipv4',
      'filter',
      'FORWARD',
      '0',
      '-i',
      'tun+',
      '-o',
      'tun+',
      '-j',
      'VPN_CLIENT_ISOLATION',
    ])
  })

  it('rejects disabled client access without a firewall', async () => {
    await expect(applyClientIsolation('wireguard', 'none', false)).rejects.toThrow(
      'firewall engine is required',
    )
    expect(execFileAsync).not.toHaveBeenCalled()
  })
})
