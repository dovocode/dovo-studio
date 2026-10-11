import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'

const routes = new Map<
  string,
  { runtimeId: string; addresses: string[]; selected?: string; checkedAt: number }
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
export function runtimeTransportAddress(connection: RuntimeConnection) {
  return routes.get(key(connection))?.selected ?? connection.address
}
export function invalidateRuntimeRoute(connection: RuntimeConnection) {
  const saved = routes.get(key(connection))
  if (saved) saved.checkedAt = 0
}
/** Resolve before sending a request, including mutations. Never replay an uncertain write
 * on another route. Prefer the configured origin among verified routes without a bearer token. */
export async function resolveRuntimeRoute(connection: RuntimeConnection, signal: AbortSignal) {
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
  if (saved.selected && Date.now() - saved.checkedAt < 60000) return saved.selected
  const candidates = [...new Set([connection.address, ...saved.addresses])].slice(0, 17)
  // Probe in parallel within one deadline: several stale interfaces must not consume
  // the entire caller timeout before a healthy VPN address is considered.
  const expectedId = saved.runtimeId
  const verified = await Promise.all(
    candidates.map(async (address) => {
      if (signal.aborted) throw signal.reason
      try {
        const candidate = origin(address)
        const response = await fetch(new URL('/health', candidate), {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
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
        if (signal.aborted) throw signal.reason
        return undefined
      }
    }),
  )
  const selected = verified.find((candidate) => candidate !== undefined)
  if (selected) {
    saved.selected = selected
    saved.checkedAt = Date.now()
    return selected
  }
  saved.selected = undefined
  throw new Error(
    'No verified address for this paired runtime is reachable. Check its LAN or VPN connection.',
  )
}
