import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { WireGuardDriver } from '../src/drivers/wireguard.driver'
import { handleWriteClientCcd } from '../src/handlers/write-client-ccd'
import { handleDeleteClientCcd } from '../src/handlers/delete-client-ccd'
import { handleKickSession } from '../src/handlers/kick-session'
import { handleUnkickSession } from '../src/handlers/unkick-session'

const isLinuxWithNetAdmin = (() => {
  if (process.platform !== 'linux') return false
  try {
    execSync('which wg && ip link add dev wgtest_probe type wireguard && ip link del dev wgtest_probe', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const hasNetworkNamespace = (() => {
  if (!isLinuxWithNetAdmin) return false
  try {
    execSync('ip netns add wgtest_probe_ns && ip netns del wgtest_probe_ns', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.runIf(isLinuxWithNetAdmin && hasNetworkNamespace)('WireGuard Live Server & Driver E2E Test Suite', () => {
  const iface = 'wgtest0'
  const clientIface = 'wgtest1'
  const serverTransport = 'vethwgsrv'
  const clientTransport = 'vethwgcli'
  const clientNamespace = 'wgclientns'
  let driver: WireGuardDriver
  let serverPrivKey: string
  let serverPubKey: string

  beforeAll(() => {
    // 1. Setup /etc/wireguard directory and server keys
    if (!fs.existsSync('/etc/wireguard')) {
      fs.mkdirSync('/etc/wireguard', { recursive: true })
    }

    serverPrivKey = execSync('wg genkey', { encoding: 'utf-8' }).trim()
    serverPubKey = execSync('wg pubkey', { input: serverPrivKey + '\n', encoding: 'utf-8' }).trim()
    fs.writeFileSync('/etc/wireguard/privatekey', serverPrivKey)
    fs.writeFileSync('/etc/wireguard/publickey', serverPubKey)

    // 2. Create wgtest0 interface
    execSync(`ip link add dev ${iface} type wireguard`)
    fs.writeFileSync(`/tmp/${iface}.key`, serverPrivKey)
    execSync(`wg set ${iface} listen-port 51829 private-key /tmp/${iface}.key`)
    execSync(`ip addr add 10.9.0.1/24 dev ${iface}`)
    execSync(`ip link set dev ${iface} up`)
    execSync(`ip link add ${serverTransport} type veth peer name ${clientTransport}`)
    execSync(`ip addr add 192.0.2.1/24 dev ${serverTransport}`)
    execSync(`ip netns add ${clientNamespace}`)
    execSync(`ip link set ${clientTransport} netns ${clientNamespace}`)
    execSync(`ip link set dev ${serverTransport} up`)
    execSync(`ip netns exec ${clientNamespace} ip addr add 192.0.2.2/24 dev ${clientTransport}`)
    execSync(`ip netns exec ${clientNamespace} ip link set lo up`)
    execSync(`ip netns exec ${clientNamespace} ip link set dev ${clientTransport} up`)

    // 3. Save dummy config to /etc/wireguard/wgtest0.conf for sync/reload tests
    const confContent = `[Interface]\nPrivateKey = ${serverPrivKey}\nAddress = 10.9.0.1/24\nListenPort = 51829\n`
    fs.writeFileSync(`/etc/wireguard/${iface}.conf`, confContent)

    driver = new WireGuardDriver(iface)
  })

  afterAll(() => {
    try {
      execSync(`ip link del dev ${clientIface}`, { stdio: 'ignore' })
    } catch {}
    try {
      execSync(`ip netns del ${clientNamespace}`, { stdio: 'ignore' })
    } catch {}
    try {
      execSync(`ip link del dev ${serverTransport}`, { stdio: 'ignore' })
    } catch {}
    try {
      execSync(`ip link del dev ${iface}`, { stdio: 'ignore' })
    } catch {}
    try {
      fs.unlinkSync(`/etc/wireguard/${iface}.conf`)
      fs.unlinkSync(`/tmp/${iface}.key`)
    } catch {}
  })

  it('connects to real WireGuard interface', async () => {
    await driver.connect()
    expect(driver.isConnected()).toBe(true)
  })

  it('retrieves real server info via wg and /proc/uptime', async () => {
    const info = await driver.getServerInfo()
    expect(info.version).toMatch(/WireGuard/)
    expect(typeof info.uptime).toBe('number')
  })

  it('generates real client keypair and full client config file', async () => {
    const cert = await driver.generateClientCert('alice_wg')
    expect(cert.clientKey).toBeDefined()
    expect(cert.clientCert).toBeDefined()

    const config = await driver.generateClientConfig('alice_wg', {
      serverIp: '192.168.1.100',
      serverPort: 51829,
      clientPrivateKey: cert.clientKey,
      clientVpnIp: '10.9.0.2',
    })

    expect(config).toContain(`PrivateKey = ${cert.clientKey}`)
    expect(config).toContain(`PublicKey = ${serverPubKey}`)
    expect(config).toContain('Address = 10.9.0.2/32')
    expect(config).toContain('Endpoint = 192.168.1.100:51829')
  })

  it('injects peer via writeClientConfig / handler into live kernel table', async () => {
    const cert = await driver.generateClientCert('bob_wg')

    const writeRes = await handleWriteClientCcd({
      username: 'bob_wg',
      vpn_ip: '10.9.0.5',
      public_key: cert.clientCert,
    }, driver)

    expect(writeRes.success).toBe(true)

    // Verify directly with wg show dump
    const dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).toContain(cert.clientCert)
    expect(dump).toContain('10.9.0.5/32')
  })

  it('connects a real WireGuard client peer and carries ICMP traffic through the tunnel', async () => {
    const clientPrivateKey = execSync('wg genkey', { encoding: 'utf-8' }).trim()
    const clientPublicKey = execSync('wg pubkey', { input: `${clientPrivateKey}\n`, encoding: 'utf-8' }).trim()
    const keyPath = `/tmp/${clientIface}.key`
    fs.writeFileSync(keyPath, clientPrivateKey)

    await driver.writeClientConfig('traffic_wg', '10.9.0.2', { publicKey: clientPublicKey })
    execSync(`ip netns exec ${clientNamespace} ip link add dev ${clientIface} type wireguard`)
    execSync(`ip netns exec ${clientNamespace} wg set ${clientIface} private-key ${keyPath} peer ${serverPubKey} endpoint 192.0.2.1:51829 allowed-ips 10.9.0.1/32 persistent-keepalive 1`)
    execSync(`ip netns exec ${clientNamespace} ip addr add 10.9.0.2/32 dev ${clientIface}`)
    execSync(`ip netns exec ${clientNamespace} ip link set dev ${clientIface} up`)
    execSync(`ip netns exec ${clientNamespace} ip route add 10.9.0.1/32 dev ${clientIface}`)

    let connected = false
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        execSync(`ip netns exec ${clientNamespace} ping -I ${clientIface} -c 1 -W 1 10.9.0.1`, { stdio: 'ignore' })
        connected = true
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    expect(connected).toBe(true)
    const beforeKick = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(beforeKick).toContain(clientPublicKey)
    const clientRow = beforeKick.trim().split('\n')
      .map((line) => line.split('\t'))
      .find((columns) => columns[0] === clientPublicKey)
    // wg dump column 4 is the latest handshake Unix timestamp. A positive
    // value proves the client exchanged real encrypted tunnel packets.
    expect(Number(clientRow?.[4])).toBeGreaterThan(0)

    const kickResult = await driver.kickSession('traffic_wg', {
      permanent: true,
      publicKey: clientPublicKey,
    })
    expect(kickResult.kicked).toBe(true)
    expect(() => execSync(`ip netns exec ${clientNamespace} ping -I ${clientIface} -c 1 -W 1 10.9.0.1`, { stdio: 'ignore' })).toThrow()

    execSync(`ip netns del ${clientNamespace}`)
    fs.unlinkSync(keyPath)
  }, 20000)

  it('kicks peer temporarily and permanently from live interface', async () => {
    const cert = await driver.generateClientCert('charlie_wg')

    // Inject peer first
    await driver.writeClientConfig('charlie_wg', '10.9.0.6', { publicKey: cert.clientCert })
    let dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).toContain(cert.clientCert)

    // Temp kick
    const kickRes = await handleKickSession({
      common_name: 'charlie_wg',
      public_key: cert.clientCert,
      vpn_ip: '10.9.0.6',
      permanent: false,
    }, driver)

    expect(kickRes.kicked).toBe(true)
    expect(kickRes.kill_method).toBe('wg_temp_remove')

    // Wait for restore
    await new Promise((r) => setTimeout(r, 2200))
    dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).toContain(cert.clientCert)

    // A permanent kick must cancel an outstanding temporary restore timer.
    const racedTempKick = await handleKickSession({
      common_name: 'charlie_wg',
      public_key: cert.clientCert,
      vpn_ip: '10.9.0.6',
      permanent: false,
    }, driver)
    expect(racedTempKick.kicked).toBe(true)

    const permKickRes = await handleKickSession({
      common_name: 'charlie_wg',
      public_key: cert.clientCert,
      permanent: true,
    }, driver)

    expect(permKickRes.kicked).toBe(true)
    expect(permKickRes.kill_method).toBe('wg_remove')

    dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).not.toContain(cert.clientCert)
    await new Promise((r) => setTimeout(r, 2200))
    dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).not.toContain(cert.clientCert)
  })

  it('unkicks/restores peer into live interface', async () => {
    const cert = await driver.generateClientCert('david_wg')

    const unkickRes = await handleUnkickSession({
      common_name: 'david_wg',
      public_key: cert.clientCert,
      vpn_ip: '10.9.0.7',
    }, driver)

    expect(unkickRes.unkicked).toBe(true)
    const dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).toContain(cert.clientCert)
    expect(dump).toContain('10.9.0.7/32')
  })

  it('deletes client config via handler', async () => {
    const cert = await driver.generateClientCert('eve_wg')
    await driver.writeClientConfig('eve_wg', '10.9.0.8', { publicKey: cert.clientCert })

    const delRes = await handleDeleteClientCcd({
      username: 'eve_wg',
      public_key: cert.clientCert,
    }, driver)

    expect(delRes.success).toBe(true)
    const dump = execSync(`wg show ${iface} dump`, { encoding: 'utf-8' })
    expect(dump).not.toContain(cert.clientCert)
  })
})
