import crypto from 'node:crypto'
import type { Knex } from 'knex'

/**
 * Persistent JWT revocation store.
 *
 * Previously two in-memory Maps. That had three problems:
 *  - a process restart cleared every revocation, so with JWT_EXPIRES_IN=7d a
 *    logged-out token became usable again,
 *  - revocations never reached other replicas, and
 *  - the per-user map was never pruned, so it grew without bound.
 *
 * Now backed by the `revoked_tokens` and `user_token_revocations` tables, with
 * a background sweeper (see TokenRevocationSweeper) deleting rows once they can
 * no longer change a verification outcome.
 *
 * Reads hit the database on each authenticated request rather than a cache:
 * both are primary-key lookups, and it keeps a logout effective immediately
 * across every instance. If that ever shows up in profiling, a short-TTL cache
 * can be added — but correctness first.
 */

/** Tokens are stored hashed so a database leak cannot be replayed. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Default assumed maximum token lifetime, used to expire user-level cutoffs. */
const DEFAULT_MAX_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Revoke a single token (logout).
 *
 * @param expiresAtSeconds the token's own `exp` claim, in seconds
 * @param userId optional owner, recorded for auditing only — revocation
 *               decisions are made on the token hash alone
 */
export async function revokeToken(
  db: Knex,
  token: string,
  expiresAtSeconds: number,
  userId?: string | null,
): Promise<void> {
  const tokenHash = hashToken(token)
  const expiresAt = new Date(expiresAtSeconds * 1000)

  // Re-revoking the same token must not error.
  const existing = await db('revoked_tokens').where({ token_hash: tokenHash }).first()
  if (existing) return

  await db('revoked_tokens').insert({
    token_hash: tokenHash,
    user_id: userId ?? null,
    expires_at: expiresAt,
    revoked_at: new Date(),
  })
}

/**
 * Revoke every token issued to a user before now (role change, forced logout).
 */
export async function revokeAllUserTokens(
  db: Knex,
  userId: string,
  maxTokenLifetimeMs: number = DEFAULT_MAX_TOKEN_LIFETIME_MS,
): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + maxTokenLifetimeMs)

  const existing = await db('user_token_revocations').where({ user_id: userId }).first()
  if (existing) {
    await db('user_token_revocations')
      .where({ user_id: userId })
      .update({ revoked_at: now, expires_at: expiresAt })
    return
  }

  await db('user_token_revocations').insert({
    user_id: userId,
    revoked_at: now,
    expires_at: expiresAt,
  })
}

/** True if this exact token was revoked and has not yet expired on its own. */
export async function isTokenRevoked(db: Knex, token: string): Promise<boolean> {
  const row = await db('revoked_tokens')
    .where({ token_hash: hashToken(token) })
    .first()

  if (!row) return false

  // Past its own exp: the JWT is invalid regardless, let the sweeper drop it.
  return new Date(row.expires_at).getTime() > Date.now()
}

/**
 * True if this user's tokens issued at `issuedAtMs` are covered by a
 * user-level revocation.
 */
export async function isUserTokenRevoked(
  db: Knex,
  userId: string,
  issuedAtMs: number,
): Promise<boolean> {
  const row = await db('user_token_revocations').where({ user_id: userId }).first()
  if (!row) return false
  return issuedAtMs < new Date(row.revoked_at).getTime()
}

/**
 * Background pruning of revocation rows.
 *
 * A row only matters until the token it covers would have expired anyway, so
 * anything with `expires_at <= now` is deleted. Follows the same start/stop
 * shape as NodeStatusChecker.
 */
export class TokenRevocationSweeper {
  private db: Knex
  private intervalId: NodeJS.Timeout | null = null
  private readonly intervalMs: number

  constructor(db: Knex, intervalMs: number = 60 * 60 * 1000) {
    this.db = db
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.intervalId) {
      console.warn('[TokenRevocationSweeper] Already running')
      return
    }

    console.log(`[TokenRevocationSweeper] Starting (sweep every ${this.intervalMs}ms)`)

    // Sweep once at boot to clear anything that expired while we were down.
    void this.sweep()

    this.intervalId = setInterval(() => {
      void this.sweep()
    }, this.intervalMs)

    // Never hold the process open for this.
    if (this.intervalId.unref) this.intervalId.unref()
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[TokenRevocationSweeper] Stopped')
    }
  }

  /** Delete revocation rows that can no longer affect any decision. */
  async sweep(): Promise<{ tokens: number; users: number }> {
    const now = new Date()
    try {
      const tokens = await this.db('revoked_tokens').where('expires_at', '<=', now).del()
      const users = await this.db('user_token_revocations').where('expires_at', '<=', now).del()

      if (tokens > 0 || users > 0) {
        console.log(
          `[TokenRevocationSweeper] Pruned ${tokens} expired token(s), ${users} user revocation(s)`,
        )
      }
      return { tokens, users }
    } catch (err) {
      // Never let a sweep failure take down the process.
      console.error(`[TokenRevocationSweeper] Sweep failed: ${(err as Error).message}`)
      return { tokens: 0, users: 0 }
    }
  }
}
