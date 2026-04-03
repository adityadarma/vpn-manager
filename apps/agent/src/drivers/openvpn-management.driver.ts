import net from 'node:net'
import { EventEmitter } from 'node:events'
import type {
  VpnDriver,
  VpnClient,
  VpnServerInfo,
  VpnStatus,
  VpnMetrics,
} from './vpn-driver.interface'

/**
 * OpenVPN Management Interface Driver
 * 
 * Communicates with OpenVPN via Unix socket
 * 
 * Unix Socket: /run/openvpn/server.sock
 * 
 * Protocol Reference:
 * - https://openvpn.net/community-resources/management-interface/
 */
export class OpenVpnManagementDriver extends EventEmitter implements VpnDriver {
  private socket: net.Socket | null = null
  private connected = false
  private buffer = ''
  private commandQueue: Array<{ command: string; resolve: (value: string) => void; reject: (error: Error) => void; buffer: string }> = []
  private isProcessing = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10

  // Accumulate >CLIENT:ENV lines per CID until ENV,END
  private pendingEnv: Map<string, Record<string, string>> = new Map()

  // Cache CID → client info so disconnect events still have username/IP
  private clientCache: Map<string, { username: string; vpnIp: string; realIp: string }> = new Map()

  constructor(
    private socketPath: string = '/run/openvpn/server.sock',
    private reconnectInterval: number = 5000,
  ) {
    super()
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()

      this.socket.on('connect', async () => {
        console.log(`[openvpn-driver] Connected to management interface`)
        
        // Set connected BEFORE sending commands
        this.connected = true
        
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0
        
        // Enable realtime event notifications
        try {
          await this.sendCommand('state on')
          await this.sendCommand('log on all')
        } catch (err) {
          console.warn('[openvpn-driver] Failed to enable events:', err)
        }

        this.emit('connected')
        resolve()
      })

      this.socket.on('data', (data) => {
        this.handleData(data.toString())
      })

      this.socket.on('error', (err) => {
        console.error('[openvpn-driver] Socket error:', err.message)
        this.connected = false
        this.emit('error', err)
        
        if (!this.connected) {
          reject(err)
        }
      })

      this.socket.on('close', () => {
        this.connected = false
        this.emit('disconnected')
        
        // Auto-reconnect with exponential backoff
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const backoffDelay = Math.min(
            this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts),
            30000 // Max 30 seconds
          )
          
          this.reconnectAttempts++
          
          console.log(`[openvpn-driver] Reconnecting in ${Math.round(backoffDelay/1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
          
          setTimeout(() => {
            if (!this.connected) {
              this.connect().catch((err) => {
                console.error('[openvpn-driver] Reconnect failed:', err.message)
              })
            }
          }, backoffDelay)
        } else {
          console.error('[openvpn-driver] Max reconnect attempts reached')
          this.emit('error', new Error('Max reconnect attempts reached'))
        }
      })

      // Connect to Unix socket
      this.socket.connect(this.socketPath)
    })
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
      this.connected = false
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  private handleData(data: string): void {
    this.buffer += data

    // Process complete lines
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      this.processLine(line.trim())
    }
  }

  private processLine(line: string): void {
    // Skip empty lines and prompts
    if (!line || line === '>') {
      return
    }

    // Skip INFO messages
    if (line.startsWith('>INFO:')) {
      return
    }

    // Handle realtime client events
    // Note: OpenVPN sends events in this order:
    // 1. >CLIENT:CONNECT,{CID},{KID}
    // 2. >CLIENT:ENV,... (multiple lines)
    // 3. >CLIENT:ENV,END
    
    if (line.startsWith('>CLIENT:CONNECT,')) {
      this.handleClientConnect(line)
      return
    }

    if (line.startsWith('>CLIENT:DISCONNECT,')) {
      this.handleClientDisconnect(line)
      return
    }

    if (line.startsWith('>CLIENT:REAUTH,')) {
      this.handleClientReauth(line)
      return
    }

    // Accumulate CLIENT:ENV lines — delivered between CLIENT:CONNECT and ENV,END
    // These contain IV_PLAT, IV_VER, IV_GUI_VER, common_name, ifconfig_pool_remote_ip etc.
    if (line.startsWith('>CLIENT:ENV,')) {
      this.handleClientEnv(line)
      return
    }
    
    // Skip LOG lines (too verbose)
    if (line.startsWith('>LOG:')) {
      return
    }

    // Process command responses
    if (this.commandQueue.length > 0) {
      const current = this.commandQueue[0]
      
      // Check for command completion markers
      if (line === 'END' || line.startsWith('SUCCESS:') || line.startsWith('ERROR:')) {
        this.commandQueue.shift()
        
        if (line.startsWith('ERROR:')) {
          current.reject(new Error(line.substring(6)))
        } else if (line === 'END') {
          // Resolve with all accumulated lines (multi-line response like status 3)
          current.resolve(current.buffer)
        } else {
          current.resolve(line)
        }
        
        this.isProcessing = false
        this.processNextCommand()
      } else {
        // Accumulate response lines into the buffer
        current.buffer += line + '\n'
      }
    }
  }

  private handleClientConnect(line: string): void {
    try {
      // Format: >CLIENT:CONNECT,{CID},{KID}
      const parts = line.split(',')
      if (parts.length >= 2) {
        const clientId = parts[1].trim()
        const keyId = (parts[2] || '').trim()
        console.log(`[openvpn-driver] Client connecting: CID=${clientId}, KID=${keyId}`)
        // Initialise env accumulator for this CID
        this.pendingEnv.set(clientId, {})
      }
    } catch (err) {
      console.error('[openvpn-driver] Failed to parse CLIENT:CONNECT:', err)
    }
  }

  private handleClientEnv(line: string): void {
    try {
      // Format: >CLIENT:ENV,KEY=VALUE  or  >CLIENT:ENV,END
      const payload = line.slice('>CLIENT:ENV,'.length)

      if (payload.trim() === 'END') {
        // ENV stream is complete — determine which CID this belongs to
        // OpenVPN sends ENV lines sequentially per CID; the last open accumulator is the one
        // We iterate pendingEnv in insertion order and emit for the first complete set
        for (const [clientId, envVars] of this.pendingEnv.entries()) {
          const keyId = ''
          console.log(`[openvpn-driver] Client connected: CID=${clientId}, IV_PLAT=${envVars['IV_PLAT'] ?? 'unknown'}, IV_GUI_VER=${envVars['IV_GUI_VER'] ?? '-'}`)

          // Cache client info for disconnect lookup
          const username = envVars['common_name'] ?? ''
          const vpnIp = envVars['ifconfig_pool_remote_ip'] ?? ''
          const realIp = (envVars['trusted_ip'] ?? '').split(':')[0]
          if (username) this.clientCache.set(clientId, { username, vpnIp, realIp })

          this.emit('client-connect', {
            clientId,
            keyId,
            timestamp: new Date(),
            envVars,
          })
          this.pendingEnv.delete(clientId)
          break // Only one client connects at a time
        }
        return
      }

      // KEY=VALUE  — add to the most-recently-started CID accumulator
      const eqIdx = payload.indexOf('=')
      if (eqIdx === -1) return
      const key = payload.slice(0, eqIdx)
      const value = payload.slice(eqIdx + 1)

      // Find the latest CID accumulator
      const entries = [...this.pendingEnv.entries()]
      if (entries.length > 0) {
        const [latestCid, envMap] = entries[entries.length - 1]
        envMap[key] = value
        this.pendingEnv.set(latestCid, envMap)
      }
    } catch (err) {
      console.error('[openvpn-driver] Failed to parse CLIENT:ENV:', err)
    }
  }

  private handleClientDisconnect(line: string): void {
    try {
      // Format: >CLIENT:DISCONNECT,{CID}
      const parts = line.split(',')
      if (parts.length >= 2) {
        const clientId = parts[1].trim()
        console.log(`[openvpn-driver] Client disconnecting: CID=${clientId}`)
        const cached = this.clientCache.get(clientId)
        this.emit('client-disconnect', {
          clientId,
          timestamp: new Date(),
          // Include cached client info so event-monitor can identify the user
          ...(cached ?? {}),
        })
        this.clientCache.delete(clientId)
      }
    } catch (err) {
      console.error('[openvpn-driver] Failed to parse CLIENT:DISCONNECT:', err)
    }
  }

  private handleClientReauth(line: string): void {
    try {
      // Format: >CLIENT:REAUTH,{CID},{KID}
      const parts = line.split(',')
      
      if (parts.length >= 2) {
        const clientId = parts[1]
        const keyId = parts[2] || ''
        
        console.log(`[openvpn-driver] Client reauthenticating: CID=${clientId}, KID=${keyId}`)
        
        this.emit('client-reauth', {
          clientId,
          keyId,
          timestamp: new Date(),
        })
      }
    } catch (err) {
      console.error('[openvpn-driver] Failed to parse CLIENT:REAUTH:', err)
    }
  }

  private processNextCommand(): void {
    if (this.isProcessing || this.commandQueue.length === 0) {
      return
    }

    this.isProcessing = true
    const { command } = this.commandQueue[0]
    
    if (this.socket && this.connected) {
      this.socket.write(command + '\n')
    }
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected to OpenVPN management interface')
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command timeout: ${command}`))
      }, 10000)

      this.commandQueue.push({
        command,
        buffer: '',
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      })

      if (!this.isProcessing) {
        this.processNextCommand()
      }
    })
  }

  async getServerInfo(): Promise<VpnServerInfo> {
    const versionOutput = await this.sendCommand('version')
    const stateOutput = await this.sendCommand('state')

    // Parse version
    const versionMatch = versionOutput.match(/OpenVPN Version: (.+)/)
    const version = versionMatch ? versionMatch[1] : 'unknown'

    // Parse uptime from state
    const uptimeMatch = stateOutput.match(/(\d+),/)
    const uptime = uptimeMatch ? parseInt(uptimeMatch[1], 10) : 0

    return {
      version,
      uptime,
      mode: 'server',
    }
  }

  async getClients(): Promise<VpnClient[]> {
    const statusOutput = await this.sendCommand('status 3')
    return this.parseStatus(statusOutput)
  }

  private parseStatus(statusOutput: string): VpnClient[] {
    const clients: VpnClient[] = []
    const lines = statusOutput.split('\n')

    for (const line of lines) {
      if (line.startsWith('CLIENT_LIST')) {
        const parts = line.split('\t')
        
        if (parts.length >= 8) {
          // CLIENT_LIST format:
          // 0: CLIENT_LIST
          // 1: Common Name
          // 2: Real Address
          // 3: Virtual Address
          // 4: Virtual IPv6 Address
          // 5: Bytes Received
          // 6: Bytes Sent
          // 7: Connected Since (epoch)
          // 8: Connected Since (human readable)
          // 9: Username
          // 10: Client ID
          // 11: Peer ID

          clients.push({
            commonName: parts[1],
            realAddress: parts[2],
            virtualAddress: parts[3],
            bytesReceived: parseInt(parts[5], 10) || 0,
            bytesSent: parseInt(parts[6], 10) || 0,
            // parts[7] = human-readable date ("2026-04-03 09:41:51")
            // parts[8] = Unix timestamp (seconds since epoch) ← use this
            connectedSince: new Date(parseInt(parts[8], 10) * 1000),
          })
        }
      }
    }

    return clients
  }

  async disconnectClient(commonName: string): Promise<void> {
    try {
      await this.sendCommand(`kill ${commonName}`)
      console.log(`[openvpn-driver] Disconnected client: ${commonName}`)
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
}
