import crypto from 'node:crypto'

/**
 * Constant-time comparison of two secrets.
 *
 * `crypto.timingSafeEqual` throws unless both buffers are the same length, so
 * callers usually guard it with a length check — but that guard itself leaks the
 * expected length through timing. Hashing both sides to a fixed 32 bytes first
 * removes the length dependency entirely, so the comparison is constant-time
 * with respect to both content and length.
 *
 * Returns false for null/undefined/empty input so a missing credential can
 * never accidentally match.
 */
export function secretsMatch(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  if (provided.length === 0 || expected.length === 0) return false

  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()

  // Digests are always 32 bytes, so this never throws.
  return crypto.timingSafeEqual(a, b)
}

/**
 * As `secretsMatch`, but trims surrounding whitespace first.
 *
 * Use for credentials that operators paste into env files or shell variables,
 * where a trailing newline is easy to introduce (node registration key, VPN
 * hook token). Trimming happens before hashing, so it stays constant-time with
 * respect to the secret's contents.
 */
export function secretsMatchTrimmed(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  return secretsMatch(provided.trim(), expected.trim())
}
