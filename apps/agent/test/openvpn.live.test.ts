import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { OpenVpnDriver } from '../src/drivers/openvpn.driver'
import { handleWriteClientCcd } from '../src/handlers/write-client-ccd'
import { handleDeleteClientCcd } from '../src/handlers/delete-client-ccd'
import { handleKickSession } from '../src/handlers/kick-session'
import { handleUnkickSession } from '../src/handlers/unkick-session'

const isLinuxWithTun = (() => {
  if (process.platform !== 'linux') return false
  try {
    return fs.existsSync('/dev/net/tun')
  } catch {
    return false
  }
})()

describe.runIf(isLinuxWithTun)('OpenVPN Live Server & Driver E2E Test Suite', () => {
  let serverProc: ChildProcess | null = null
  let clientProc: ChildProcess | null = null
  let driver: OpenVpnDriver
  const mgmtSock = '/run/openvpn/server.sock'
  const ccdDir = '/etc/openvpn/ccd'
  const serverDir = '/etc/openvpn/server'
  const easyrsaDir = '/etc/openvpn/easy-rsa'

  beforeAll(async () => {
    // 1. Setup directories
    fs.mkdirSync('/run/openvpn', { recursive: true })
    fs.mkdirSync(ccdDir, { recursive: true })
    fs.mkdirSync(serverDir, { recursive: true })
    fs.mkdirSync(easyrsaDir, { recursive: true })

    // 2. Initialize EasyRSA PKI & generate CA + server cert + dh + tls-crypt
    if (!fs.existsSync(`${easyrsaDir}/easyrsa`)) {
      execSync('cp -r /usr/share/easy-rsa/* /etc/openvpn/easy-rsa/ || true')
    }
    const easyrsaBin = `${easyrsaDir}/easyrsa`
    if (fs.existsSync(easyrsaBin)) {
      execSync(`${easyrsaBin} init-pki`, { cwd: easyrsaDir, stdio: 'ignore' })
      execSync(`EASYRSA_BATCH=1 ${easyrsaBin} build-ca nopass`, { cwd: easyrsaDir, stdio: 'ignore' })
      execSync(`EASYRSA_BATCH=1 ${easyrsaBin} build-server-full server nopass`, { cwd: easyrsaDir, stdio: 'ignore' })
      execSync(`EASYRSA_BATCH=1 ${easyrsaBin} gen-crl`, { cwd: easyrsaDir, stdio: 'ignore' })

      fs.copyFileSync(`${easyrsaDir}/pki/ca.crt`, `${serverDir}/ca.crt`)
      fs.copyFileSync(`${easyrsaDir}/pki/issued/server.crt`, `${serverDir}/server.crt`)
      fs.copyFileSync(`${easyrsaDir}/pki/private/server.key`, `${serverDir}/server.key`)
      fs.copyFileSync(`${easyrsaDir}/pki/crl.pem`, `${serverDir}/crl.pem`)
    }

    execSync(`openvpn --genkey secret ${serverDir}/tls-crypt.key`, { stdio: 'ignore' })

    // 3. Create server.conf with management unix socket
    const serverConf = `
port 11194
proto udp
dev tun99
ca ${serverDir}/ca.crt
cert ${serverDir}/server.crt
key ${serverDir}/server.key
dh none
tls-crypt ${serverDir}/tls-crypt.key
server 10.8.99.0 255.255.255.0
topology subnet
client-config-dir ${ccdDir}
management ${mgmtSock} unix
status /run/openvpn/status.log 1
status-version 3
verb 1
`
    fs.writeFileSync(`${serverDir}/server.conf`, serverConf)

    // 4. Start OpenVPN server process
    serverProc = spawn('openvpn', ['--config', `${serverDir}/server.conf`], {
      stdio: 'pipe',
    })

    // Wait for management socket to be ready
    let retries = 50
    while (retries > 0 && !fs.existsSync(mgmtSock)) {
      await new Promise((r) => setTimeout(r, 200))
      retries--
    }

    if (!fs.existsSync(mgmtSock)) {
      throw new Error('OpenVPN management socket failed to appear within 10s')
    }

    driver = new OpenVpnDriver(mgmtSock)
  }, 60000)

  afterAll(async () => {
    clientProc?.kill('SIGTERM')
    if (driver && driver.isConnected()) {
      await driver.disconnect()
    }
    if (serverProc) {
      serverProc.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 500))
    }
    try {
      if (fs.existsSync(mgmtSock)) fs.unlinkSync(mgmtSock)
    } catch {}
  })

  it('connects to real OpenVPN daemon management socket', async () => {
    await driver.connect()
    expect(driver.isConnected()).toBe(true)
  })

  it('queries real server version and status via management socket', async () => {
    const info = await driver.getServerInfo()
    expect(info.version).toContain('OpenVPN')
    expect(typeof info.uptime).toBe('number')

    const clients = await driver.getClients()
    expect(Array.isArray(clients)).toBe(true)
  })

  it('creates user certificate via EasyRSA', async () => {
    const res = await driver.createUser('testuser_ovpn')
    expect(res.username).toBe('testuser_ovpn')
    expect(fs.existsSync(`${easyrsaDir}/pki/issued/testuser_ovpn.crt`)).toBe(true)
  })

  it('writes and deletes client CCD file safely', async () => {
    const writeRes = await handleWriteClientCcd({
      username: 'testuser_ovpn',
      vpn_ip: '10.8.99.10',
      extra_lines: ['push "route 192.168.10.0 255.255.255.0"'],
    }, driver)

    expect(writeRes.success).toBe(true)
    const ccdFile = path.join(ccdDir, 'testuser_ovpn')
    expect(fs.existsSync(ccdFile)).toBe(true)
    const content = fs.readFileSync(ccdFile, 'utf-8')
    expect(content).toContain('ifconfig-push 10.8.99.10')
    expect(content).toContain('push "route 192.168.10.0 255.255.255.0"')

    const delRes = await handleDeleteClientCcd({
      username: 'testuser_ovpn',
    }, driver)
    expect(delRes.success).toBe(true)
    expect(fs.existsSync(ccdFile)).toBe(false)
  })

  it('connects a real OpenVPN client and carries ICMP traffic through the tunnel', async () => {
    const clientDir = '/run/openvpn/live-client'
    fs.mkdirSync(clientDir, { recursive: true })
    const clientConf = `${clientDir}/client.conf`
    fs.writeFileSync(clientConf, `
client
dev tun98
proto udp
remote 127.0.0.1 11194
nobind
persist-key
persist-tun
remote-cert-tls server
verb 1
<ca>
${fs.readFileSync(`${easyrsaDir}/pki/ca.crt`, 'utf-8').trim()}
</ca>
<cert>
${fs.readFileSync(`${easyrsaDir}/pki/issued/testuser_ovpn.crt`, 'utf-8').trim()}
</cert>
<key>
${fs.readFileSync(`${easyrsaDir}/pki/private/testuser_ovpn.key`, 'utf-8').trim()}
</key>
<tls-crypt>
${fs.readFileSync(`${serverDir}/tls-crypt.key`, 'utf-8').trim()}
</tls-crypt>
`)

    clientProc = spawn('openvpn', ['--config', clientConf], { stdio: 'pipe' })
    let clients = []
    for (let attempt = 0; attempt < 50; attempt++) {
      clients = await driver.getClients()
      if (clients.some((client) => client.commonName === 'testuser_ovpn')) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    expect(clients.some((client) => client.commonName === 'testuser_ovpn')).toBe(true)
    expect(() => execSync('ping -c 2 -W 1 10.8.99.1', { stdio: 'ignore' })).not.toThrow()
  }, 20000)

  it('kicks an active live client using the management connection without delay', async () => {
    const start = Date.now()
    const kickRes = await handleKickSession({
      common_name: 'testuser_ovpn',
      permanent: true,
    }, driver)

    const duration = Date.now() - start
    expect(kickRes.kicked).toBe(true)
    expect(kickRes.kill_method).toBe('driver')
    expect(duration).toBeLessThan(1000)

    let remainingClients = []
    for (let attempt = 0; attempt < 25; attempt++) {
      remainingClients = await driver.getClients()
      if (!remainingClients.some((client) => client.commonName === 'testuser_ovpn')) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(remainingClients.some((client) => client.commonName === 'testuser_ovpn')).toBe(false)

    // Verify permanent kick created disable file in CCD
    const ccdFile = path.join(ccdDir, 'testuser_ovpn')
    expect(fs.existsSync(ccdFile)).toBe(true)
    expect(fs.readFileSync(ccdFile, 'utf-8')).toContain('disable')

    // Unkick
    const unkickRes = await handleUnkickSession({
      common_name: 'testuser_ovpn',
    }, driver)
    expect(unkickRes.unkicked).toBe(true)
    expect(fs.existsSync(ccdFile)).toBe(false)
  })
})
