import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isValidIpv4 } from '../core/net-validate'

const execFileAsync = promisify(execFile)

/**
 * Dedicated interface that owns every Managed DNS listener address.
 *
 * A group listener such as 10.8.10.53 sits inside the node VPN pool but is
 * never handed to a client, so nothing else assigns it. Without a local
 * address CoreDNS cannot bind it and exits with
 * "bind: cannot assign requested address" — reproduced on a real node.
 *
 * A dummy interface is used rather than the tunnel itself so the listener does
 * not depend on tun0/wg0 already being up, and so tearing Managed DNS down
 * never touches addresses owned by the VPN engine.
 */
const DNS_INTERFACE = 'vpn-dns0'

async function run(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('ip', args)
  return stdout
}

async function interfaceExists(): Promise<boolean> {
  try {
    await run(['link', 'show', DNS_INTERFACE])
    return true
  } catch {
    return false
  }
}

/** Returns the /32 addresses currently held by the Managed DNS interface. */
export async function currentDnsListenerAddresses(): Promise<string[]> {
  return currentAddresses()
}

async function currentAddresses(): Promise<string[]> {
  try {
    const stdout = await run(['-4', '-oneline', 'addr', 'show', 'dev', DNS_INTERFACE])
    return stdout
      .split('\n')
      .map((line) => /\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\/\d{1,2}/.exec(line)?.[1])
      .filter((address): address is string => !!address)
  } catch {
    return []
  }
}

/**
 * Makes `listenerIps` the exact set of addresses on the Managed DNS interface.
 *
 * Idempotent: re-running with the same input performs no changes, and a
 * listener removed from the Manager is also removed from the node.
 */
export async function ensureDnsListenerAddresses(listenerIps: string[]): Promise<void> {
  for (const ip of listenerIps) {
    if (!isValidIpv4(ip)) throw new Error(`Invalid DNS listener IP: ${ip}`)
  }

  if (listenerIps.length === 0) {
    await removeDnsListenerAddresses()
    return
  }

  if (!(await interfaceExists())) {
    await run(['link', 'add', DNS_INTERFACE, 'type', 'dummy'])
  }
  await run(['link', 'set', DNS_INTERFACE, 'up'])

  const desired = new Set(listenerIps)
  const existing = await currentAddresses()

  for (const ip of existing) {
    if (!desired.has(ip)) {
      await run(['addr', 'del', `${ip}/32`, 'dev', DNS_INTERFACE]).catch(() => undefined)
    }
  }
  for (const ip of desired) {
    if (existing.includes(ip)) continue
    try {
      await run(['addr', 'add', `${ip}/32`, 'dev', DNS_INTERFACE])
    } catch (error) {
      // Two sync tasks can overlap: the Agent poller runs on an interval, so a
      // sync slower than that interval is still running when the next poll
      // starts. Both read the address as absent and both try to add it, and the
      // loser fails with "Address already assigned".
      //
      // The post-condition is what matters — the address must exist on this
      // interface — so verify rather than fail. Reproduced on a real node.
      const message = String((error as Error).message ?? '')
      const alreadyAssigned = /file exists|already assigned/i.test(message)
      if (!alreadyAssigned || !(await currentAddresses()).includes(ip)) throw error
    }
  }
}

/** Drops the interface entirely. Used when a node has no DNS listener left. */
export async function removeDnsListenerAddresses(): Promise<void> {
  if (!(await interfaceExists())) return
  await run(['link', 'del', DNS_INTERFACE]).catch(() => undefined)
}
