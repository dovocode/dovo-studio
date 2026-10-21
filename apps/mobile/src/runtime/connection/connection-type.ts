import { useSyncExternalStore } from 'react'
import {
  runtimePeerAddress,
  runtimeRouteVersion,
  subscribeRuntimeRoutes,
  runtimeSyncStatus,
  type RuntimeConnection,
} from '@dovo/protocol'
import {
  peerConnectionRoute,
  peerConnectionVersion,
  subscribePeerConnections,
} from './peer-transport'

const types = {
  relay: { name: 'Dovo Connect', label: 'Dovo Connect · TURN' },
  custom: { name: 'Custom relay', label: 'Custom relay · TURN' },
  direct: { name: 'Dovo Direct', label: 'Dovo Direct · WebRTC / STUN' },
  private: { name: 'Private', label: 'Private · LAN / VPN' },
  unknown: { name: 'WebRTC', label: 'WebRTC · Checking route…' },
}
const version = () => `${runtimeRouteVersion()}:${peerConnectionVersion()}`
function subscribe(listener: () => void) {
  const routes = subscribeRuntimeRoutes(listener)
  const peers = subscribePeerConnections(listener)
  return () => {
    routes()
    peers()
  }
}
function connectionType(connection: RuntimeConnection, connected: boolean) {
  if (!connected) return undefined
  const selected = (purpose: 'http' | 'stream') => {
    const peer = runtimePeerAddress(connection, purpose)
    return peer ? types[peerConnectionRoute(peer) ?? 'unknown'] : types.private
  }
  const http = selected('http')
  const stream = runtimeSyncStatus(connection) === 'live' ? selected('stream') : http
  // A proxy can block streaming while ordinary requests still use the private network.
  return http === stream
    ? http
    : {
        name: `${http.name} + ${stream.name}`,
        label: `${http.label} · Live updates: ${stream.label}`,
      }
}
/** Re-render on route changes even when the runtime snapshot itself is unchanged. */
export function useConnectionTypes() {
  useSyncExternalStore(subscribe, version, version)
  return connectionType
}
