import {
  peerAddress,
  registerPeerTransport,
  PEER_CONNECTION_ERROR,
  type PeerConfig,
} from '@dovo/protocol'

type Tunnel = Awaited<ReturnType<typeof import('./peer-native').openPeerTunnel>>
const configs = new Map<string, PeerConfig>()
const tunnels = new Map<string, Tunnel>()
const pending = new Map<string, Promise<Tunnel>>()
const attempts = new Map<string, AbortController>()
let active = true
let online = true
let networkType: string | undefined
let generation = 0
let version = 0
const listeners = new Set<() => void>()
const publish = () => {
  version++
  for (const listener of listeners) listener()
}
export const peerConnectionVersion = () => version
export const subscribePeerConnections = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const peerConnectionReady = (address: string) => tunnels.get(address)?.alive() ?? false
export const peerConnectionRoute = (address: string) => {
  const tunnel = tunnels.get(address)
  return tunnel?.alive() ? tunnel.route() : undefined
}

export function preparePeerConnection(config: PeerConfig) {
  const address = peerAddress(config)
  configs.set(address, config)
  return address
}
export function replacePeerConnection(config: PeerConfig) {
  const address = preparePeerConnection(config)
  attempts.get(address)?.abort()
  tunnels.get(address)?.close()
  tunnels.delete(address)
  pending.delete(address)
  publish()
}
export function closePeerConnections() {
  generation++
  for (const attempt of attempts.values()) attempt.abort()
  attempts.clear()
  for (const tunnel of tunnels.values()) tunnel.close()
  tunnels.clear()
  pending.clear()
  publish()
}
export function setPeerConnectionsActive(value: boolean) {
  const changed = active !== value
  active = value
  if (!active) closePeerConnections()
  else if (changed) publish()
}
export function setPeerConnectionsAppState(state: string | null | undefined) {
  // iOS becomes inactive for Control Center, Face ID and permission prompts.
  // Only a real background transition should invalidate the connection.
  if (state === 'active') setPeerConnectionsActive(true)
  else if (state === 'background') setPeerConnectionsActive(false)
}
export function setPeerConnectionNetwork(state: { type?: string; isConnected?: boolean }) {
  const changed =
    state.type !== undefined && networkType !== undefined && networkType !== state.type
  networkType = state.type ?? networkType
  const reconnected = !online && state.isConnected === true
  online = state.isConnected ?? online
  // Old ICE candidates cannot describe the phone's new Wi-Fi/cellular route.
  if (changed || state.isConnected === false) closePeerConnections()
  else if (reconnected) publish()
}
export function forgetPeerConnection(address: string) {
  configs.delete(address)
  attempts.get(address)?.abort()
  tunnels.get(address)?.close()
  tunnels.delete(address)
  pending.delete(address)
  publish()
}
async function ensure(address: string) {
  if (!active) throw new Error('Open Dovo to reconnect directly to your computer.')
  if (!online)
    throw new Error('No network connection. Reconnect to Wi-Fi or cellular to reach your computer.')
  // Saved settings own relay consent. A stale request/cache cannot turn it back on.
  const saved = tunnels.get(address)
  if (saved?.alive()) return saved
  saved?.close()
  tunnels.delete(address)
  const current = pending.get(address)
  if (current) return current
  const selected = configs.get(address)
  if (!selected) throw new Error('Scan a new internet pairing QR code from your computer.')
  const revision = generation
  const attempt = new AbortController()
  attempts.set(address, attempt)
  const connecting = import('./peer-native')
    .then(({ openPeerTunnel }) => openPeerTunnel(selected, publish, attempt.signal, publish))
    .then((tunnel) => {
      if (
        !active ||
        generation !== revision ||
        !configs.has(address) ||
        pending.get(address) !== connecting
      ) {
        tunnel.close()
        throw new Error('Internet connection was closed')
      }
      tunnels.set(address, tunnel)
      publish()
      return tunnel
    })
    .finally(() => {
      if (pending.get(address) === connecting) pending.delete(address)
      if (attempts.get(address) === attempt) attempts.delete(address)
    })
  pending.set(address, connecting)
  return connecting
}
registerPeerTransport({
  address: (address) => {
    const tunnel = tunnels.get(address)
    return tunnel?.alive() ? tunnel.address : undefined
  },
  resolve: async (address, config, signal) => {
    if (signal.aborted) throw signal.reason
    return new Promise<string>((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error(PEER_CONNECTION_ERROR))
      signal.addEventListener('abort', abort, { once: true })
      void ensure(address)
        .then((tunnel) => resolve(tunnel.address), reject)
        .finally(() => signal.removeEventListener('abort', abort))
    })
  },
})
