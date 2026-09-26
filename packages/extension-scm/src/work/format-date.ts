import { formatDateTime } from '@dovo/studio-core'
export function formatDate(value: string) {
  if (!value) return 'Not reported'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : formatDateTime(date, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}
