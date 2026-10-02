/** Seconds are useful during the first minute; longer turns use minutes and hours. */
export function formatTurnDuration(ms: number, includeSeconds = false) {
  if (!Number.isFinite(ms)) return ''
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m${includeSeconds ? ` ${seconds % 60}s` : ''}`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m${includeSeconds ? ` ${seconds % 60}s` : ''}`
}
