/**
 * VPN IP Pool Service
 *
 * Assigns available IPs from a group's subnet (CIDR notation).
 * Supports /24, /23, /22, /16 and any valid prefix length.
 *
 * Reserved:
 *   .0   — network address
 *   .1   — typically gateway / OpenVPN server tun0
 *   .255 — broadcast (for /24)
 *
 * We start assigning from host offset 10 to leave room for
 * infrastructure addresses (.2 - .9).
 */

/**
 * Convert a CIDR string like "10.8.1.0/24" into its components.
 */
export function parseCidr(cidr: string): { networkInt: number; prefixLen: number; netmask: string } {
  const [addr, prefixStr] = cidr.split('/')
  if (!addr || !prefixStr) throw new Error(`Invalid CIDR: ${cidr}`)

  const prefixLen = parseInt(prefixStr, 10)
  if (isNaN(prefixLen) || prefixLen < 8 || prefixLen > 30) {
    throw new Error(`Unsupported prefix length: /${prefixLen}`)
  }

  const parts = addr.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IP address: ${addr}`)
  }

  const networkInt = (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!
  const maskInt = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0
  const maskedNetwork = (networkInt & maskInt) >>> 0

  // Generate netmask string
  const netmask = [
    (maskInt >>> 24) & 0xff,
    (maskInt >>> 16) & 0xff,
    (maskInt >>> 8) & 0xff,
    maskInt & 0xff,
  ].join('.')

  return { networkInt: maskedNetwork, prefixLen, netmask }
}

/**
 * Convert a 32-bit integer to dotted IP string.
 */
function intToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.')
}

/**
 * Find the next available IP from a subnet that is not in the usedIps set.
 *
 * @param subnet   CIDR, e.g. "10.8.1.0/24"
 * @param usedIps  Array of IPs already assigned (e.g. ["10.8.1.10", "10.8.1.11"])
 * @returns        Next free IP string, or null if the subnet is full
 */
export function nextAvailableIp(subnet: string, usedIps: string[]): string | null {
  const { networkInt, prefixLen, netmask: _netmask } = parseCidr(subnet)
  const hostBits = 32 - prefixLen
  const totalHosts = (1 << hostBits) >>> 0
  const broadcastInt = (networkInt + totalHosts - 1) >>> 0

  const usedSet = new Set(usedIps.filter(Boolean))

  // Start from offset 10 (skip .0 network, .1 gateway, .2-.9 reserved)
  for (let offset = 10; offset < totalHosts - 1; offset++) {
    const candidate = (networkInt + offset) >>> 0
    if (candidate >= broadcastInt) break // never assign broadcast
    const ip = intToIp(candidate)
    if (!usedSet.has(ip)) return ip
  }

  return null // subnet exhausted
}

/**
 * Get the netmask string from a CIDR.
 * e.g. "10.8.1.0/24" → "255.255.255.0"
 */
export function getNetmask(subnet: string): string {
  return parseCidr(subnet).netmask
}

/**
 * Validate that an IP belongs to a given subnet.
 */
export function ipInSubnet(ip: string, subnet: string): boolean {
  const { networkInt, prefixLen } = parseCidr(subnet)
  const maskInt = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return false
  const ipInt = (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!
  return ((ipInt & maskInt) >>> 0) === networkInt
}

/**
 * Convert a CIDR to an OpenVPN route directive string.
 * e.g. "172.31.0.0/16" → "route 172.31.0.0 255.255.0.0"
 */
export function cidrToRoute(cidr: string): string {
  const { networkInt, netmask } = parseCidr(cidr)
  const ip = intToIp(networkInt)
  return `route ${ip} ${netmask}`
}

/**
 * Convert multiple CIDRs to OpenVPN push route directives.
 * e.g. ["172.31.0.0/16", "10.130.0.0/20"]
 *   → ['push "route 172.31.0.0 255.255.0.0"', 'push "route 10.130.0.0 255.255.240.0"']
 */
export function cidrsToPushRoutes(cidrs: string[]): string[] {
  return cidrs
    .filter(c => c?.trim())
    .map(c => `push "${cidrToRoute(c.trim())}"`)
}
