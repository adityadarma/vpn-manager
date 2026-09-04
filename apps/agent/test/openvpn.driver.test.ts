import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { OpenVpnDriver } from '../src/drivers/openvpn.driver'
import { handleWriteClientCcd } from '../src/handlers/write-client-ccd'
import { handleDeleteClientCcd } from '../src/handlers/delete-client-ccd'
import { handleKickSession } from '../src/handlers/kick-session'

describe('OpenVpnDriver Unit Tests (Mock Socket)', () => {
  let tmpDir: string
  let socketPath: string
  let server: net.Server
  let driver: OpenVpnDriver
  let lastReceivedCommand = ''
  let receivedCommands: string[] = []
  let activeSocket: net.Socket | null = null
  let connectionCount = 0

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovpn-unit-'))
    socketPath = path.join(tmpDir, 'test.sock')
    receivedCommands = []
    lastReceivedCommand = ''
    connectionCount = 0

    server = net.createServer((socket) => {
      connectionCount++
      activeSocket = socket
      socket.write('>INFO:OpenVPN Management Interface Version 5\r\n')

      let buffer = ''
      socket.on('data', (data) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          lastReceivedCommand = trimmed
          receivedCommands.push(trimmed)

          if (trimmed === 'state on') {
            socket.write('SUCCESS: real-time state notification set to ON\r\n')
          } else if (trimmed === 'version') {
            socket.write('OpenVPN Version: OpenVPN 2.6.0\r\nManagement Version: 5\r\nEND\r\n')
          } else if (trimmed === 'status 3') {
            socket.write('TITLE\tOpenVPN 2.6.0\r\nHEADER\tCLIENT_LIST\tCommon Name\tReal Address\tVirtual Address\tVirtual IPv6 Address\tBytes Received\tBytes Sent\tConnected Since\tConnected Since (time_t)\r\nCLIENT_LIST\tclient_alice\t1.2.3.4:1194\t10.8.0.10\t\t1000\t2000\t2026-01-01 00:00:00\t1767225600\r\nEND\r\n')
          } else if (trimmed === 'hang') {
            // Deliberately leave the active command unanswered.
          } else if (trimmed === 'drop') {
            socket.destroy()
          } else if (trimmed === 'notify') {
            socket.write('>STATE:123,CONNECTED,SUCCESS,10.8.0.1,1.2.3.4,1194\r\nresponse line\r\nEND\r\n')
          } else if (trimmed.startsWith('kill ')) {
            const cn = trimmed.replace('kill ', '')
            socket.write(`SUCCESS: common name '${cn}' found, 1 client(s) killed\r\n`)
          } else {
            socket.write('SUCCESS: OK\r\n')
          }
        }
      })
    })

    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    driver = new OpenVpnDriver(socketPath)
  })

  afterEach(async () => {
    await driver.disconnect()
    if (activeSocket) activeSocket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('connects to management socket and enables state on without sending log on all (Bug A)', async () => {
    await driver.connect()
    expect(driver.isConnected()).toBe(true)
    expect(receivedCommands).toContain('state on')
    // Crucial Bug A verification: log on all must NOT be sent during connect
    expect(receivedCommands).not.toContain('log on all')
  })

  it('retrieves server info with parsed version and uptime', async () => {
    await driver.connect()
    const info = await driver.getServerInfo()
    expect(info.version).toContain('OpenVPN 2.6.0')
  })

  it('parses getClients output correctly', async () => {
    await driver.connect()
    const clients = await driver.getClients()
    expect(clients.length).toBe(1)
    expect(clients[0].commonName).toBe('client_alice')
    expect(clients[0].virtualAddress).toBe('10.8.0.10')
    expect(clients[0].bytesReceived).toBe(1000)
    expect(clients[0].bytesSent).toBe(2000)
  })

  it('kickSession uses primary driver connection (no 8s raw socket delay) (Bug B)', async () => {
    await driver.connect()
    const start = Date.now()
    const result = await driver.kickSession('client_alice')
    const duration = Date.now() - start

    expect(result.kicked).toBe(true)
    expect(result.kill_method).toBe('driver')
    expect(duration).toBeLessThan(1000)
    expect(receivedCommands).toContain('kill client_alice')
  })

  it('rejects commands when not connected', async () => {
    await expect(driver.getServerInfo()).rejects.toThrow('Not connected to OpenVPN management interface')
  })

  it('removes a timed-out command and processes the next queued command', async () => {
    driver = new OpenVpnDriver(socketPath, 5000, 30)
    await driver.connect()

    const timedOut = driver.sendCommand('hang')
    const next = driver.sendCommand('after-timeout')

    await expect(timedOut).rejects.toThrow('Command timeout: hang')
    await expect(next).resolves.toBe('SUCCESS: OK')
    expect(receivedCommands.slice(-2)).toEqual(['hang', 'after-timeout'])
  })

  it('rejects every pending command and clears connection state on socket loss', async () => {
    await driver.connect()

    const active = driver.sendCommand('drop')
    const queued = driver.sendCommand('queued-after-drop')

    await expect(active).rejects.toThrow('OpenVPN management socket closed')
    await expect(queued).rejects.toThrow('OpenVPN management socket closed')
    expect(driver.isConnected()).toBe(false)
    await expect(driver.sendCommand('not-sent')).rejects.toThrow('Not connected')
    expect(receivedCommands).not.toContain('queued-after-drop')
  })

  it('shares one in-flight connection attempt across concurrent connect calls', async () => {
    const first = driver.connect()
    const second = driver.connect()

    expect(second).toBe(first)
    await Promise.all([first, second])
    expect(connectionCount).toBe(1)
    expect(receivedCommands.filter(command => command === 'state on')).toHaveLength(1)
  })

  it('cancels a scheduled reconnect when disconnect is requested', async () => {
    driver = new OpenVpnDriver(socketPath, 30)
    await driver.connect()
    const disconnected = new Promise<void>((resolve) => driver.once('disconnected', resolve))
    activeSocket?.destroy()

    await disconnected
    await driver.disconnect()
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(connectionCount).toBe(1)
    expect(driver.isConnected()).toBe(false)
  })

  it('does not include unsolicited management notifications in command responses', async () => {
    await driver.connect()

    await expect(driver.sendCommand('notify')).resolves.toBe('response line\n')
  })

  it('rejects path traversal and invalid commonName on handlers', async () => {
    await expect(handleWriteClientCcd({
      username: '../malicious_user',
      vpn_ip: '10.8.0.10'
    }, driver)).rejects.toThrow('Invalid username')

    await expect(handleKickSession({
      common_name: 'alice\r\nkill bob'
    }, driver)).rejects.toThrow('Invalid common_name')
  })
})
