import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentEnv } from '../config/env'

/**
 * Writes a minimal placeholder Corefile at startup, if one is not already
 * there.
 *
 * The real Corefile is only written after the first successful
 * `sync_group_dns` task (see handlers/sync-group-dns.ts). On a fresh
 * `managed-dns` volume — a brand-new node, or one where Managed DNS has never
 * synced yet — that file does not exist, and the coredns container (which
 * mounts the same volume read-only) fails immediately with
 * "open /etc/coredns/Corefile: no such file or directory" and then
 * crash-loops under `restart: unless-stopped`.
 *
 * The Agent always starts before coredns can serve traffic, and already has
 * write access to the same COREDNS_CONFIG_DIR volume, so it is the natural
 * place to guarantee the file exists — no extra container needed.
 *
 * `reload 2s` in the placeholder is required, not cosmetic: without it,
 * CoreDNS keeps serving this placeholder forever once loaded and never picks
 * up the real generated config, even though the health endpoint still
 * reports OK.
 */
const PLACEHOLDER_COREFILE = `.:53 {
    bind 127.0.0.1
    health 127.0.0.1:8181
    reload 2s
    errors
}
`

export async function ensureCorefileBootstrap(env: AgentEnv): Promise<void> {
  if (!env.DNS_ENABLED) return

  const corefile = path.join(path.resolve(env.COREDNS_CONFIG_DIR), 'Corefile')
  try {
    await fs.access(corefile)
    // Already exists — a previous sync (or a previous bootstrap) wrote it.
    // Never overwrite a real generated config with the placeholder.
    return
  } catch {
    // Falls through: file does not exist yet.
  }

  try {
    await fs.mkdir(path.dirname(corefile), { recursive: true })
    await fs.writeFile(corefile, PLACEHOLDER_COREFILE, { mode: 0o644 })
    console.log(`[startup] Wrote placeholder Corefile at ${corefile} (coredns can start before the first Managed DNS sync)`)
  } catch (error) {
    console.warn(`[startup] Failed to write placeholder Corefile: ${(error as Error).message}`)
  }
}
