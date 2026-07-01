// Shared input validation for firewall handlers (defense-in-depth).
// Values validated here are interpolated into privileged firewall shell
// commands, so they must never contain shell metacharacters. We accept only
// strict IPv4 / CIDR / port formats.

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

// WireGuard public keys are base64, 44 chars ending in '='.
const WG_KEY_RE = /^[A-Za-z0-9+/]{42,44}={0,2}$/

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
