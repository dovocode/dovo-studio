import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import { isPeerAddress, peerTransportAddress, resolvePeerTransport, peerAddress } from './peer.js'

type RouteProbe = {
  controller: AbortController
  result: Promise<string>
  readers: number
}
type Selection = {
  selected?: string
  checkedAt: number
  retryAt?: number
  probe?: RouteProbe
}
type RoutePurpose = 'http' | 'stream'
let version = 0
const listeners = new Set<() => void>()
const publish = () => {
  version++
  for (const listener of listeners) listener()
}
export const runtimeRouteVersion = () => version
export function subscribeRuntimeRoutes(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
type RuntimeRoutes = Selection & {
  runtimeId: string
  addresses: string[]
  stream?: Selection
  streamCooldowns?: Map<string, number>
}
const routes = new Map<string, RuntimeRoutes>()
const key = (connection: RuntimeConnection) =>
  JSON.stringify([new URL(connection.address).origin, connection.token, connection.internet])
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
  if (isPeerAddress(connection.address)) {
    if (connection.runtimeId && connection.runtimeId !== snapshot.runtimeId)
      throw new Error('This connection belongs to a different runtime. Pair it again.')
    return { ...connection, runtimeId: snapshot.runtimeId, alternateAddresses: [] }
  }
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
  const fallback = internetRoutes.get(key(connection) + purpose)
  if (fallback) return peerTransportAddress(fallback.peerAddress) ?? fallback.address
  if (isPeerAddress(connection.address)) return peerTransportAddress(connection.address)
  const saved = routes.get(key(connection))
  return (purpose === 'stream' ? saved?.stream?.selected : saved?.selected) ?? connection.address
}
/** Logical peer identity for the selected route, before its native loopback translation. */
export function runtimePeerAddress(connection: RuntimeConnection, purpose: RoutePurpose = 'http') {
  return (
    internetRoutes.get(key(connection) + purpose)?.peerAddress ??
    (isPeerAddress(connection.address) ? connection.address : undefined)
  )
}
export function invalidateRuntimeRoute(
  connection: RuntimeConnection,
  purpose: RoutePurpose = 'http',
  expectedAddress?: string,
) {
  if (
    expectedAddress !== undefined &&
    runtimeTransportAddress(connection, purpose) !== expectedAddress
  )
    return
  if (internetRoutes.delete(key(connection) + purpose)) publish()
  const saved = routes.get(key(connection))
  const selection = purpose === 'stream' ? saved?.stream : saved
  if (selection) {
    selection.checkedAt = -Infinity
    selection.probe?.controller.abort(new Error('Runtime route was invalidated'))
    selection.probe = undefined
  }
}
/** Upgrade failures must not displace a working HTTP route. Give a blocked proxy thirty
 * seconds to recover, while the stream can use another verified address of the same runtime. */
export function failRuntimeStreamingRoute(connection: RuntimeConnection, address: string) {
  if (internetRoutes.delete(key(connection) + 'stream')) publish()
  const saved = routes.get(key(connection))
  if (!saved) return
  const candidate = origin(address)
  const cooldowns = (saved.streamCooldowns ??= new Map())
  cooldowns.set(candidate, Date.now() + 30000)
  saved.stream?.probe?.controller.abort(new Error('Runtime stream route failed'))
  if (saved.stream) saved.stream.probe = undefined
  if (saved.stream?.selected === candidate) {
    saved.stream.selected = undefined
    saved.stream.checkedAt = 0
    publish()
  }
}
/** Resolve before sending a request, including mutations. Never replay an uncertain write
 * on another route. Prefer the configured origin among verified routes without a bearer token. */
async function resolveDirectRoute(
  connection: RuntimeConnection,
  signal: AbortSignal,
  purpose: RoutePurpose = 'http',
) {
  if (signal.aborted) throw signal.reason
  if (isPeerAddress(connection.address))
    return resolvePeerTransport(connection.address, connection.peer, signal)
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
  // Share only route discovery, never requests or mutations. Each reader retains its
  // own cancellation; the last departing reader closes all remaining probes.
  let probe = selection.probe
  if (!probe) {
    const controller = new AbortController()
    probe = {
      controller,
      readers: 0,
      result: probeDirectRoutes(connection, saved, selection, controller.signal, purpose),
    }
    selection.probe = probe
  }
  probe.readers++
  const waiting = AbortSignal.any([signal, probe.controller.signal])
  let onAbort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(waiting.reason)
    if (waiting.aborted) onAbort()
    else waiting.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([probe.result, cancelled])
  } finally {
    waiting.removeEventListener('abort', onAbort)
    if (--probe.readers === 0 && selection.probe === probe) {
      selection.probe = undefined
      probe.controller.abort()
    }
  }
}

async function probeDirectRoutes(
  connection: RuntimeConnection,
  saved: RuntimeRoutes,
  selection: Selection,
  signal: AbortSignal,
  purpose: RoutePurpose,
) {
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
      const changed = selection.selected !== selected
      selection.selected = selected
      selection.checkedAt = Date.now()
      selection.retryAt =
        purpose === 'stream' ? Math.min(...(saved.streamCooldowns?.values() ?? [])) : undefined
      if (changed) publish()
      return selected
    }
    if (selection.selected !== undefined) {
      selection.selected = undefined
      publish()
    }
    throw new Error(
      'No verified address for this paired runtime is reachable. Check its LAN or VPN connection.',
    )
  } finally {
    probes.abort()
  }
}

const internetRoutes = new Map<
  string,
  { address: string; peerAddress: string; checkedAt: number }
>()
/** Choose the route and its own credential together, before sending anything. A failed
 * mutation is never replayed through the other transport. Explicit LAN/VPN pairing wins. */
export async function resolveRuntimeEndpoint(
  connection: RuntimeConnection,
  signal: AbortSignal,
  purpose: RoutePurpose = 'http',
) {
  if (signal.aborted) throw signal.reason
  const internet = connection.internet
  if (!internet)
    return {
      address: await resolveDirectRoute(connection, signal, purpose),
      token: connection.token,
    }
  if (
    !connection.runtimeId ||
    connection.runtimeId !== internet.runtimeId ||
    internet.address !== peerAddress(internet.peer)
  )
    throw new Error('Internet fallback belongs to another computer')
  const id = key(connection) + purpose
  const saved = internetRoutes.get(id)
  if (saved) {
    if (Date.now() - saved.checkedAt >= 10000) {
      // Reconsider LAN/VPN without stopping traffic on the existing internet route.
      // One bounded background reader shares discovery with foreground readers;
      // cancellation or invalidation cannot resurrect a superseded selection.
      saved.checkedAt = Date.now()
      void resolveDirectRoute(connection, AbortSignal.timeout(3500), purpose).then(
        () => {
          if (internetRoutes.get(id) !== saved) return
          internetRoutes.delete(id)
          publish()
        },
        () => {
          // Unreachable LAN routes are expected while away; retain the fallback.
        },
      )
    }
    const address = await resolvePeerTransport(internet.address, internet.peer, signal)
    // This operation keeps its endpoint and credential together even if discovery
    // selected LAN in the meantime. Only subsequent operations switch routes.
    if (internetRoutes.get(id) === saved && saved.address !== address) {
      saved.address = address
      publish()
    }
    return { address, token: internet.token }
  }
  try {
    const address = await resolveDirectRoute(connection, signal, purpose)
    if (internetRoutes.delete(id)) publish()
    return { address, token: connection.token }
  } catch (error) {
    if (signal.aborted) throw error
  }
  const address = await resolvePeerTransport(internet.address, internet.peer, signal)
  internetRoutes.set(id, {
    address,
    peerAddress: internet.address,
    checkedAt: Date.now(),
  })
  publish()
  return { address, token: internet.token }
}
