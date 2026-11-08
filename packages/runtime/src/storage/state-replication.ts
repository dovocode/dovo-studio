import { DurableState, startReplication, StateProtocolError } from '@dovo/durable-connections'
import {
  createRuntimeClient,
  decode,
  isRuntimeStateSource,
  scopedSettingsValueSchema,
  sharedSettingsSchema,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
  type RuntimeConnection,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import type { RuntimeDefaults } from './runtime-defaults.js'
import type { RetrievalPeers } from '../retrieval/peers.js'
import { validateSharedEntry } from './shared-settings-validation.js'
import { HttpError } from '../errors.js'
import { replicationIdentity } from './replication-identity.js'
import { sharedStateJournal } from './shared-state-journal.js'

const channel = 'shared-settings:v1'
type Session = {
  name: string
  runtimeId: string
  error: string | null
  connected: boolean
  connection: ReturnType<typeof startReplication<ScopedSettingsValue>>
}
type Peer = { id: string; name: string; connection: RuntimeConnection }

/** Dovo adapter: credentials and domain records stay outside the generic replication engine. */
export class SharedStateReplication {
  private readonly ready: Promise<DurableState<ScopedSettingsValue>>
  private sessions = new Map<string, Session>()
  private timer?: ReturnType<typeof setInterval>
  private refreshing?: Promise<void>
  private stopped = false
  private stopPromise?: Promise<void>
  private revision = 0
  private imported = 0
  private failure: string | null = null

  constructor(
    db: Database.Database,
    private defaults: RuntimeDefaults,
    private runtimeId: string,
    private peers: RetrievalPeers,
  ) {
    this.ready = Promise.resolve().then(() =>
      DurableState.open({
        channel,
        replicaId: replicationIdentity(db, runtimeId).source,
        decode: (value) => decode(scopedSettingsValueSchema, value),
        validateVersion: (version) => {
          if (version.deleted)
            throw new StateProtocolError('Shared settings use explicit reset values')
          validateSharedEntry(version)
        },
        validateState: (latest) => {
          decode(sharedSettingsSchema, latest)
        },
        storage: sharedStateJournal(db, runtimeId, replicationIdentity(db, runtimeId).source),
      }),
    )
    // start() observes and reports the initialization error through runtime startup.
    void this.ready.catch(() => {
      this.failure =
        'Shared state replication is unavailable. Stored records were preserved for recovery.'
    })
  }

  private async capture(state: DurableState<ScopedSettingsValue>) {
    const versions = this.defaults.sharedVersions(this.imported)
    const current = this.defaults.get().scopedSettings?.shared ?? []
    await state.importVersions(
      [...versions.map(({ entry }) => entry), ...current].map((entry) => ({
        ...entry,
        deleted: false as const,
      })),
    )
    this.imported = versions.at(-1)?.sequence ?? this.imported
  }
  private publish(state: DurableState<ScopedSettingsValue>) {
    const shared: SharedSettingsEntry[] = state.latest().flatMap((entry) =>
      entry.deleted
        ? []
        : [
            {
              key: entry.key,
              updatedAt: entry.updatedAt,
              changeId: entry.changeId,
              value: entry.value,
            },
          ],
    )
    this.defaults.mergeShared(shared)
    this.revision = state.revision
  }
  available() {
    return this.failure === null
  }
  async start() {
    try {
      await this.initialize()
    } catch (error) {
      this.failure =
        'Shared state replication is unavailable. Stored records were preserved for recovery.'
      throw error
    }
  }
  private async initialize() {
    const state = await this.ready
    await this.capture(state)
    this.publish(state)
    await this.refresh()
    if (this.stopped || this.timer) return
    this.timer = setInterval(() => {
      void this.refresh().catch((error) =>
        console.error('Shared state replication refresh failed', error),
      )
    }, 5000)
    this.timer.unref()
  }
  refresh() {
    if (this.stopped) return Promise.resolve()
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshPeers().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }
  private async refreshPeers() {
    const state = await this.ready
    // Only a local Studio registration grants always-on peer access. Retrieval-only grants
    // keep their existing scope; a phone can still bridge shared settings using settings/sync.
    const peers = this.peers
      .list(true)
      .filter((peer) => peer.connection.runtimeId !== this.runtimeId)
    const active = new Map(peers.map((peer) => [JSON.stringify([peer.id, peer.connection]), peer]))
    for (const [key, session] of this.sessions) {
      if (active.has(key) && !this.stopped) continue
      this.sessions.delete(key)
      await session.connection.stop()
    }
    if (this.stopped) return
    for (const [key, peer] of active) {
      if (this.sessions.has(key)) continue
      const session: Session = {
        name: peer.name,
        runtimeId: peer.connection.runtimeId ?? peer.id,
        connected: false,
        error: null,
        connection: startReplication({
          state,
          peerId: peer.connection.runtimeId,
          beforeExchange: () => this.capture(state),
          afterExchange: () => {
            this.publish(state)
            session.connected = true
            session.error = null
          },
          exchange: async (request, signal) => {
            // Re-check durable grants before every transfer, including after credential changes.
            if (!this.authorized(peer)) throw new HttpError(403, 'Shared state pairing was removed')
            const result = await runClientEffect(
              createRuntimeClient(peer.connection).requestEffect(
                '/api/state/exchange',
                { ...request, targetRuntimeId: peer.connection.runtimeId },
                Schema.Unknown,
                {
                  method: 'POST',
                  timeoutMs: 15000,
                },
              ),
              signal,
            )
            if (!this.authorized(peer)) throw new HttpError(403, 'Shared state pairing was removed')
            const identity = decode(
              Schema.Struct({ batch: Schema.Struct({ source: Schema.String }) }),
              result,
            )
            if (
              peer.connection.runtimeId &&
              !isRuntimeStateSource(identity.batch.source, peer.connection.runtimeId)
            )
              throw new HttpError(
                409,
                'This pairing reached a different runtime. Refresh the saved connection.',
              )
            return result
          },
          onError: (error) => {
            session.connected = false
            session.error = error.message
          },
        }),
      }
      this.sessions.set(key, session)
    }
  }
  private authorized(peer: Peer) {
    return (
      !this.stopped &&
      this.peers
        .list(true)
        .some(
          (current) =>
            current.id === peer.id &&
            JSON.stringify(current.connection) === JSON.stringify(peer.connection),
        )
    )
  }
  async exchange(input: unknown) {
    if (this.failure) throw new HttpError(503, this.failure)
    if (this.stopped) throw new HttpError(503, 'Shared state replication is stopping')
    const target = decode(Schema.Struct({ targetRuntimeId: Schema.optional(Schema.String) }), input)
    if (target.targetRuntimeId && target.targetRuntimeId !== this.runtimeId)
      throw new HttpError(409, 'This state exchange targets a different runtime')
    const state = await this.ready
    await this.capture(state)
    const response = await state.exchange(input)
    this.publish(state)
    return response
  }
  async history(key: string) {
    if (this.failure) throw new HttpError(503, this.failure)
    const state = await this.ready
    await this.capture(state)
    return state.history(key)
  }
  async restore(key: string, updatedAt: number, changeId: string) {
    if (this.failure) throw new HttpError(503, this.failure)
    const state = await this.ready
    await this.capture(state)
    const version = state
      .history(key)
      .find((entry) => entry.updatedAt === updatedAt && entry.changeId === changeId)
    if (!version) throw new HttpError(404, 'Shared state version not found')
    const restored = await state.restoreVersion(version)
    this.publish(state)
    return restored
  }
  status() {
    return {
      channel,
      error: this.failure,
      revision: this.revision,
      peers: [...this.sessions.values()].map((session) => ({
        runtimeId: session.runtimeId,
        name: session.name,
        connected: session.connected,
        error: session.error,
      })),
    }
  }
  stop() {
    if (this.stopPromise) return this.stopPromise
    this.stopped = true
    clearInterval(this.timer)
    this.stopPromise = (async () => {
      await this.refreshing
      await Promise.all([...this.sessions.values()].map((session) => session.connection.stop()))
      this.sessions.clear()
      await this.ready.then(
        (state) => state.close(),
        () => undefined,
      )
    })()
    return this.stopPromise
  }
}
