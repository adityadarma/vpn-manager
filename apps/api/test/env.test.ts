import { describe, it, expect, afterEach, vi } from 'vitest'
import { findPlaceholderSecrets, loadEnv } from '../src/config/env'

const REAL_SECRET = 'k3Jx9Qm2Zp7Rv5Tn8Wb4Yc6Ud1Fg0HsLaOe'

describe('placeholder secrets', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
    vi.restoreAllMocks()
  })

  it('detects template values case-insensitively', () => {
    expect(
      findPlaceholderSecrets({
        JWT_SECRET: 'CHANGE_ME_TO_A_LONG_RANDOM_STRING_000000',
        NODE_REGISTRATION_KEY: 'change-me-key',
        VPN_TOKEN: REAL_SECRET,
      }),
    ).toEqual(['JWT_SECRET', 'NODE_REGISTRATION_KEY'])
  })

  it('ignores unset and generated values', () => {
    expect(findPlaceholderSecrets({ JWT_SECRET: REAL_SECRET })).toEqual([])
  })

  it('exits in production when a secret is a placeholder', () => {
    process.env = { ...original, NODE_ENV: 'production', JWT_SECRET: 'CHANGE_ME_TO_A_LONG_RANDOM_STRING_000000' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    expect(() => loadEnv()).toThrow('exit')
  })

  it('only warns outside production', () => {
    process.env = { ...original, NODE_ENV: 'development', JWT_SECRET: 'CHANGE_ME_TO_A_LONG_RANDOM_STRING_000000' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    expect(loadEnv().JWT_SECRET).toContain('CHANGE_ME')
    expect(warn).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
  })

  it('accepts generated secrets in production', () => {
    process.env = { ...original, NODE_ENV: 'production', JWT_SECRET: REAL_SECRET, VPN_TOKEN: REAL_SECRET }
    delete process.env['NODE_REGISTRATION_KEY']
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    expect(loadEnv().NODE_ENV).toBe('production')
    expect(exit).not.toHaveBeenCalled()
  })
})
