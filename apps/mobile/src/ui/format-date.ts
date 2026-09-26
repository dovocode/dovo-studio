import { readMobilePreferences } from '../runtime/app-preferences'

// Constructing an Intl.DateTimeFormat per call is expensive on Hermes, and list rows format
// dates on every render. Cache one formatter per option set and clock (Settings → General →
// Time format) and reuse it.
const cache = new Map<string, Intl.DateTimeFormat>()
function formatter(name: string, options: Intl.DateTimeFormatOptions) {
  const { timeFormat } = readMobilePreferences()
  const key = `${name}:${timeFormat}`
  let value = cache.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat(undefined, {
      ...options,
      ...(timeFormat === 'auto' || !('hour' in options || 'timeStyle' in options)
        ? {}
        : { hour12: timeFormat === '12h' }),
    })
    cache.set(key, value)
  }
  return value
}
const parse = (value: string | number | Date) => (value instanceof Date ? value : new Date(value))
function format(name: string, options: Intl.DateTimeFormatOptions, value: string | number | Date) {
  const date = parse(value)
  return Number.isNaN(date.getTime()) ? '' : formatter(name, options).format(date)
}
export const formatShortDate = (value: string | number | Date) =>
  format('shortDate', { month: 'short', day: 'numeric' }, value)
export const formatDateTime = (value: string | number | Date) =>
  format('dateTime', { dateStyle: 'medium', timeStyle: 'short' }, value)
export const formatShortDateTime = (value: string | number | Date) =>
  format(
    'shortDateTime',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    value,
  )
export const formatTime = (value: string | number | Date) =>
  format('time', { hour: 'numeric', minute: '2-digit' }, value)
