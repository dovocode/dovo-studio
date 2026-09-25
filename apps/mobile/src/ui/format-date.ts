// Constructing an Intl.DateTimeFormat per call is expensive on Hermes, and list rows format
// dates on every render. Cache one formatter per option set and reuse it.
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
export function formatShortDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : shortDate.format(date)
}
export function formatDateTime(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateTime.format(date)
}
export function formatTime(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : time.format(date)
}
