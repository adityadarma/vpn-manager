// Detection of the networks this node is directly attached to.
//
// `updateServerConfig` writes server-side `route` directives into server.conf so
// OpenVPN can reach subnets that sit behind the node. Those directives point at
// the tunnel. If a directive covers a subnet the node itself lives in, the
// kernel installs a competing route with a lower metric than the NIC route and
// the node stops reaching its own network, including its default gateway and
// anything in the same cloud VPC.
//
// The manager cannot catch this on its own: `vpn_nodes.ip_address` holds the
// public address discovered during install, not the private NIC address, so the
// node is the only place that knows its real attachments.

import os from 'node:os'

export interface LocalIpv4Network {
  /** Interface the address is bound to, e.g. `ens5`. */
  interfaceName: string
  /** Address bound to the interface, e.g. `172.31.10.64`. */
  address: string
  /** Network address of the attached subnet, e.g. `172.31.0.0`. */
  network: string
  /** Prefix length of the attached subnet, e.g. `20`. */
  prefix: number
}

/**
 * Interfaces the VPN itself owns. Routes for these are managed deliberately and
 * must not be treated as a pre-existing local attachment.
 */
const VPN_INTERFACE_RE = /^(tun|tap|wg)\d*$/i

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let acc = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    acc = ((acc << 8) | octet) >>> 0
  }
  return acc
}

function netmaskToPrefix(netmask: string): number | null {
  const asInt = ipToInt(netmask)
  if (asInt === null) return null
  // A valid mask is a run of ones followed by a run of zeros. Reject anything
  // else rather than silently deriving a nonsense prefix from it.
  const inverted = (~asInt >>> 0) + 1
  if ((inverted & (inverted - 1)) !== 0) return null
  let prefix = 0
  for (let bit = 31; bit >= 0; bit--) {
    if ((asInt & (1 << bit)) === 0) break
    prefix++
  }
  return prefix
}

function networkAddress(ipInt: number, prefix: number): number {
  if (prefix === 0) return 0
  return (ipInt & (((0xffffffff << (32 - prefix)) >>> 0) as number)) >>> 0
}

/**
 * Parse `a.b.c.d/nn`. Returns null for anything malformed so callers can skip
 * the entry instead of throwing on data that never reached the kernel.
 */
export function parseIpv4Cidr(cidr: string): { networkInt: number; prefix: number } | null {
  const [addr, prefixStr] = cidr.trim().split('/')
  if (!addr || !prefixStr || !/^\d{1,2}$/.test(prefixStr)) return null
  const prefix = Number(prefixStr)
  if (prefix < 0 || prefix > 32) return null
  const asInt = ipToInt(addr)
  if (asInt === null) return null
  return { networkInt: networkAddress(asInt, prefix), prefix }
}

/**
 * IPv4 networks this node is directly attached to, excluding loopback and the
 * VPN's own interfaces.
 */
export function localIpv4Networks(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LocalIpv4Network[] {
  const found: LocalIpv4Network[] = []

  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue
    if (VPN_INTERFACE_RE.test(interfaceName)) continue

    for (const entry of addresses) {
      // `family` is 'IPv4' on modern Node and 4 on some older typings.
      const isIpv4 = entry.family === 'IPv4' || (entry.family as unknown as number) === 4
      if (!isIpv4 || entry.internal) continue

      const addressInt = ipToInt(entry.address)
      const prefix = netmaskToPrefix(entry.netmask)
      if (addressInt === null || prefix === null) continue
      // A /32 has no surrounding subnet to protect.
      if (prefix >= 32) continue

      found.push({
        interfaceName,
        address: entry.address,
        network: [24, 16, 8, 0]
          .map((shift) => (networkAddress(addressInt, prefix) >>> shift) & 0xff)
          .join('.'),
        prefix,
      })
    }
  }

  return found
}

/**
 * The first locally attached network that overlaps `cidr`, or null when none do.
 *
 * Overlap rather than containment is the right test: a narrower CIDR such as
 * `172.31.10.0/24` inside a local `172.31.0.0/20` would still divert part of the
 * node's own subnet into the tunnel.
 */
export function findConflictingLocalNetwork(
  cidr: string,
  locals: LocalIpv4Network[] = localIpv4Networks(),
): LocalIpv4Network | null {
  const parsed = parseIpv4Cidr(cidr)
  if (!parsed) return null

  for (const local of locals) {
    const shorter = Math.min(parsed.prefix, local.prefix)
    const localInt = ipToInt(local.address)
    if (localInt === null) continue
    if (networkAddress(parsed.networkInt, shorter) === networkAddress(localInt, shorter)) {
      return local
    }
  }

  return null
}
