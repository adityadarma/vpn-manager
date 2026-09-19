import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Shared execution policy for privileged firewall commands.
 *
 * Every firewall command is a short-lived local process. If one has not
 * finished by now it is wedged, not slow — most often blocked on
 * /run/xtables.lock held by Docker, ufw or fail2ban. Without a timeout the
 * handler never returns, the agent never reports a result, and the manager
 * leaves the task in 'running' until the stale-task reaper times it out.
 */
export const FIREWALL_EXEC_TIMEOUT_MS = 30_000

/**
 * Seconds iptables itself will wait for the xtables lock before giving up.
 * Prefer this over failing instantly: contention is normally brief, and a short
 * wait avoids spurious task failures on hosts that also run Docker.
 */
export const IPTABLES_LOCK_WAIT_SECONDS = 5

export type FirewallEngine = 'iptables' | 'nftables' | 'firewalld' | 'ufw'

/** iptables invocation that waits for the xtables lock instead of failing fast. */
export function iptablesInvocation(command: 'iptables' | 'iptables-legacy' = 'iptables'): string {
  return `${command} -w ${IPTABLES_LOCK_WAIT_SECONDS}`
}

/**
 * Runs a firewall command under a hard timeout, passing failures through
 * unwrapped.
 *
 * Use for probe commands (`-C`, `list chain`) whose caller inspects the
 * rejection itself — wrapping would hide the exit code they branch on.
 */
export function execFirewallRaw(cmd: string) {
  return execAsync(cmd, { timeout: FIREWALL_EXEC_TIMEOUT_MS })
}

/**
 * Runs a firewall command, converting any failure into a descriptive Error.
 *
 * A missing firewall binary or a lock timeout means the rule was not installed.
 * Never let either turn into a successful task result.
 */
export async function execFirewall(cmd: string, engine: FirewallEngine | string): Promise<void> {
  try {
    await execFirewallRaw(cmd)
  } catch (err: any) {
    // `timeout` kills the child with a signal; that is how we distinguish a
    // wedged command from one that merely exited non-zero.
    if (err?.killed && err?.signal) {
      throw new Error(
        `${engine} command timed out after ${FIREWALL_EXEC_TIMEOUT_MS}ms (likely blocked on the firewall lock): ${cmd}`,
      )
    }
    throw new Error(`${engine} command failed: ${err.message}`)
  }
}
