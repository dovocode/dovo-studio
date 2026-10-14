import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'

type Selection = { selected?: string; checkedAt: number; retryAt?: number }
type RoutePurpose = 'http' | 'stream'
const routes = new Map<
  string,
  Selection & {
    runtimeId: string
    addresses: string[]
    stream?: Selection
    streamCooldowns?: Map<string, number>
  }
>()
const key = (connection: RuntimeConnection) =>
  JSON.stringify([new URL(connection.address).origin, connection.token])
function origin(address: string) {
  const url = new URL(address)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    ['0.0.0.0', '[::]'].includes(url.hostname)
  )
    throw new Error('Invalid runtime route')
  return url.origin
}
/** Learn only from an authenticated snapshot; advertised routes never receive credentials
 * until their public descriptor matches this paired runtime's persistent identity. */
export function learnRuntimeRoutes(
  connection: RuntimeConnection,
  snapshot: RuntimeSnapshot,
): RuntimeConnection {
  if (!snapshot.runtimeId) return connection
  if (connection.runtimeId && connection.runtimeId !== snapshot.runtimeId)
    throw new Error('This address belongs to a different runtime. Pair it again.')
  const addresses = [
    ...new Set(
      (snapshot.runtimeAddresses ?? []).flatMap((address) => {
        try {
          return [origin(address)]
        } catch {
          return []
        }
      }),
    ),
  ].slice(0, 16)
  const previous = routes.get(key(connection))
  if (previous) {
    if (previous.runtimeId !== snapshot.runtimeId)
      throw new Error('This address belongs to a different runtime. Pair it again.')
    previous.addresses = addresses
  } else {
    routes.set(key(connection), { runtimeId: snapshot.runtimeId, addresses, checkedAt: 0 })
  }
  return { ...connection, runtimeId: snapshot.runtimeId, alternateAddresses: addresses }
}
export function runtimeTransportAddress(
  connection: RuntimeConnection,
  purpose: RoutePurpose = 'http',
) {
  const saved = routes.get(key(connection))
  return (purpose === 'stream' ? saved?.stream?.selected : saved?.selected) ?? connection.address
}
export function invalidateRuntimeRoute(
  connection: RuntimeConnection,
  purpose: RoutePurpose = 'http',
) {
  const saved = routes.get(key(connection))
  const selection = purpose === 'stream' ? saved?.stream : saved
  if (selection) selection.checkedAt = -Infinity
}
/** Upgrade failures must not displace a working HTTP route. Give a blocked proxy thirty
 * seconds to recover, while the stream can use another verified address of the same runtime. */
export function failRuntimeStreamingRoute(connection: RuntimeConnection, address: string) {
  const saved = routes.get(key(connection))
  if (!saved) return
  const candidate = origin(address)
  const cooldowns = (saved.streamCooldowns ??= new Map())
  cooldowns.set(candidate, Date.now() + 30000)
  if (saved.stream?.selected === candidate) {
    saved.stream.selected = undefined
    saved.stream.checkedAt = 0
  }
}
/** Resolve before sending a request, including mutations. Never replay an uncertain write
 * on another route. Prefer the configured origin among verified routes without a bearer token. */
export async function resolveRuntimeRoute(
  connection: RuntimeConnection,
  signal: AbortSignal,
  purpose: RoutePurpose = 'http',
) {
  if (signal.aborted) throw signal.reason
  let saved = routes.get(key(connection))
  if (!saved && connection.runtimeId) {
    saved = {
      runtimeId: connection.runtimeId,
      addresses: connection.alternateAddresses ?? [],
      checkedAt: 0,
    }
    routes.set(key(connection), saved)
  }
  if (!saved) return connection.address // Older runtimes retain their configured HTTP connection.
  if (connection.runtimeId && connection.runtimeId !== saved.runtimeId)
    throw new Error('This address belongs to a different runtime. Pair it again.')
  const selection = purpose === 'stream' ? (saved.stream ??= { checkedAt: 0 }) : saved
  const now = Date.now()
  for (const [address, expires] of saved.streamCooldowns ?? [])
    if (expires <= now) saved.streamCooldowns?.delete(address)
  // Reconsider preferred routes when a cooldown expires, even if the alternate was cached.
  if (
    selection.selected &&
    now - selection.checkedAt < 60000 &&
    now < (selection.retryAt ?? Infinity)
  )
    return selection.selected
  const candidates = [...new Set([connection.address, ...saved.addresses])].slice(0, 17)
  // Probe in parallel within one deadline: several stale interfaces must not consume
  // the entire caller timeout before a healthy VPN address is considered.
  const expectedId = saved.runtimeId
  const probes = new AbortController()
  const verified = candidates.map(async (address) => {
    try {
      const candidate = origin(address)
      if (purpose === 'stream' && saved.streamCooldowns?.has(candidate)) return undefined
      const response = await fetch(new URL('/health', candidate), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, probes.signal, AbortSignal.timeout(3000)]),
      })
      if (!response.ok) return undefined
      const descriptor: unknown = await response.json()
      if (
        !descriptor ||
        typeof descriptor !== 'object' ||
        !('service' in descriptor) ||
        descriptor.service !== 'dovo-runtime' ||
        !('runtimeId' in descriptor) ||
        descriptor.runtimeId !== expectedId
      )
        return undefined
      return candidate
    } catch {
      return undefined
    }
  })
  try {
    // All checks start together, but a verified preferred route only waits on its own
    // descriptor. Stale lower-priority interfaces cannot consume the ticket deadline.
    for (const probe of verified) {
      const selected = await probe
      if (signal.aborted) throw signal.reason
      if (!selected) continue
      selection.selected = selected
      selection.checkedAt = Date.now()
      selection.retryAt =
        purpose === 'stream' ? Math.min(...(saved.streamCooldowns?.values() ?? [])) : undefined
      return selected
    }
    selection.selected = undefined
    throw new Error(
      'No verified address for this paired runtime is reachable. Check its LAN or VPN connection.',
    )
  } finally {
    probes.abort()
  }
}
