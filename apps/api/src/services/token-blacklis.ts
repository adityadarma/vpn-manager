/**
 * In-memory JWT Token Blacklist
 *
 * Tracks revoked tokens (on logout or role change) until they naturally expire.
 * Uses a Map with automatic cleanup to prevent memory leaks.
 *
 * For multi-instance deployments, this should be replaced with a shared store
 * (Redis, database table). For single-instance, in-memory is sufficient.
 */

// Map of token JTI (or full token hash) → expiry timestamp (ms)
const blacklist = new Map<string, number>()

// Cleanup interval (every 5 minutes, purge expired entries)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [token, expiresAt] of blacklist) {
      if (expiresAt <= now) {
        blacklist.delete(token)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  // Don't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref()
}

/**
 * Add a token to the blacklist.
 * @param token  The raw JWT token string
 * @param expiresAt  Token expiry time in seconds (from JWT `exp` claim)
 */
export function revokeToken(token: string, expiresAt: number): void {
  startCleanup()
  // Store with expiry in milliseconds
  blacklist.set(token, expiresAt * 1000)
}

/**
 * Revoke all tokens issued before a given timestamp for a specific user.
 * This is used when a user's role changes — we store the user ID + timestamp.
 */
const userRevocations = new Map<string, number>()

export function revokeAllUserTokens(userId: string): void {
  startCleanup()
  userRevocations.set(userId, Date.now())
}

/**
 * Check if a token is blacklisted.
 * @param token  The raw JWT token string
 * @returns true if the token has been revoked
 */
export function isTokenRevoked(token: string): boolean {
  const expiresAt = blacklist.get(token)
  if (expiresAt === undefined) return false
  // If token has naturally expired, clean it up
  if (expiresAt <= Date.now()) {
    blacklist.delete(token)
    return false
  }
  return true
}

/**
 * Check if a user's tokens issued before a certain time should be rejected.
 * @param userId  The user's ID
 * @param issuedAt  Token issued-at time in milliseconds
 * @returns true if tokens issued at that time are revoked
 */
export function isUserTokenRevoked(userId: string, issuedAt: number): boolean {
  const revokedAt = userRevocations.get(userId)
  if (revokedAt === undefined) return false
  return issuedAt < revokedAt
}

/**
 * Stop the cleanup timer (for graceful shutdown).
 */
export function stopBlacklistCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
