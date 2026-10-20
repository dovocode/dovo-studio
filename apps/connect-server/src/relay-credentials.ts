import { PEER_RELAY_MAX_TTL_MS, type PeerRelay } from '@dovo/protocol'

export type PeerRelayIssuer = (
  room: string,
  address: string,
  installation?: string,
) => Promise<PeerRelay>
export const TURN_CREDENTIAL_TTL = PEER_RELAY_MAX_TTL_MS / 1000

/** Bound issuance per approved installation; byte quotas are enforced by the operator. */
export function managedRelayCredentials(
  generate: (installation?: string) => Promise<PeerRelay>,
  options: { hourlyLimit?: number; now?: () => number } = {},
): PeerRelayIssuer {
  const hourlyLimit = options.hourlyLimit ?? 100
  if (!Number.isSafeInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > 10000)
    throw new Error('TURN hourly limit must be between 1 and 10000')
  const now = options.now ?? Date.now
  const cache = new Map<string, { expires: number; promise: Promise<PeerRelay> }>()
  const attempts = new Map<string, number>()
  let window = now(),
    count = 0
  return async (room, address, installation) => {
    const time = now()
    const cacheKey = installation ?? room
    const principal = installation ?? address
    for (const [key, grant] of cache) if (grant.expires <= time) cache.delete(key)
    const saved = cache.get(cacheKey)
    if (saved) return saved.promise
    if (time - window >= 3600000) {
      window = time
      count = 0
      attempts.clear()
    }
    if (count >= hourlyLimit || (attempts.get(principal) ?? 0) >= 20 || cache.size >= 2048)
      throw new Error('Encrypted relay is temporarily busy')
    count++
    attempts.set(principal, (attempts.get(principal) ?? 0) + 1)
    const promise: Promise<PeerRelay> = generate(installation)
      .then((grant) => {
        const entry = cache.get(cacheKey)
        if (entry?.promise === promise)
          entry.expires = Math.min(entry.expires, grant.expiresAt - 60000)
        return grant
      })
      .catch(() => {
        if (cache.get(cacheKey)?.promise === promise) cache.delete(cacheKey)
        throw new Error('Encrypted relay is temporarily unavailable')
      })
    cache.set(cacheKey, { expires: time + TURN_CREDENTIAL_TTL * 500, promise })
    return promise
  }
}
