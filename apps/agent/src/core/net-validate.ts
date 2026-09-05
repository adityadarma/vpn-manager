// Shared input validation for agent handlers (defense-in-depth).
//
// Values validated here reach privileged operations: firewall shell commands,
// EasyRSA invocations, the OpenVPN management socket, and file paths under
// /etc/openvpn. The agent must not assume the manager already validated them —
// a compromised manager or a direct DB write can enqueue arbitrary payloads.
//
// We accept only strict IPv4 / CIDR / port / username formats, and constrain
// path segments to bare filenames inside an expected directory.

import path from 'node:path'

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV4_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/
const PORT_RE = /^\d{1,5}(:\d{1,5})?$/

function octetsValid(parts: string[]): boolean {
  return parts.every((o) => {
    const n = Number(o)
    return Number.isInteger(n) && n >= 0 && n <= 255
  })
}

export function isValidIpv4(value: string): boolean {
  const m = IPV4_RE.exec(value)
  return !!m && octetsValid(m.slice(1, 5))
}

export function isValidIpv4Cidr(value: string): boolean {
  const m = IPV4_CIDR_RE.exec(value)
  if (!m) return false
  if (!octetsValid(m.slice(1, 5))) return false
  const prefix = Number(m[5])
  return prefix >= 0 && prefix <= 32
}

export function isValidIpOrCidr(value: string): boolean {
  return isValidIpv4(value) || isValidIpv4Cidr(value)
}

export function isValidPort(value: string): boolean {
  if (!PORT_RE.test(value)) return false
  return value.split(':').every((p) => {
    const n = Number(p)
    return Number.isInteger(n) && n >= 0 && n <= 65535
  })
}

// A WireGuard public key is exactly 32 bytes: 43 base64 characters and one '='.
const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/

// Mirrors CreateUserSchema in packages/shared/src/schemas/user.schema.ts.
// Kept in sync deliberately: the API already enforces this, but the agent must
// not depend on the manager having done so (defense-in-depth — a compromised
// manager, or a direct DB write, can enqueue arbitrary task payloads).
const USERNAME_RE = /^[a-zA-Z0-9_-]+$/
const USERNAME_MIN = 3
const USERNAME_MAX = 32

export function isValidUsername(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) return false
  return USERNAME_RE.test(value)
}

export function isValidPortNumber(value: unknown): boolean {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

export function isValidWgKey(value: string): boolean {
  return WG_KEY_RE.test(value)
}

/**
 * Throws if the value is not a valid IPv4 address or CIDR.
 * Use to guard values before they reach privileged shell commands.
 */
export function assertIpOrCidr(value: string, field: string): void {
  if (!isValidIpOrCidr(value)) {
    throw new Error(`Invalid ${field}: "${value}" is not a valid IPv4 address or CIDR`)
  }
}

export function assertIpv4(value: string, field: string): void {
  if (!isValidIpv4(value)) {
    throw new Error(`Invalid ${field}: "${value}" is not a valid IPv4 address`)
  }
}

export function assertPortNumber(value: unknown, field: string): void {
  if (!isValidPortNumber(value)) {
    throw new Error(`Invalid ${field}: "${value}" is not a valid port (1-65535)`)
  }
}

export function assertWgKey(value: string, field: string): void {
  if (!isValidWgKey(value)) {
    throw new Error(`Invalid ${field}: not a valid WireGuard key`)
  }
}

/**
 * Throws unless the value is a well-formed VPN username.
 *
 * Returns the value so it can be used inline when building a command or path.
 * (The assert* helpers above return void; this one returns the string because
 * every call site immediately uses the result.)
 */
export function assertUsername(value: unknown, field = 'username'): string {
  if (!isValidUsername(value)) {
    throw new Error(
      `Invalid ${field}: must be ${USERNAME_MIN}-${USERNAME_MAX} chars of [a-zA-Z0-9_-]`,
    )
  }
  return value
}

/**
 * Resolves `segment` inside `baseDir` and throws if the result would escape it.
 *
 * Two layers on purpose:
 *  1. reject anything that is not a bare filename (separators, '..', NUL), and
 *  2. verify the resolved absolute path is still under baseDir.
 *
 * The second check catches symlinked or otherwise unexpected baseDir values
 * that a pure basename test would miss.
 */
export function resolveWithin(baseDir: string, segment: unknown, field: string): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new Error(`Invalid ${field}: must be a non-empty string`)
  }
  if (segment.includes('\u0000')) {
    throw new Error(`Invalid ${field}: must not contain NUL`)
  }
  if (segment !== path.basename(segment)) {
    throw new Error(`Invalid ${field}: must be a bare filename, got "${segment}"`)
  }
  if (segment === '.' || segment === '..') {
    throw new Error(`Invalid ${field}: must not be a relative path segment`)
  }

  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, segment)
  if (resolved !== path.join(base, segment) || !resolved.startsWith(base + path.sep)) {
    throw new Error(`Invalid ${field}: resolves outside ${baseDir}`)
  }
  return resolved
}

/**
 * Allowlist for per-client config (CCD) directive lines.
 *
 * These lines are written verbatim into a file that OpenVPN reads for the
 * client, so an arbitrary string here means arbitrary OpenVPN configuration on
 * a server running with `script-security 2`. The manager only ever generates
 * `push "route <ip> <netmask>"` (its cidrsToPushRoutes helper), so accept that
 * shape plus a few inert client directives and reject everything else.
 *
 * Mirrors CcdExtraLineSchema in @vpn/shared. Duplicated deliberately: the
 * agent must not depend on the manager having validated anything.
 */
const CCD_LINE_PATTERNS: RegExp[] = [
  /^push\s+"route\s+(\d{1,3}\.){3}\d{1,3}\s+(\d{1,3}\.){3}\d{1,3}"$/,
  /^push\s+"dhcp-option\s+(DNS|DOMAIN)\s+[A-Za-z0-9._-]+"$/,
  /^ifconfig-push\s+(\d{1,3}\.){3}\d{1,3}\s+(\d{1,3}\.){3}\d{1,3}$/,
]

export function isValidCcdLine(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const line = value.trim()
  if (line.length === 0 || line.length > 200) return false
  if (/[\r\n\u0000]/.test(line)) return false
  if (line === 'disable') return true
  return CCD_LINE_PATTERNS.some((re) => re.test(line))
}

/**
 * Filters CCD extra lines to the safe subset, logging anything dropped.
 *
 * Returns only the accepted lines rather than throwing: a single bad route
 * should not prevent the client's IP assignment from being written.
 */
export function filterSafeCcdLines(lines: unknown): string[] {
  if (lines === undefined || lines === null) return []
  if (!Array.isArray(lines)) {
    console.warn('[ccd] extra_lines is not an array — ignoring')
    return []
  }
  const safe: string[] = []
  for (const line of lines.slice(0, 100)) {
    if (isValidCcdLine(line)) {
      safe.push(line.trim())
    } else {
      console.warn(`[ccd] Rejected unsupported CCD directive (possible injection): ${String(line)}`)
    }
  }
  return safe
}
