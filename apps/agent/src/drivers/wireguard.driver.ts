import { exec, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
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

  // ── User management ─────────────────────────────────────────────────────────

  async createUser(_username: string): Promise<Record<string, unknown>> {
    // WireGuard does not require server-side user creation.
    // Key generation is handled by generateClientCert; peer injection by writeClientConfig.
    console.log(`[wireguard] createUser: no-op for WireGuard (use generateClientCert + writeClientConfig)`)
    return { success: true, note: 'wireguard_no_op' }
  }

  async revokeUser(username: string, clientCert?: string): Promise<Record<string, unknown>> {
    if (!clientCert) throw new Error('Missing client_cert (public key) for WireGuard revocation')
    try {
      await execAsync(`wg set ${this.interfaceName} peer ${clientCert} remove`)
      await execAsync(`wg-quick save ${this.interfaceName}`)
      console.log(`[wireguard] Peer removed for ${username}`)
      return { username, stdout: 'Peer removed' }
    } catch (err: any) {
      throw new Error(`Failed to remove WireGuard peer: ${err.message}`)
    }
  }

  async generateClientCert(_username: string, _options: ClientCertOptions = {}): Promise<ClientCertResult> {
    const privateKey = execSync('wg genkey', { encoding: 'utf-8' }).trim()
    const publicKey  = execSync('wg pubkey', { input: privateKey + '\n', encoding: 'utf-8' }).trim()
    return { clientCert: publicKey, clientKey: privateKey, passwordProtected: false, expiresAt: null }
  }

  async generateClientConfig(username: string, options: ClientConfigOptions): Promise<string> {
    const {
      serverIp, serverPort = 51820,
      clientPrivateKey, clientVpnIp,
      dns = '1.1.1.1',
    } = options

    if (!serverIp) throw new Error('Missing serverIp')
    if (!clientPrivateKey) throw new Error('Missing clientPrivateKey for WireGuard config')
    if (!clientVpnIp) throw new Error('Missing clientVpnIp for WireGuard config')

    // Read server public key
    const WG_PUB_PATH = '/etc/wireguard/publickey'
    if (!existsSync(WG_PUB_PATH)) throw new Error(`Server public key not found at ${WG_PUB_PATH}`)
    const serverPublicKey = readFileSync(WG_PUB_PATH, 'utf-8').trim()

    return `# WireGuard client config for ${username}
[Interface]
PrivateKey = ${clientPrivateKey}
Address = ${clientVpnIp}/32
DNS = ${dns}

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverIp}:${serverPort}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`
  }

  // ── Session management ──────────────────────────────────────────────────────

  async kickSession(commonName: string, options: KickSessionOptions = {}): Promise<KickSessionResult> {
    const { permanent = false, publicKey, vpnIp } = options
    const result: KickSessionResult = {
      kicked: false, common_name: commonName, permanent,
      kill_method: null, kill_response: null,
    }

    if (!publicKey) {
      console.warn(`[wireguard] kickSession: missing publicKey for ${commonName}`)
      result.error = 'missing_public_key'
      return result
    }

    if (permanent) {
      execSync(`wg set ${this.interfaceName} peer ${publicKey} remove`)
      execSync(`wg-quick save ${this.interfaceName}`)
      result.kicked = true
      result.kill_method = 'wg_remove'
      result.ccd_disabled = true
      console.log(`[wireguard] ✓ Peer ${commonName} permanently removed`)
    } else {
      if (!vpnIp) {
        console.warn(`[wireguard] kickSession: missing vpnIp for temporary kick of ${commonName}`)
        return result
      }
      execSync(`wg set ${this.interfaceName} peer ${publicKey} remove`)
      setTimeout(() => {
        try {
          execSync(`wg set ${this.interfaceName} peer ${publicKey} allowed-ips ${vpnIp}/32`)
          console.log(`[wireguard] ✓ Peer ${commonName} restored after temp kick`)
        } catch (e: any) { console.error(`[wireguard] Failed to restore peer:`, e.message) }
      }, 2000)
      result.kicked = true
      result.kill_method = 'wg_temp_remove'
      console.log(`[wireguard] ✓ Peer ${commonName} temporarily kicked`)
    }

    return result
  }

  async unkickSession(commonName: string, options: UnkickSessionOptions = {}): Promise<Record<string, unknown>> {
    const { publicKey, vpnIp } = options
    if (!publicKey || !vpnIp) {
      console.warn(`[wireguard] unkickSession: missing publicKey or vpnIp for ${commonName}`)
      return { unkicked: false, common_name: commonName, error: 'missing_payload_data' }
    }
    execSync(`wg set ${this.interfaceName} peer ${publicKey} allowed-ips ${vpnIp}/32`)
    execSync(`wg-quick save ${this.interfaceName}`)
    console.log(`[wireguard] ✓ Peer ${commonName} restored`)
    return { unkicked: true, common_name: commonName, method: 'wg_restore' }
  }

  // ── Config management ───────────────────────────────────────────────────────

  async reload(): Promise<void> {
    await execAsync(`wg-quick down ${this.interfaceName} || true`)
    await execAsync(`wg-quick up ${this.interfaceName}`)
    console.log(`[wireguard] Interface ${this.interfaceName} reloaded`)
  }

  async syncCertificates(): Promise<Record<string, unknown>> {
    const MANAGER_URL = process.env.AGENT_MANAGER_URL
    const NODE_TOKEN  = process.env.AGENT_SECRET_TOKEN
    if (!MANAGER_URL || !NODE_TOKEN) throw new Error('AGENT_MANAGER_URL and AGENT_SECRET_TOKEN must be set')

    const WG_PUB_PATH  = '/etc/wireguard/publickey'
    const WG_PRIV_PATH = '/etc/wireguard/privatekey'
    if (!existsSync(WG_PUB_PATH) || !existsSync(WG_PRIV_PATH)) {
      throw new Error(`WireGuard keys not found at ${WG_PUB_PATH} or ${WG_PRIV_PATH}`)
    }

    const pubKey  = readFileSync(WG_PUB_PATH, 'utf-8').trim()
    const privKey = readFileSync(WG_PRIV_PATH, 'utf-8').trim()

    const response = await fetch(`${MANAGER_URL}/api/v1/nodes/sync-certs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NODE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: pubKey, private_key: privKey }),
    })
    if (!response.ok) throw new Error(`Failed to upload WireGuard keys: HTTP ${response.status} - ${await response.text()}`)

    const result = await response.json() as { node_id: string }
    console.log('[wireguard] ✓ Keys synced to database')
    return { success: true, message: 'WireGuard keys synced to database', node_id: result.node_id }
  }

  async syncServerConfig(): Promise<Record<string, unknown>> {
    const MANAGER_URL = process.env.AGENT_MANAGER_URL
    const NODE_TOKEN  = process.env.AGENT_SECRET_TOKEN
    if (!MANAGER_URL || !NODE_TOKEN) throw new Error('AGENT_MANAGER_URL and AGENT_SECRET_TOKEN must be set')

    const WG_CONF = `/etc/wireguard/${this.interfaceName}.conf`
    if (!existsSync(WG_CONF)) throw new Error(`WireGuard config not found at ${WG_CONF}`)

    const config = this._parseWgConfig(readFileSync(WG_CONF, 'utf-8'))

    const response = await fetch(`${MANAGER_URL}/api/v1/nodes/sync-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NODE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!response.ok) throw new Error(`Failed to sync config: HTTP ${response.status} - ${await response.text()}`)

    const result = await response.json() as { node_id: string }
    console.log('[wireguard] ✓ Server config synced')
    return { success: true, message: 'WireGuard config synced to database', config, node_id: result.node_id }
  }

  async updateServerConfig(params: ServerConfigParams): Promise<Record<string, unknown>> {
    const WG_CONF = `/etc/wireguard/${this.interfaceName}.conf`
    if (!existsSync(WG_CONF)) throw new Error('WireGuard config not found. Please install VPN server first.')

    const prefix   = this._netmaskToPrefix(params.vpn_netmask)
    const netInt   = this._ipToInt(params.vpn_network) & this._ipToInt(params.vpn_netmask)
    const serverIp = this._intToIp(netInt + 1)

    await execAsync(`sed -i 's|^Address = .*|Address = ${serverIp}/${prefix}|' ${WG_CONF}`)
    if (params.port) {
      await execAsync(`sed -i 's|^ListenPort = .*|ListenPort = ${params.port}|' ${WG_CONF}`)
    }

    await this.reload()
    return {
      success: true,
      message: 'WireGuard configuration updated. Interface restarted.',
      configPath: WG_CONF,
    }
  }

  // ── Per-client config (WireGuard peer) ─────────────────────────────────────

  async writeClientConfig(
    username: string,
    vpnIp: string,
    options: WriteClientConfigOptions = {},
  ): Promise<Record<string, unknown>> {
    const { publicKey } = options
    if (!publicKey) {
      console.warn(`[wireguard] writeClientConfig: no publicKey for ${username}, skipping peer injection`)
      return { success: false, reason: 'missing_public_key' }
    }
    execSync(`wg set ${this.interfaceName} peer ${publicKey} allowed-ips ${vpnIp}/32`)
    execSync(`wg-quick save ${this.interfaceName}`)
    console.log(`[wireguard] ✓ Peer injected for ${username} with IP ${vpnIp}/32`)
    return { success: true, username, vpn_ip: vpnIp, public_key: publicKey, interface: this.interfaceName }
  }

  async deleteClientConfig(username: string, options?: { publicKey?: string }): Promise<Record<string, unknown>> {
    const publicKey = options?.publicKey
    if (!publicKey) {
      console.warn(`[wireguard] deleteClientConfig: no publicKey for ${username}, skipping`)
      return { success: false, reason: 'missing_public_key' }
    }
    execSync(`wg set ${this.interfaceName} peer ${publicKey} remove`)
    execSync(`wg-quick save ${this.interfaceName}`)
    console.log(`[wireguard] ✓ Peer removed for ${username}`)
    return { success: true, username }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _netmaskToPrefix(netmask: string): number {
    return netmask
      .split('.')
      .reduce((bits, oct) => bits + (parseInt(oct, 10).toString(2).match(/1/g) ?? []).length, 0)
  }
  private _ipToInt(ip: string): number {
    return ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0
  }
  private _intToIp(n: number): string {
    return [24, 16, 8, 0].map(s => (n >> s) & 0xff).join('.')
  }

  private _parseWgConfig(content: string): Record<string, unknown> {
    const config: Record<string, unknown> = {
      port: 51820, protocol: 'udp', vpnNetwork: '', vpnNetmask: '255.255.255.0',
    }
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || t.startsWith('[')) continue
      const [key, ...rest] = t.split('=').map(s => s.trim())
      const val = rest.join('=').trim()
      if (key === 'ListenPort') config.port = parseInt(val, 10)
      if (key === 'Address') {
        const [ip, prefix] = val.split('/')
        if (ip && prefix) {
          const p = parseInt(prefix, 10)
          const mask = (0xffffffff << (32 - p)) >>> 0
          config.vpnNetmask = [24, 16, 8, 0].map(s => (mask >> s) & 0xff).join('.')
          const ipInt = this._ipToInt(ip) & mask
          config.vpnNetwork = this._intToIp(ipInt)
        }
      }
    }
    return config
  }
}
