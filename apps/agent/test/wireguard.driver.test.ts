import { describe, it, expect, beforeEach } from 'vitest'
import { WireGuardDriver } from '../src/drivers/wireguard.driver'
import { handleWriteClientCcd } from '../src/handlers/write-client-ccd'
import { handleKickSession } from '../src/handlers/kick-session'

describe('WireGuardDriver Handler & Security Tests (Mock/Local)', () => {
  let driver: WireGuardDriver

  beforeEach(() => {
    driver = new WireGuardDriver('wg-test-dummy')
  })

  it('rejects invalid inputs on handlers before touching driver', async () => {
    await expect(handleWriteClientCcd({
      username: '../malicious_path',
      vpn_ip: '10.9.0.2',
      public_key: 'ValidKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    }, driver)).rejects.toThrow('Invalid username')

    await expect(handleKickSession({
      common_name: 'alice; rm -rf /',
      public_key: 'ValidKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    }, driver)).rejects.toThrow('Invalid common_name')
  })

  it('parses wg dump output correctly in getClients()', () => {
    const dump = [
      'wg0\tPRIVATE_KEY\tPUBLIC_KEY\t51820\t0',
      'PEER_PUBKEY_11111111111111111111111111111111\t(none)\t198.51.100.2:45000\t10.9.0.2/32\t' + Math.floor(Date.now() / 1000) + '\t1024\t2048\t25',
      'PEER_PUBKEY_OLD_INACTIVE_22222222222222222222\t(none)\t198.51.100.3:45000\t10.9.0.3/32\t100000\t500\t500\t25',
    ].join('\n')

    // Call private parseWgDump via reflection
    const parsed = (driver as any).parseWgDump(dump)
    expect(parsed.length).toBe(1)
    expect(parsed[0].commonName).toBe('PEER_PUBKEY_1111')
    expect(parsed[0].virtualAddress).toBe('10.9.0.2/32')
    expect(parsed[0].bytesReceived).toBe(1024)
    expect(parsed[0].bytesSent).toBe(2048)
  })
})
