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
