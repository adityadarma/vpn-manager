import net from 'node:net'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { exec, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type {
  VpnDriver,
  VpnClient,
  VpnServerInfo,
  VpnStatus,
  VpnMetrics,
  ClientCertOptions,
  ClientCertResult,
  ClientConfigOptions,
  KickSessionOptions,
  KickSessionResult,
  UnkickSessionOptions,
  WriteClientConfigOptions,
  ServerConfigParams,
} from './vpn-driver.interface'

const execAsync = promisify(exec)

// ── Subnet helpers (used by updateServerConfig) ───────────────────────────────
function _netmaskToPrefix(netmask: string): number {
  return netmask
    .split('.')
    .reduce((bits, oct) => bits + (parseInt(oct, 10).toString(2).match(/1/g) ?? []).length, 0)
}
function _prefixToNetmask(prefix: number): string {
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map(s => (mask >> s) & 0xff).join('.')
}
function _ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0
}
function _intToIp(n: number): string {
  return [24, 16, 8, 0].map(s => (n >> s) & 0xff).join('.')
}
function _parseCidr(cidr: string): { network: string; netmask: string } | null {
  if (cidr.includes('/')) {
    const [network, prefixStr] = cidr.split('/')
    const prefix = parseInt(prefixStr, 10)
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return null
    return { network, netmask: _prefixToNetmask(prefix) }
  }
  const parts = cidr.trim().split(/\s+/)
  if (parts.length === 2) return { network: parts[0], netmask: parts[1] }
  return null
}
function _networkAddress(ip: string, netmask: string): string {
  return _intToIp(_ipToInt(ip) & _ipToInt(netmask))
}
function _isSubnetContainedIn(subNet: string, subMask: string, poolNet: string, poolMask: string): boolean {
  const poolPrefix = _netmaskToPrefix(poolMask)
  const subPrefix  = _netmaskToPrefix(subMask)
  if (subPrefix < poolPrefix) return false
  return (_ipToInt(poolNet) & _ipToInt(poolMask)) === (_ipToInt(subNet) & _ipToInt(poolMask))
}

/**
 * OpenVPN Interface Driver
 * 
 * Communicates with OpenVPN via Unix socket
 * 
 * Unix Socket: /run/openvpn/server.sock
 * 
 * Protocol Reference:
 * - https://openvpn.net/community-resources/management-interface/
 */
export class OpenVpnDriver extends EventEmitter implements VpnDriver {
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

  // ── User management ─────────────────────────────────────────────────────────

  async createUser(username: string): Promise<Record<string, unknown>> {
    const EASYRSA_DIR = '/etc/openvpn/easy-rsa'
    const EASYRSA_BIN = `${EASYRSA_DIR}/easyrsa`
    if (!existsSync(EASYRSA_BIN)) throw new Error(`EasyRSA not found at ${EASYRSA_BIN}`)
    const { stdout } = await execAsync(
      `${EASYRSA_BIN} --batch build-client-full ${username} nopass`,
      { cwd: EASYRSA_DIR },
    )
    console.log(`[openvpn] Certificate generated for: ${username}`)
    return { username, stdout: stdout.trim() }
  }

  async revokeUser(username: string, _clientCert?: string): Promise<Record<string, unknown>> {
    const EASYRSA_DIR = '/etc/openvpn/easy-rsa'
    const EASYRSA_BIN = `${EASYRSA_DIR}/easyrsa`
    if (!existsSync(EASYRSA_BIN)) throw new Error(`EasyRSA not found at ${EASYRSA_BIN}`)

    const { stdout } = await execAsync(
      `${EASYRSA_BIN} --batch revoke ${username} && ${EASYRSA_BIN} gen-crl`,
      { cwd: EASYRSA_DIR },
    )
    await execAsync(`cp ${EASYRSA_DIR}/pki/crl.pem /etc/openvpn/server/crl.pem`)
    await execAsync(`chmod 644 /etc/openvpn/server/crl.pem`)

    // Reload CRL first so reconnects are rejected immediately, then kick
    try {
      await this.sendCommand('signal SIGHUP')
      console.log(`[openvpn] Sent SIGHUP — reloading CRL`)
      await new Promise(resolve => setTimeout(resolve, 3000))
    } catch (err) {
      console.error('[openvpn] Failed to send SIGHUP:', err)
    }
    try {
      await this.disconnectClient(username)
    } catch { /* client may not be connected */ }

    console.log(`[openvpn] Certificate revoked for: ${username}`)
    return { username, stdout: stdout.trim() }
  }

  async generateClientCert(username: string, options: ClientCertOptions = {}): Promise<ClientCertResult> {
    const { password, validDays } = options
    const certValidDays = (validDays === null || validDays === 0) ? 36500 : (validDays ?? 3650)

    const EASYRSA_DIR = '/etc/openvpn/easy-rsa'
    const EASYRSA_BIN = `${EASYRSA_DIR}/easyrsa`
    if (!existsSync(EASYRSA_DIR)) throw new Error('EasyRSA directory not found.')
    if (!existsSync(EASYRSA_BIN)) throw new Error(`EasyRSA not found at ${EASYRSA_BIN}`)

    const certPath = `${EASYRSA_DIR}/pki/issued/${username}.crt`
    const keyPath  = `${EASYRSA_DIR}/pki/private/${username}.key`
    const reqPath  = `${EASYRSA_DIR}/pki/reqs/${username}.req`

    // Clean up pre-existing cert files
    if (existsSync(certPath) || existsSync(keyPath) || existsSync(reqPath)) {
      console.log(`[openvpn] Cleaning up existing cert files for ${username}`)
      if (existsSync(certPath)) {
        try {
          execSync(`${EASYRSA_BIN} revoke ${username}`, {
            cwd: EASYRSA_DIR,
            env: { ...process.env, EASYRSA_BATCH: '1' },
            stdio: 'pipe',
          })
          execSync(`${EASYRSA_BIN} gen-crl`, {
            cwd: EASYRSA_DIR,
            env: { ...process.env, EASYRSA_BATCH: '1' },
            stdio: 'pipe',
          })
        } catch { /* ignore */ }
      }
      const indexPath = `${EASYRSA_DIR}/pki/index.txt`
      if (existsSync(indexPath)) {
        try {
          execSync(`cp "${indexPath}" "${indexPath}.bak-$(date +%s)"`, { stdio: 'pipe' })
          execSync(`sed -i '/CN=${username}$/d' "${indexPath}"`, { stdio: 'pipe' })
        } catch { /* ignore */ }
      }
      for (const pattern of [certPath, keyPath, reqPath]) {
        try { execSync(`rm -f ${pattern}`, { stdio: 'pipe' }) } catch { /* ignore */ }
      }
    }

    const env = { ...process.env, EASYRSA_BATCH: '1', EASYRSA_CERT_EXPIRE: certValidDays.toString() }
    if (password) {
      execSync(`${EASYRSA_BIN} build-client-full ${username}`, {
        cwd: EASYRSA_DIR,
        env: { ...env, EASYRSA_PASSOUT: `pass:${password}` },
        stdio: 'pipe',
      })
    } else {
      execSync(`${EASYRSA_BIN} build-client-full ${username} nopass`, {
        cwd: EASYRSA_DIR, env, stdio: 'pipe',
      })
    }

    const clientCert = readFileSync(certPath, 'utf-8')
    const clientKey  = readFileSync(keyPath, 'utf-8')
    const expiresAt  = certValidDays === 36500 ? null : (() => {
      const d = new Date()
      d.setDate(d.getDate() + certValidDays)
      return d.toISOString()
    })()

    console.log(`[openvpn] Client certificate generated for ${username}`)
    return { clientCert, clientKey, passwordProtected: !!password, expiresAt }
  }

  async generateClientConfig(username: string, options: ClientConfigOptions): Promise<string> {
    const {
      serverIp, serverPort = 1194, protocol = 'udp',
      cipher = 'AES-256-GCM', authDigest = 'SHA256',
    } = options

    if (!serverIp) throw new Error('Missing serverIp')

    const EASY_RSA_PKI = '/etc/openvpn/easy-rsa/pki'
    const OPENVPN_CA   = `${EASY_RSA_PKI}/ca.crt`

    let tlsKey = ''
    for (const p of ['/etc/openvpn/server/tls-crypt.key', '/etc/openvpn/server/ta.key']) {
      try { tlsKey = await readFile(p, 'utf-8'); break } catch { /* try next */ }
    }

    const [ca, cert, key] = await Promise.all([
      readFile(OPENVPN_CA, 'utf-8'),
      readFile(path.join(EASY_RSA_PKI, 'issued', `${username}.crt`), 'utf-8'),
      readFile(path.join(EASY_RSA_PKI, 'private', `${username}.key`), 'utf-8'),
    ])

    const protoClient = protocol === 'tcp' ? 'tcp-client' : protocol
    const tlsCipher = cipher.includes('256')
      ? 'TLS-ECDHE-RSA-WITH-AES-256-GCM-SHA384'
      : 'TLS-ECDHE-RSA-WITH-AES-128-GCM-SHA256'

    return `client
proto ${protoClient}
${protocol === 'udp' ? 'explicit-exit-notify' : ''}
remote ${serverIp} ${serverPort}
dev tun
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth ${authDigest}
auth-nocache
cipher ${cipher}
tls-client
tls-version-min 1.2
tls-cipher ${tlsCipher}
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns
verb 3

<ca>
${ca.trim()}
</ca>

<cert>
${cert.trim()}
</cert>

<key>
${key.trim()}
</key>
${tlsKey ? `\n<tls-crypt>\n${tlsKey.trim()}\n</tls-crypt>` : ''}`.trim()
  }

  // ── Session management ──────────────────────────────────────────────────────

  async kickSession(commonName: string, options: KickSessionOptions = {}): Promise<KickSessionResult> {
    const { permanent = false } = options
    const MGMT_SOCKET = '/run/openvpn/server.sock'
    const CCD_DIR = '/etc/openvpn/ccd'

    const result: KickSessionResult = {
      kicked: false, common_name: commonName, permanent,
      kill_method: null, kill_response: null,
    }

    if (permanent) {
      this._writeCcdDisable(commonName, CCD_DIR)
      result.ccd_disabled = true
    } else {
      this._removeCcdDisable(commonName, CCD_DIR)
    }

    // Primary: raw socket kill
    try {
      const response = await this._killViaRawSocket(commonName, MGMT_SOCKET)
      result.kicked = true
      result.kill_method = 'raw_socket'
      result.kill_response = response
      return result
    } catch (rawErr) {
      console.warn(`[openvpn] Raw socket kill failed: ${(rawErr as Error).message}`)
    }

    // Fallback: driver disconnectClient
    if (this.isConnected()) {
      try {
        await this.disconnectClient(commonName)
        result.kicked = true
        result.kill_method = 'driver'
        return result
      } catch { /* fall through */ }
    }

    // Last resort: socat
    try {
      const output = execSync(
        `printf 'kill ${commonName}\\r\\n' | socat - UNIX-CONNECT:${MGMT_SOCKET}`,
        { encoding: 'utf-8', timeout: 5000 },
      )
      result.kicked = true
      result.kill_method = 'socat'
      result.kill_response = output.trim()
    } catch (socatErr) {
      console.error(`[openvpn] socat fallback failed: ${(socatErr as Error).message}`)
    }

    return result
  }

  async unkickSession(commonName: string, _options: UnkickSessionOptions = {}): Promise<Record<string, unknown>> {
    const CCD_DIR = '/etc/openvpn/ccd'
    const ccdFile = path.join(CCD_DIR, commonName)

    if (!existsSync(ccdFile)) {
      return { unkicked: true, common_name: commonName, note: 'no_ccd_file' }
    }

    const content = readFileSync(ccdFile, 'utf-8')
    if (content.trim() === 'disable') {
      unlinkSync(ccdFile)
      return { unkicked: true, common_name: commonName, ccd_file_removed: true }
    } else if (content.includes('disable')) {
      const cleaned = content.split('\n').filter(l => l.trim() !== 'disable').join('\n').trimEnd() + '\n'
      writeFileSync(ccdFile, cleaned, 'utf-8')
      return { unkicked: true, common_name: commonName, ccd_file_updated: true }
    }
    return { unkicked: true, common_name: commonName, note: 'no_disable_line' }
  }

  // ── Config management ───────────────────────────────────────────────────────

  async reload(): Promise<void> {
    await this.sendCommand('signal SIGHUP')
    console.log('[openvpn] Reloaded via management interface (SIGHUP)')
  }

  async syncCertificates(): Promise<Record<string, unknown>> {
    const MANAGER_URL = process.env.AGENT_MANAGER_URL
    const NODE_TOKEN  = process.env.AGENT_SECRET_TOKEN
    if (!MANAGER_URL || !NODE_TOKEN) throw new Error('AGENT_MANAGER_URL and AGENT_SECRET_TOKEN must be set')

    const CA_CERT_PATH    = '/etc/openvpn/server/ca.crt'
    const TLS_CRYPT_PATH  = '/etc/openvpn/server/tls-crypt.key'
    const TLS_AUTH_PATH   = '/etc/openvpn/server/ta.key'

    if (!existsSync(CA_CERT_PATH)) throw new Error(`CA certificate not found at ${CA_CERT_PATH}`)

    let tlsKeyPath = TLS_CRYPT_PATH
    if (!existsSync(TLS_CRYPT_PATH)) {
      if (existsSync(TLS_AUTH_PATH)) { tlsKeyPath = TLS_AUTH_PATH }
      else throw new Error('No TLS key found (tls-crypt.key or ta.key)')
    }

    const caCert = readFileSync(CA_CERT_PATH, 'utf-8')
    const tlsKey = readFileSync(tlsKeyPath, 'utf-8')

    const response = await fetch(`${MANAGER_URL}/api/v1/nodes/sync-certs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NODE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ca_cert: caCert.trim(), ta_key: tlsKey.trim() }),
    })
    if (!response.ok) throw new Error(`Failed to upload certificates: HTTP ${response.status}`)

    const result = await response.json() as { node_id: string }
    console.log('[openvpn] ✓ Certificates synced to database')
    return {
      success: true, message: 'Certificates synced to database',
      ca_cert_size: caCert.length, ta_key_size: tlsKey.length,
      tls_method: tlsKeyPath.includes('tls-crypt') ? 'tls-crypt' : 'tls-auth',
      node_id: result.node_id,
    }
  }

  async syncServerConfig(): Promise<Record<string, unknown>> {
    const MANAGER_URL = process.env.AGENT_MANAGER_URL
    const NODE_TOKEN  = process.env.AGENT_SECRET_TOKEN
    if (!MANAGER_URL || !NODE_TOKEN) throw new Error('AGENT_MANAGER_URL and AGENT_SECRET_TOKEN must be set')

    const CONFIG_PATH = '/etc/openvpn/server/server.conf'
    if (!existsSync(CONFIG_PATH)) throw new Error(`Server config not found at ${CONFIG_PATH}`)

    const config = this._parseServerConfig(readFileSync(CONFIG_PATH, 'utf-8'))

    const response = await fetch(`${MANAGER_URL}/api/v1/nodes/sync-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NODE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!response.ok) throw new Error(`Failed to sync config: HTTP ${response.status} - ${await response.text()}`)

    const result = await response.json() as { node_id: string }
    console.log('[openvpn] ✓ Server config synced')
    return { success: true, message: 'Server config synced to database', config, node_id: result.node_id }
  }

  async updateServerConfig(params: ServerConfigParams): Promise<Record<string, unknown>> {
    const CONFIG_PATH  = '/etc/openvpn/server/server.conf'
    const BACKUP_PATH  = '/etc/openvpn/server/server.conf.backup'
    const EASYRSA_DIR  = '/etc/openvpn/easy-rsa'
    const CCD_DIR      = '/etc/openvpn/ccd'
    const CRL_PATH     = '/etc/openvpn/server/crl.pem'

    if (!existsSync(CONFIG_PATH)) throw new Error('VPN server config not found.')

    const port             = params.port             || 1194
    const protocol         = params.protocol         || 'udp'
    const dnsServers       = params.dns_servers      || '8.8.8.8,1.1.1.1'
    const tunnelMode       = params.tunnel_mode      || 'full'
    const cipher           = params.cipher           || 'AES-256-GCM'
    const keepalivePing    = params.keepalive_ping   || 10
    const keepaliveTimeout = params.keepalive_timeout || 120
    const enableCompression = params.compression === 'lz4-v2'
    const customRoutes     = params.push_routes
      ? params.push_routes.split(',').map(r => r.trim()).filter(Boolean)
      : []
    const customPushLines  = (params.custom_push_directives ?? '')
      .split('\n').map(l => l.trim()).filter(Boolean)

    // Detect cipher directive name (data-ciphers vs ncp-ciphers for OpenVPN < 2.5)
    let cipherDirective = 'data-ciphers'
    try {
      const { stdout } = await execAsync('openvpn --version 2>/dev/null || true')
      const match = stdout.match(/OpenVPN\s+(\d+)\.(\d+)/)
      if (match && (parseInt(match[1]) < 2 || (parseInt(match[1]) === 2 && parseInt(match[2]) < 5))) {
        cipherDirective = 'ncp-ciphers'
      }
    } catch { /* default to data-ciphers */ }

    const serverNet  = _networkAddress(params.vpn_network, params.vpn_netmask)
    const serverMask = params.vpn_netmask

    // CCD cleanup on network change
    const NETWORK_MARKER = `${CCD_DIR}/.current_network`
    const currentNet = `${params.vpn_network}/${params.vpn_netmask}`
    if (existsSync(CCD_DIR)) {
      try {
        const prev = existsSync(NETWORK_MARKER) ? readFileSync(NETWORK_MARKER, 'utf-8').trim() : ''
        if (prev && prev !== currentNet) {
          console.log(`[openvpn] Network changed ${prev} → ${currentNet}, cleaning CCD dir`)
          execSync(`find ${CCD_DIR} -type f ! -name ".current_network" -delete`)
        }
        writeFileSync(NETWORK_MARKER, currentNet)
      } catch { /* non-fatal */ }
    }

    // Compute group subnet routes
    const extraRoutes: Array<{ network: string; netmask: string; cidr: string }> = []
    for (const cidr of (params.group_subnets ?? [])) {
      const parsed = _parseCidr(cidr)
      if (!parsed) continue
      const gNet  = _networkAddress(parsed.network, parsed.netmask)
      const gMask = parsed.netmask
      if (_isSubnetContainedIn(gNet, gMask, serverNet, serverMask)) continue
      if (!extraRoutes.some(r => r.network === gNet && r.netmask === gMask)) {
        extraRoutes.push({ network: gNet, netmask: gMask, cidr })
      }
    }

    const dnsArray = dnsServers.split(',').map((d: string) => d.trim()).filter(Boolean)

    let newConfig = `# VPN Server Configuration — generated by VPN Manager ${new Date().toISOString()}

port ${port}
proto ${protocol}
dev tun

ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
dh none
tls-crypt /etc/openvpn/server/tls-crypt.key

server ${params.vpn_network} ${params.vpn_netmask}
topology subnet

`
    if (extraRoutes.length) {
      newConfig += `# Routes for group subnets outside the server pool\n`
      extraRoutes.forEach(r => { newConfig += `route ${r.network} ${r.netmask}\n` })
      newConfig += '\n'
    }

    newConfig += dnsArray.map((dns: string) => `push "dhcp-option DNS ${dns}"`).join('\n') + '\n'

    if (customPushLines.length) {
      newConfig += '\n# Custom Push Directives\n'
      customPushLines.forEach(l => { newConfig += l.startsWith('push ') ? `${l}\n` : `push "${l}"\n` })
    }

    newConfig += `\n# Tunnel Mode: ${tunnelMode}\n`
    if (tunnelMode === 'full') {
      newConfig += `push "redirect-gateway def1 bypass-dhcp"\n`
    } else {
      customRoutes.forEach(r => { newConfig += `push "route ${r}"\n` })
    }

    newConfig += `
keepalive ${keepalivePing} ${keepaliveTimeout}
explicit-exit-notify 1
cipher ${cipher}
${cipherDirective} ${cipher}
auth SHA256
tls-server
tls-version-min 1.2
tls-cipher TLS-ECDHE-RSA-WITH-AES-256-GCM-SHA384
persist-key
persist-tun
`
    if (enableCompression) newConfig += `compress lz4-v2\npush "compress lz4-v2"\n`

    newConfig += `
user nobody
group nogroup

status /var/log/openvpn/status.log 1
status-version 3
log /var/log/openvpn/openvpn.log
verb 3

script-security 2
management /run/openvpn/server.sock unix
client-config-dir /etc/openvpn/ccd
crl-verify /etc/openvpn/server/crl.pem
`

    if (!existsSync(CRL_PATH) && existsSync(EASYRSA_DIR)) {
      try {
        execSync(`./easyrsa --batch gen-crl`, { cwd: EASYRSA_DIR })
        execSync(`cp ${EASYRSA_DIR}/pki/crl.pem ${CRL_PATH} && chmod 644 ${CRL_PATH}`)
      } catch { /* non-fatal */ }
    }

    const currentConfig = readFileSync(CONFIG_PATH, 'utf-8')
    writeFileSync(BACKUP_PATH, currentConfig)
    writeFileSync(CONFIG_PATH, newConfig)

    try {
      await this.reload()
    } catch (err) {
      writeFileSync(CONFIG_PATH, currentConfig)
      throw new Error('Failed to reload VPN. Config restored from backup.')
    }

    await new Promise(resolve => setTimeout(resolve, 5000))
    return {
      success: true,
      message: 'Server configuration updated. OpenVPN is reloading.',
      configPath: CONFIG_PATH,
      backupPath: BACKUP_PATH,
      groupRoutes: extraRoutes.map(r => `${r.network} ${r.netmask}`),
    }
  }

  // ── Per-client config (CCD) ─────────────────────────────────────────────────

  async writeClientConfig(
    username: string,
    vpnIp: string,
    options: WriteClientConfigOptions = {},
  ): Promise<Record<string, unknown>> {
    const { netmask = '255.255.255.0', extraLines = [] } = options
    const CCD_DIR = '/etc/openvpn/ccd'

    if (!existsSync(CCD_DIR)) {
      mkdirSync(CCD_DIR, { recursive: true })
    }

    const ccdPath = path.join(CCD_DIR, username)
    const existing = existsSync(ccdPath)
      ? readFileSync(ccdPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
      : []
    const isDisabled = existing.some(l => l === 'disable')

    const lines = [`ifconfig-push ${vpnIp} ${netmask}`]
    if (isDisabled) lines.push('disable')
    extraLines.forEach(l => { if (l.trim()) lines.push(l.trim()) })

    writeFileSync(ccdPath, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o644 })
    console.log(`[openvpn] ✓ CCD written: ${ccdPath}`)
    return { success: true, username, vpn_ip: vpnIp, netmask, ccd_path: ccdPath, is_disabled: isDisabled }
  }

  async deleteClientConfig(username: string, _options?: { publicKey?: string }): Promise<Record<string, unknown>> {
    const ccdPath = path.join('/etc/openvpn/ccd', username)
    if (existsSync(ccdPath)) {
      unlinkSync(ccdPath)
      console.log(`[openvpn] ✓ CCD deleted: ${ccdPath}`)
      return { success: true, username, ccd_path: ccdPath }
    }
    return { success: true, username, ccd_path: ccdPath, note: 'file_not_found' }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _killViaRawSocket(commonName: string, socketPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      let response = ''
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Raw socket kill timed out')) }, 8000)

      socket.connect(socketPath, () => { socket.write(`kill ${commonName}\n`) })
      socket.on('data', (chunk) => {
        response += chunk.toString()
        if (response.includes('SUCCESS:') || response.includes('ERROR:')) {
          clearTimeout(timeout)
          socket.destroy()
          response.includes('ERROR:')
            ? reject(new Error(`Management kill error: ${response.trim()}`))
            : resolve(response.trim())
        }
      })
      socket.on('error', (err) => { clearTimeout(timeout); reject(err) })
      socket.on('close', () => { clearTimeout(timeout); if (!response.includes('ERROR:')) resolve(response.trim()) })
    })
  }

  private _writeCcdDisable(commonName: string, ccdDir: string): void {
    try {
      if (!existsSync(ccdDir)) mkdirSync(ccdDir, { recursive: true })
      const ccdFile = path.join(ccdDir, commonName)
      let existing = ''
      try { existing = readFileSync(ccdFile, 'utf-8') } catch { /* new file */ }
      if (!existing.includes('disable')) {
        writeFileSync(ccdFile, existing ? `${existing.trimEnd()}\ndisable\n` : 'disable\n', 'utf-8')
      }
    } catch (err) {
      console.error(`[openvpn] Failed to write CCD disable: ${(err as Error).message}`)
    }
  }

  private _removeCcdDisable(commonName: string, ccdDir: string): void {
    try {
      const ccdFile = path.join(ccdDir, commonName)
      if (!existsSync(ccdFile)) return
      const content = readFileSync(ccdFile, 'utf-8')
      if (content.trim() === 'disable') {
        unlinkSync(ccdFile)
      } else if (content.includes('disable')) {
        writeFileSync(ccdFile, content.split('\n').filter(l => l.trim() !== 'disable').join('\n').trimEnd() + '\n', 'utf-8')
      }
    } catch { /* non-fatal */ }
  }

  private _parseServerConfig(content: string): Record<string, unknown> {
    const config: Record<string, unknown> = {
      port: 1194, protocol: 'udp', cipher: 'AES-128-GCM', auth: 'SHA256',
      vpnNetwork: '10.8.0.0', vpnNetmask: '255.255.255.0', dnsServers: '',
      pushRoutes: '', customPushDirectives: '', compression: 'none',
      keepalivePing: 10, keepaliveTimeout: 60, maxClients: 100, tunnelMode: 'full',
    }
    const customLines: string[] = []
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const parts = t.split(/\s+/)
      switch (parts[0]) {
        case 'port':      config.port = parseInt(parts[1], 10); break
        case 'proto':     config.protocol = parts[1]; break
        case 'cipher':    config.cipher = parts[1]; break
        case 'auth':      config.auth = parts[1]; break
        case 'server':    config.vpnNetwork = parts[1]; config.vpnNetmask = parts[2]; break
        case 'keepalive': config.keepalivePing = parseInt(parts[1], 10); config.keepaliveTimeout = parseInt(parts[2], 10); break
        case 'max-clients': config.maxClients = parseInt(parts[1], 10); break
        case 'comp-lzo':  config.compression = parts[1] || 'lzo'; break
        case 'compress':  config.compression = parts[1] || 'lz4-v2'; break
        case 'push': {
          const arg = parts.slice(1).join(' ').replace(/^"|"$/g, '')
          if (arg.startsWith('dhcp-option DNS ')) {
            const dns = arg.slice('dhcp-option DNS '.length).trim()
            config.dnsServers = config.dnsServers ? `${config.dnsServers},${dns}` : dns
          } else if (arg.startsWith('route ')) {
            const r = arg.slice('route '.length).trim()
            config.pushRoutes = config.pushRoutes ? `${config.pushRoutes},${r}` : r
          } else if (arg.startsWith('redirect-gateway')) {
            config.tunnelMode = 'full'
          } else {
            customLines.push(arg)
          }
          break
        }
      }
    }
    config.customPushDirectives = customLines.join('\n')
    return config
  }
}
