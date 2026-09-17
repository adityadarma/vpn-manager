/** Formats a timestamp in the browser's local timezone using a 24-hour clock. */
export function formatBrowserDateTime(value: string | number | Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.day}-${values.month}-${values.year} ${values.hour}:${values.minute}:${values.second}`
}

/** Returns the caller's IANA timezone name, e.g. `Asia/Jakarta`. */
export function resolveBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when `timeZone` is an IANA name this runtime can resolve. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Epoch milliseconds for midnight of `at`'s calendar day in `timeZone`.
 *
 * The zone's UTC offset is derived from `Intl`-formatted parts at this instant
 * rather than assumed, so DST and non-hour offsets (e.g. `Asia/Kathmandu` at
 * +05:45) are handled without a timezone database dependency. Falls back to UTC
 * midnight when the zone cannot be resolved.
 */
export function startOfDayInTimeZone(
  timeZone: string,
  // Read through Date.now() rather than new Date() so callers and tests can
  // control the clock.
  at: Date = new Date(Date.now()),
): number {
  if (!isValidTimeZone(timeZone)) {
    return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const year = Number(p.year)
  const month = Number(p.month)
  const day = Number(p.day)

  // Wall-clock reading in the target zone, expressed as if it were UTC.
  const wallClockAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  )

  // Formatted parts have second precision, so compare against the same.
  const instantSeconds = Math.floor(at.getTime() / 1000) * 1000
  const offset = wallClockAsUtc - instantSeconds

  return Date.UTC(year, month - 1, day) - offset
}
