import { describe, it, expect } from 'vitest'
import { secretsMatch, secretsMatchTrimmed } from '../src/utils/secret-compare'

/**
 * Constant-time credential comparison.
 *
 * Timing behaviour itself is not asserted — that is not reliably measurable in
 * a unit test. What is checked here is that the helper is *correct*, since a
 * constant-time comparison that returns the wrong answer would be far worse
 * than the plain `!==` it replaced.
 */
describe('secretsMatch', () => {
  it('accepts identical secrets', () => {
    expect(secretsMatch('correct-horse-battery', 'correct-horse-battery')).toBe(true)
  })

  it('rejects a same-length mismatch', () => {
    expect(secretsMatch('agent-secret-tokeX', 'agent-secret-token')).toBe(false)
  })

  it('rejects a prefix of the expected secret', () => {
    expect(secretsMatch('agent-secret', 'agent-secret-token')).toBe(false)
  })

  it('rejects a secret that extends the expected one', () => {
    expect(secretsMatch('agent-secret-token-extra', 'agent-secret-token')).toBe(false)
  })

  it('is case sensitive', () => {
    expect(secretsMatch('Token', 'token')).toBe(false)
  })

  it('does not trim by default', () => {
    expect(secretsMatch(' token', 'token')).toBe(false)
    expect(secretsMatch('token\n', 'token')).toBe(false)
  })

  it('rejects empty input on either side', () => {
    expect(secretsMatch('', '')).toBe(false)
    expect(secretsMatch('', 'token')).toBe(false)
    expect(secretsMatch('token', '')).toBe(false)
  })

  it('rejects non-string input rather than throwing', () => {
    // A missing header or unset env var must never match.
    expect(secretsMatch(undefined, 'token')).toBe(false)
    expect(secretsMatch('token', undefined)).toBe(false)
    expect(secretsMatch(null, null)).toBe(false)
    expect(secretsMatch(0, 0)).toBe(false)
    expect(secretsMatch({}, 'token')).toBe(false)
  })

  it('handles long secrets and unicode', () => {
    const long = 'x'.repeat(4096)
    expect(secretsMatch(long, long)).toBe(true)
    expect(secretsMatch(long, long + 'y')).toBe(false)
    expect(secretsMatch('токен-🔐', 'токен-🔐')).toBe(true)
    expect(secretsMatch('токен-🔐', 'токен-🔑')).toBe(false)
  })
})

describe('secretsMatchTrimmed', () => {
  it('ignores surrounding whitespace on both sides', () => {
    expect(secretsMatchTrimmed('  token  ', 'token')).toBe(true)
    expect(secretsMatchTrimmed('token', '\ttoken\n')).toBe(true)
    expect(secretsMatchTrimmed('token\r\n', 'token')).toBe(true)
  })

  it('still rejects a genuine mismatch', () => {
    expect(secretsMatchTrimmed('  wrong  ', 'token')).toBe(false)
  })

  it('does not treat inner whitespace as insignificant', () => {
    expect(secretsMatchTrimmed('to ken', 'token')).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    // Trims to empty, which must not match anything.
    expect(secretsMatchTrimmed('   ', '   ')).toBe(false)
    expect(secretsMatchTrimmed('   ', 'token')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(secretsMatchTrimmed(undefined, 'token')).toBe(false)
    expect(secretsMatchTrimmed('token', null)).toBe(false)
  })
})
