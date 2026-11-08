/** Website-owned counts only: titles remain the fallback for sites without the Badging API. */
export function browserTabBadge(title: string): number | 'unread' | undefined {
  const count = /^(?:\((\d{1,9})\+?\)|\[(\d{1,9})\+?\])(?:\s|$)/.exec(title.trim())
  if (count) {
    const value = Number(count[1] ?? count[2])
    return value > 0 ? value : undefined
  }
  return /^[•●]\s/.test(title.trim()) ? 'unread' : undefined
}
