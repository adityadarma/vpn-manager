import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WireGuardDriver } from '../src/drivers/wireguard.driver'
import { handleWriteClientCcd } from '../src/handlers/write-client-ccd'
import { handleDeleteClientCcd } from '../src/handlers/delete-client-ccd'
import { handleKickSession } from '../src/handlers/kick-session'

const hasWireGuard = (() => {
  try {
    execSync('which wg', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

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

describe.skipIf(!hasWireGuard)('WireGuardDriver System Tests (Requires wg CLI)', () => {
  let tmpDir: string
  let driver: WireGuardDriver

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-e2e-'))
    driver = new WireGuardDriver('wg-test-dummy')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates real client keypair using wg genkey and pubkey', async () => {
    const cert = await driver.generateClientCert('alice')
    expect(cert.clientKey).toBeDefined()
    expect(cert.clientCert).toBeDefined()
    expect(cert.clientCert.length).toBeGreaterThan(40)
    expect(cert.clientKey.length).toBeGreaterThan(40)

    const expectedPub = execSync('wg pubkey', { input: cert.clientKey + '\n', encoding: 'utf-8' }).trim()
    expect(cert.clientCert).toBe(expectedPub)
  })

  it('generates valid client configuration file format', async () => {
    const pubKeyPath = '/etc/wireguard/publickey'
    let createdFakePub = false
    if (!fs.existsSync('/etc/wireguard')) {
      fs.mkdirSync('/etc/wireguard', { recursive: true })
    }
    if (!fs.existsSync(pubKeyPath)) {
      fs.writeFileSync(pubKeyPath, 'ServerDummyPublicKeyBase64String1234567890=\n')
      createdFakePub = true
    }

    try {
      const config = await driver.generateClientConfig('bob', {
        serverIp: '198.51.100.1',
        serverPort: 51820,
        clientPrivateKey: 'ClientDummyPrivateKeyBase64String1234567890=',
        clientVpnIp: '10.9.0.2',
        dns: '1.1.1.1',
      })

      expect(config).toContain('[Interface]')
      expect(config).toContain('PrivateKey = ClientDummyPrivateKeyBase64String1234567890=')
      expect(config).toContain('Address = 10.9.0.2/32')
      expect(config).toContain('[Peer]')
      expect(config).toContain('Endpoint = 198.51.100.1:51820')
    } finally {
      if (createdFakePub && fs.existsSync(pubKeyPath)) {
        fs.unlinkSync(pubKeyPath)
      }
    }
  })
})
