import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnv } from '../src/config/env'

// `ip` is not available on every dev machine; the real address handling is
// covered by the live Managed DNS E2E scripts.
const { ensureDnsListenerAddresses } = vi.hoisted(() => ({
  ensureDnsListenerAddresses: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/services/managed-dns-listener', () => ({ ensureDnsListenerAddresses }))

import {
  corefileListenerIps,
  ensureCorefileBootstrap,
  restoreDnsListenersFromCorefile,
} from '../src/services/managed-dns-bootstrap'

const roots: string[] = []

async function fixture(dnsEnabled = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vpn-dns-bootstrap-'))
  roots.push(root)
  const env = {
    DNS_ENABLED: dnsEnabled,
    COREDNS_CONFIG_DIR: root,
  } as AgentEnv
  return { root, env }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('ensureCorefileBootstrap', () => {
  it('writes a placeholder Corefile when none exists', async () => {
    const { root, env } = await fixture()
    await ensureCorefileBootstrap(env)
    const written = await fs.readFile(path.join(root, 'Corefile'), 'utf8')
    // coredns must be able to bind and answer health checks immediately,
    // and `reload 2s` so it picks up the real generated config once the
    // first sync_group_dns task writes it.
    expect(written).toContain('.:53 {')
    expect(written).toContain('bind 127.0.0.1')
    expect(written).toContain('health 127.0.0.1:8181')
    expect(written).toContain('reload 2s')
  })

  it('creates the config directory if it does not exist yet', async () => {
    const { root, env } = await fixture()
    env.COREDNS_CONFIG_DIR = path.join(root, 'nested', 'dir')
    await ensureCorefileBootstrap(env)
    await expect(fs.readFile(path.join(env.COREDNS_CONFIG_DIR, 'Corefile'), 'utf8')).resolves.toContain('.:53 {')
  })

  it('never overwrites an existing Corefile', async () => {
    const { root, env } = await fixture()
    await fs.writeFile(path.join(root, 'Corefile'), 'REAL_GENERATED_CONFIG\n')
    await ensureCorefileBootstrap(env)
    await expect(fs.readFile(path.join(root, 'Corefile'), 'utf8')).resolves.toBe('REAL_GENERATED_CONFIG\n')
  })

  it('does nothing when Managed DNS is disabled', async () => {
    const { root, env } = await fixture(false)
    await ensureCorefileBootstrap(env)
    await expect(fs.access(path.join(root, 'Corefile'))).rejects.toThrow()
  })
})

describe('restoreDnsListenersFromCorefile', () => {
  it('extracts unique non-loopback bind addresses', () => {
    const corefile = [
      'corp.internal:53 {', '    bind 10.17.1.53', '}',
      '.:53 {', '    bind 10.17.1.53', '}',
      '.:53 {', '    bind 10.17.2.53 # second group', '}',
      '.:53 {', '    bind 127.0.0.1', '}',
    ].join('\n')
    expect(corefileListenerIps(corefile)).toEqual(['10.17.1.53', '10.17.2.53'])
  })

  it('re-assigns the active Corefile listeners after a reboot', async () => {
    const { root, env } = await fixture()
    await fs.writeFile(path.join(root, 'Corefile'), '.:53 {\n    bind 10.17.1.53\n    health 127.0.0.1:8181\n}\n')
    ensureDnsListenerAddresses.mockClear()
    await restoreDnsListenersFromCorefile(env)
    expect(ensureDnsListenerAddresses).toHaveBeenCalledWith(['10.17.1.53'])
  })

  it('leaves the interface alone for the loopback-only placeholder', async () => {
    const { env } = await fixture()
    await ensureCorefileBootstrap(env)
    ensureDnsListenerAddresses.mockClear()
    await restoreDnsListenersFromCorefile(env)
    expect(ensureDnsListenerAddresses).not.toHaveBeenCalled()
  })

  it('does not throw when assigning the address fails', async () => {
    const { root, env } = await fixture()
    await fs.writeFile(path.join(root, 'Corefile'), '.:53 {\n    bind 10.17.1.53\n}\n')
    ensureDnsListenerAddresses.mockRejectedValueOnce(new Error('ip: not found'))
    await expect(restoreDnsListenersFromCorefile(env)).resolves.toBeUndefined()
  })

  it('does nothing when Managed DNS is disabled', async () => {
    const { root, env } = await fixture(false)
    await fs.writeFile(path.join(root, 'Corefile'), '.:53 {\n    bind 10.17.1.53\n}\n')
    ensureDnsListenerAddresses.mockClear()
    await restoreDnsListenersFromCorefile(env)
    expect(ensureDnsListenerAddresses).not.toHaveBeenCalled()
  })
})
