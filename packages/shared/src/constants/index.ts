import packageJson from '../../package.json' with { type: 'json' }

// Destructured in a separate statement, not inlined as
// `packageJson.version` in the export itself — Rolldown/Vite's JSON-module
// interop has been observed to inline the whole default-exported object in
// place of an inline property access, which silently rendered the entire
// package.json in the UI instead of the version string.
const { version } = packageJson

/**
 * Application version, reported by GET /api/v1/health and shown in the UI.
 *
 * Read directly from this package's package.json instead of a hardcoded
 * string, so it can never drift out of sync — the previous hardcoded value
 * silently fell behind because .github/workflows/release.yml bumps every
 * package.json on release but did not update this literal.
 */
export const APP_VERSION = version

export const AGENT = {
  POLL_INTERVAL_MS: 5_000,
  HEARTBEAT_INTERVAL_MS: 30_000,
  NODE_OFFLINE_THRESHOLD_MS: 60_000,
} as const

export const JWT = {
  ALGORITHM: 'HS256' as const,
  DEFAULT_EXPIRES_IN: '7d',
} as const

export const VPN = {
  DEFAULT_NETWORK: '10.8.0.0',
  DEFAULT_SUBNET: '255.255.255.0',
  DEFAULT_PORT: 1194,
  DEFAULT_PROTOCOL: 'udp' as const,
} as const

export const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
} as const
