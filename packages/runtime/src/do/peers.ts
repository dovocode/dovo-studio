import { Schema } from 'effect'
import { decode, minValue, mutableStruct, type RuntimeConnection } from '@dovo/protocol'

type StudioPeer = { id: string; name: string; connection: RuntimeConnection }
/** `connection.runtimeId` is always set, so every request verifies the target's identity. */
export type DoPeer = { id: string; name: string; connection: RuntimeConnection }

const healthSchema = mutableStruct({
  service: Schema.Literal('dovo-runtime'),
  runtimeId: minValue(Schema.String, 1),
})
const HEALTH_TIMEOUT = 3_000
const RESOLVED_TTL = 5 * 60_000

/**
 * Paired computers for Do, keyed by each runtime's own ID. Studio registers peers by client
 * profile ID, which differs between clients and pairings, so saved targets never use it.
 */
export class DoPeers {
  /** Runtime IDs learned from `/health` for connections saved before it was recorded. */
  private resolved = new Map<string, { runtimeId: string; at: number }>()
  constructor(
    private ownRuntimeId: string,
    private studio: () => StudioPeer[],
  ) {}
  private async runtimeId(connection: RuntimeConnection, signal: AbortSignal) {
    if (connection.runtimeId) return connection.runtimeId
    const cached = this.resolved.get(connection.address)
    if (cached && Date.now() - cached.at < RESOLVED_TTL) return cached.runtimeId
    const response = await fetch(new URL('/health', connection.address), {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT)]),
    })
    if (!response.ok) throw new Error(`Health check failed with ${response.status}`)
    const { runtimeId } = decode(healthSchema, await response.json())
    this.resolved.set(connection.address, { runtimeId, at: Date.now() })
    return runtimeId
  }
  async list(signal: AbortSignal): Promise<DoPeer[]> {
    const resolved = await Promise.all(
      this.studio().map(async (peer) => {
        try {
          const runtimeId = await this.runtimeId(peer.connection, signal)
          return { ...peer, id: runtimeId, connection: { ...peer.connection, runtimeId } }
        } catch (error) {
          if (signal.aborted) throw error
          // Without a verified identity it cannot be a target; it is offline or not a runtime.
          return undefined
        }
      }),
    )
    const peers = new Map<string, DoPeer>()
    for (const peer of resolved)
      if (peer && peer.id !== this.ownRuntimeId && !peers.has(peer.id)) peers.set(peer.id, peer)
    return [...peers.values()]
  }
}
