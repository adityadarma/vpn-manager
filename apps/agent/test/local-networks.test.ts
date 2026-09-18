import { describe, it, expect } from 'vitest'
import type os from 'node:os'
import {
  findConflictingLocalNetwork,
  localIpv4Networks,
  parseIpv4Cidr,
} from '../src/core/local-networks'
import { computeServerRoutes } from '../src/drivers/openvpn.driver'

/**
 * Build a `os.networkInterfaces()` shaped object. Only the fields the detector
 * reads are populated.
 */
function iface(
  address: string,
  netmask: string,
  options: { internal?: boolean; family?: 'IPv4' | 'IPv6' } = {},
): os.NetworkInterfaceInfo[] {
  return [
    {
      address,
      netmask,
      family: options.family ?? 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: options.internal ?? false,
      cidr: `${address}/0`,
    } as os.NetworkInterfaceInfo,
  ]
}

describe('parseIpv4Cidr', () => {
  it('normalises a host address to its network address', () => {
    expect(parseIpv4Cidr('172.31.10.64/20')).toEqual(parseIpv4Cidr('172.31.0.0/20'))
  })

  it('rejects malformed input instead of throwing', () => {
    for (const bad of ['', 'not-a-cidr', '172.31.0.0', '172.31.0.0/33', '999.1.1.1/24']) {
      expect(parseIpv4Cidr(bad)).toBeNull()
    }
  })
})

describe('localIpv4Networks', () => {
  it('reports the attached network for a normal NIC', () => {
    expect(localIpv4Networks({ ens5: iface('172.31.10.64', '255.255.240.0') })).toEqual([
      { interfaceName: 'ens5', address: '172.31.10.64', network: '172.31.0.0', prefix: 20 },
    ])
  })

  it('ignores loopback, IPv6, and the VPN interfaces it manages', () => {
    const interfaces = {
      lo: iface('127.0.0.1', '255.0.0.0', { internal: true }),
      eth0: iface('fe80::1', 'ffff::', { family: 'IPv6' }),
      tun0: iface('10.17.0.1', '255.255.255.0'),
      wg0: iface('10.18.0.1', '255.255.255.0'),
    }
    expect(localIpv4Networks(interfaces)).toEqual([])
  })

  it('ignores a /32 address, which has no surrounding subnet', () => {
    expect(localIpv4Networks({ ens5: iface('203.0.113.7', '255.255.255.255') })).toEqual([])
  })
})

describe('findConflictingLocalNetwork', () => {
  // The reported failure: node at 172.31.10.64/20 assigned network 172.31.0.0/20.
  const locals = localIpv4Networks({ ens5: iface('172.31.10.64', '255.255.240.0') })

  it('flags a CIDR identical to the node\u2019s own subnet', () => {
    const conflict = findConflictingLocalNetwork('172.31.0.0/20', locals)
    expect(conflict).not.toBeNull()
    expect(conflict?.interfaceName).toBe('ens5')
    expect(conflict?.address).toBe('172.31.10.64')
  })

  it('flags a CIDR wider than the local subnet', () => {
    expect(findConflictingLocalNetwork('172.31.0.0/16', locals)).not.toBeNull()
  })

  it('flags a narrower CIDR carved out of the local subnet', () => {
    // Half the node's own subnet diverted into the tunnel is still a conflict.
    expect(findConflictingLocalNetwork('172.31.10.0/24', locals)).not.toBeNull()
  })

  it('allows an unrelated private network', () => {
    expect(findConflictingLocalNetwork('10.50.0.0/16', locals)).toBeNull()
    // Adjacent to, but outside, 172.31.0.0/20.
    expect(findConflictingLocalNetwork('172.31.16.0/20', locals)).toBeNull()
  })

  it('allows everything when the node has no attached networks', () => {
    expect(findConflictingLocalNetwork('172.31.0.0/20', [])).toBeNull()
  })
})

describe('computeServerRoutes', () => {
  // VPN pool used by the node under test.
  const serverNet = '10.17.0.0'
  const serverMask = '255.255.255.0'
  const locals = localIpv4Networks({ ens5: iface('172.31.10.64', '255.255.240.0') })

  it('rejects the subnet the node is attached to, naming the interface', () => {
    expect(() => computeServerRoutes(['172.31.0.0/20'], serverNet, serverMask, locals)).toThrow(
      /Refusing to route 172\.31\.0\.0\/20.*172\.31\.0\.0\/20 on ens5 \(172\.31\.10\.64\)/s,
    )
  })

  it('rejects the whole batch rather than writing a partial route set', () => {
    // A good CIDR ahead of the conflicting one must not mask the failure.
    expect(() =>
      computeServerRoutes(['10.50.0.0/16', '172.31.0.0/20'], serverNet, serverMask, locals),
    ).toThrow(/Refusing to route 172\.31\.0\.0\/20/)
  })

  it('emits a route for a genuinely remote subnet', () => {
    expect(computeServerRoutes(['10.50.0.0/16'], serverNet, serverMask, locals)).toEqual([
      { network: '10.50.0.0', netmask: '255.255.0.0', cidr: '10.50.0.0/16' },
    ])
  })

  it('skips subnets already inside the VPN pool', () => {
    expect(computeServerRoutes(['10.17.0.0/24'], serverNet, serverMask, locals)).toEqual([])
  })

  it('de-duplicates subnets that normalise to the same route', () => {
    const routes = computeServerRoutes(
      ['10.50.0.0/16', '10.50.1.2/16'],
      serverNet,
      serverMask,
      locals,
    )
    expect(routes).toHaveLength(1)
  })

  it('normalises a host address to its network address', () => {
    expect(computeServerRoutes(['10.50.7.9/16'], serverNet, serverMask, locals)).toEqual([
      { network: '10.50.0.0', netmask: '255.255.0.0', cidr: '10.50.7.9/16' },
    ])
  })
})
