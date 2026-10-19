import { RequestError } from './http.js'

export function rateLimit(now: () => number) {
  const attempts = new Map<string, { count: number; expires: number }>()
  return (key: string) => {
    const time = now()
    for (const [key, row] of attempts) if (row.expires <= time) attempts.delete(key)
    if (!attempts.has(key) && attempts.size >= 10_000)
      throw new RequestError(429, 'Try again later')
    const limit = attempts.get(key) ?? { count: 0, expires: time + 60_000 }
    attempts.set(key, limit)
    if (++limit.count > 300)
      throw new RequestError(429, 'Too many requests. Try again in a minute.')
  }
}
