import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import type {
  VpnDriver,
  VpnClient,
  VpnServerInfo,
  VpnStatus,
  VpnMetrics,
} from './vpn-driver.interface'

const execAsync = promisify(exec)

/**
 * WireGuard Driver
 * 
 * Communicates with WireGuard via wg command-line tool
 * 
 * Requirements:
 * - WireGuard installed (wg command available)
 * - Proper permissions to run wg commands
 * 
 * Reference:
 * - https://www.wireguard.com/
 */
export class WireGuardDriver extends EventEmitter implements VpnDriver {
  private connected = false
  private interfaceName: string

  constructor(interfaceName: string = 'wg0') {
    super()
    this.interfaceName = interfaceName
  }

  async connect(): Promise<void> {
    try {
      // Check if WireGuard interface exists
      await execAsync(`wg show ${this.interfaceName}`)
      this.connected = true
      console.log(`[wireguard-driver] Connected to interface ${this.interfaceName}`)
      this.emit('connected')
    } catch (err) {
      throw new Error(`Failed to connect to WireGuard interface ${this.interfaceName}: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.emit('disconnected')
  }

  isConnected(): boolean {
    return this.connected
  }

  async getServerInfo(): Promise<VpnServerInfo> {
    const { stdout } = await execAsync('wg --version')
    const versionMatch = stdout.match(/wireguard-tools v(\S+)/)
    const version = versionMatch ? versionMatch[1] : 'unknown'

    // Get interface uptime (approximate from system uptime)
    const { stdout: uptimeOutput } = await execAsync('cat /proc/uptime')
    const uptime = parseInt(uptimeOutput.split(' ')[0], 10)

    return {
      version: `WireGuard ${version}`,
      uptime,
      mode: 'server',
    }
  }

  async getClients(): Promise<VpnClient[]> {
    try {
      const { stdout } = await execAsync(`wg show ${this.interfaceName} dump`)
      return this.parseWgDump(stdout)
    } catch (err) {
      console.error('[wireguard-driver] Failed to get clients:', (err as Error).message)
      return []
    }
  }

  private parseWgDump(dump: string): VpnClient[] {
    const clients: VpnClient[] = []
    const lines = dump.trim().split('\n')

    // Skip first line (interface info)
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t')
      
      if (parts.length >= 8) {
        // WireGuard dump format:
        // 0: public-key
        // 1: preshared-key
        // 2: endpoint
        // 3: allowed-ips
        // 4: latest-handshake (unix timestamp)
        // 5: transfer-rx (bytes)
        // 6: transfer-tx (bytes)
        // 7: persistent-keepalive

        const publicKey = parts[0]
        const endpoint = parts[2] || 'unknown'
        const allowedIps = parts[3] || 'unknown'
        const lastHandshake = parseInt(parts[4], 10)
        const bytesReceived = parseInt(parts[5], 10) || 0
        const bytesSent = parseInt(parts[6], 10) || 0

        // Only include active clients (handshake within last 3 minutes)
        const now = Math.floor(Date.now() / 1000)
        if (lastHandshake > 0 && (now - lastHandshake) < 180) {
          clients.push({
            commonName: publicKey.substring(0, 16), // Use first 16 chars of public key as identifier
            realAddress: endpoint,
            virtualAddress: allowedIps.split(',')[0], // First allowed IP
            bytesReceived,
            bytesSent,
            connectedSince: new Date(lastHandshake * 1000),
            lastActivity: new Date(lastHandshake * 1000),
          })
        }
      }
    }

    return clients
  }

  private async resolvePeerPublicKey(commonName: string): Promise<string> {
    const normalized = commonName.trim()
    if (!normalized) {
      throw new Error('Missing peer identifier')
    }

    // Full public key is typically 44 chars base64 and ends with "=".
    if (normalized.length >= 40) {
      return normalized
    }

    const { stdout } = await execAsync(`wg show ${this.interfaceName} dump`)
    const lines = stdout.trim().split('\n').slice(1) // Skip interface row
    const matches: string[] = []

    for (const line of lines) {
      const parts = line.split('\t')
      const publicKey = parts[0]?.trim()
      if (!publicKey) continue

      if (publicKey.startsWith(normalized)) {
        matches.push(publicKey)
      }
    }

    if (matches.length === 0) {
      throw new Error(`No WireGuard peer found for identifier: ${normalized}`)
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous peer identifier: ${normalized} (matched ${matches.length} peers)`)
    }

    return matches[0]
  }

  async disconnectClient(commonName: string): Promise<void> {
    try {
      const publicKey = await this.resolvePeerPublicKey(commonName)
      await execAsync(`wg set ${this.interfaceName} peer ${publicKey} remove`)
      console.log(`[wireguard-driver] Removed peer ${publicKey.substring(0, 16)}... from ${this.interfaceName}`)
    } catch (err) {
      throw new Error(`Failed to disconnect client ${commonName}: ${(err as Error).message}`)
    }
  }

  async getStatus(): Promise<VpnStatus> {
    const [serverInfo, clients] = await Promise.all([
      this.getServerInfo(),
      this.getClients(),
    ])

    return {
      state: this.connected ? 'connected' : 'disconnected',
      clients,
      serverInfo,
    }
  }

  async getMetrics(): Promise<VpnMetrics> {
    const clients = await this.getClients()
    const serverInfo = await this.getServerInfo()

    const totalBytesReceived = clients.reduce((sum, client) => sum + client.bytesReceived, 0)
    const totalBytesSent = clients.reduce((sum, client) => sum + client.bytesSent, 0)

    return {
      totalClients: clients.length,
      totalBytesReceived,
      totalBytesSent,
      uptime: serverInfo.uptime,
    }
  }

  async sendCommand(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`wg ${command}`)
      return stdout
    } catch (err) {
      throw new Error(`WireGuard command failed: ${(err as Error).message}`)
    }
  }
}
