/**
 * VPN Driver Interface
 *
 * Adapter/factory abstraction for all VPN engine operations.
 * Each VPN engine (OpenVPN, WireGuard) implements every method — handlers
 * never branch on VPN_TYPE; they simply call the appropriate driver method.
 *
 * Drivers extend EventEmitter and emit:
 * - 'client-connect'    : VpnClient connected
 * - 'client-disconnect' : VpnClient disconnected
 * - 'client-reauth'     : VpnClient reauthenticated
 */

import type { EventEmitter } from 'node:events'

// ── Status types ─────────────────────────────────────────────────────────────

export interface VpnClient {
  commonName: string
  realAddress: string
  virtualAddress: string
  bytesReceived: number
  bytesSent: number
  connectedSince: Date
  lastActivity?: Date
}

export interface VpnServerInfo {
  version: string
  uptime: number
  mode: string
}

export interface VpnStatus {
  state: 'connected' | 'disconnected' | 'reconnecting'
  clients: VpnClient[]
  serverInfo: VpnServerInfo
}

export interface VpnMetrics {
  totalClients: number
  totalBytesReceived: number
  totalBytesSent: number
  uptime: number
}

// ── User / cert types ─────────────────────────────────────────────────────────

export interface ClientCertOptions {
  password?: string
  validDays?: number | null
}

export interface ClientCertResult {
  clientCert: string
  clientKey: string
  passwordProtected: boolean
  expiresAt: string | null
}

export interface ClientConfigOptions {
  serverIp: string
  serverPort?: number
  protocol?: string
  cipher?: string
  authDigest?: string
  /** WireGuard: client private key (from generateClientCert) */
  clientPrivateKey?: string
  /** WireGuard: assigned VPN IP */
  clientVpnIp?: string
  dns?: string
}

// ── Session management types ──────────────────────────────────────────────────

export interface KickSessionOptions {
  permanent?: boolean
  /** WireGuard: peer public key */
  publicKey?: string
  /** WireGuard: VPN IP — required for temporary kick/restore */
  vpnIp?: string
}

export interface KickSessionResult {
  kicked: boolean
  common_name: string
  permanent: boolean
  kill_method: string | null
  kill_response: string | null
  ccd_disabled?: boolean
  [key: string]: unknown
}

export interface UnkickSessionOptions {
  /** WireGuard: peer public key */
  publicKey?: string
  /** WireGuard: VPN IP to restore in allowed-ips */
  vpnIp?: string
}

// ── Client config (CCD / WireGuard peer) types ────────────────────────────────

export interface WriteClientConfigOptions {
  /** WireGuard: peer public key */
  publicKey?: string
  /** OpenVPN CCD: netmask for ifconfig-push */
  netmask?: string
  /** OpenVPN CCD: extra CCD directives */
  extraLines?: string[]
}

// ── Server config update params ───────────────────────────────────────────────

export interface ServerConfigParams {
  port: number
  protocol: 'udp' | 'tcp'
  tunnel_mode: 'full' | 'split'
  vpn_network: string
  vpn_netmask: string
  dns_servers: string
  push_routes?: string
  compression: string
  cipher: string
  keepalive_ping: number
  keepalive_timeout: number
  group_subnets?: string[]
  custom_push_directives?: string
}

// ── Main driver interface ─────────────────────────────────────────────────────

export interface VpnDriver extends EventEmitter {
  // ── Connection ─────────────────────────────────────────────────────────────
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // ── Status / metrics ──────────────────────────────────────────────────────
  getServerInfo(): Promise<VpnServerInfo>
  getClients(): Promise<VpnClient[]>
  getStatus(): Promise<VpnStatus>
  getMetrics(): Promise<VpnMetrics>

  // ── User management ────────────────────────────────────────────────────────
  /** Create a VPN user (cert generation). For WireGuard this is a no-op. */
  createUser(username: string): Promise<Record<string, unknown>>
  /** Revoke a VPN user and disconnect active sessions. */
  revokeUser(username: string, clientCert?: string): Promise<Record<string, unknown>>
  /** Generate client certificate / keypair. */
  generateClientCert(username: string, options?: ClientCertOptions): Promise<ClientCertResult>
  /** Build a client config file (.ovpn or WireGuard conf). */
  generateClientConfig(username: string, options: ClientConfigOptions): Promise<string>

  // ── Session management ─────────────────────────────────────────────────────
  kickSession(commonName: string, options?: KickSessionOptions): Promise<KickSessionResult>
  unkickSession(commonName: string, options?: UnkickSessionOptions): Promise<Record<string, unknown>>

  // ── Config management ──────────────────────────────────────────────────────
  /** Reload the VPN daemon / apply config changes. */
  reload(): Promise<void>
  /** Sync VPN certificates/keys to the central manager database. */
  syncCertificates(): Promise<Record<string, unknown>>
  /** Parse and sync local server config to the central manager database. */
  syncServerConfig(): Promise<Record<string, unknown>>
  /** Write a new server config and reload the daemon. */
  updateServerConfig(params: ServerConfigParams): Promise<Record<string, unknown>>

  // ── Per-client config (CCD / WireGuard peer) ──────────────────────────────
  /** OpenVPN: write CCD ifconfig-push. WireGuard: inject peer with allowed-ips. */
  writeClientConfig(username: string, vpnIp: string, options?: WriteClientConfigOptions): Promise<Record<string, unknown>>
  /** OpenVPN: delete CCD file. WireGuard: remove peer from interface. */
  deleteClientConfig(username: string, options?: { publicKey?: string }): Promise<Record<string, unknown>>

  // ── Low-level ──────────────────────────────────────────────────────────────
  disconnectClient(commonName: string): Promise<void>
  sendCommand(command: string): Promise<string>
}
