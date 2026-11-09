import {
  DurableState,
  startPolling,
  startReplication,
  type StateStorage,
} from '@dovo/durable-connections'
import { Effect, Schema } from 'effect'
import { decode } from '../../shared/schema.js'
import { isRuntimeStateSource } from './replication-identity.js'
import {
  threadReplicationChannel,
  decodeThreadRecord,
  validateThreadVersion,
  recoverThreadParentVersion,
  type ThreadRecord,
} from './thread-replication.js'
import type { RuntimeOverview, RuntimeProfile } from './runtime-fleet.js'

type Target = Pick<RuntimeOverview, 'profile' | 'connected' | 'snapshot'>
type Session = {
  target: Target
  error: string
  revision: number
  worker?: ReturnType<typeof startReplication<ThreadRecord>>
}
export interface ThreadStateSyncOptions {
  storage: StateStorage
  createReplicaId(): string
  request(
    profile: RuntimeProfile,
    path: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>
  refreshed(profile: RuntimeProfile): Promise<void>
  error(message: string): void
  intervalMs?: number | null
}
const key = (target: Target) =>
  JSON.stringify([target.profile.id, target.profile.connection, target.snapshot?.runtimeId])
export class ThreadStateSynchronization {
  private opening?: Promise<DurableState<ThreadRecord>>
  private sessions = new Map<string, Session>()
  private targets = new Map<string, Target>()
  private maintenance?: ReturnType<typeof startPolling<Error>>
  private active = false
  private disposed = false
  private generation = 0
  private fingerprint = ''
  private fatal = ''
  private draining = Promise.resolve()
  private stopping?: Promise<void>
  constructor(private options: ThreadStateSyncOptions) {}
  private open() {
    return (this.opening ??= DurableState.openPersisted({
      channel: threadReplicationChannel,
      storage: this.options.storage,
      createReplicaId: () => this.options.createReplicaId(),
      forkOnDivergence: true,
      decode: decodeThreadRecord,
      validateVersion: validateThreadVersion,
      recoverVersion: recoverThreadParentVersion,
    }).catch((error: unknown) => {
      this.opening = undefined
      throw error
    }))
  }
  update(targets: readonly Target[], active: boolean) {
    if (this.disposed) return
    const fingerprint = JSON.stringify([
      active,
      targets
        .map((target) => [key(target), target.connected, target.snapshot?.threadReplicationVersion])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ])
    if (fingerprint === this.fingerprint) return
    this.fingerprint = fingerprint
    this.generation++
    this.active = active
    this.targets = new Map(
      targets
        .filter((target) => target.connected && target.snapshot?.threadReplicationVersion === 1)
        .map((target) => [key(target), target]),
    )
    const removed: Session[] = []
    for (const [id, session] of this.sessions) {
      const target = this.targets.get(id)
      if (active && target) session.target = target
      else {
        this.sessions.delete(id)
        removed.push(session)
      }
    }
    this.draining = Promise.all([
      this.draining,
      ...removed.map(async (session) => {
        await session.worker?.stop()
      }),
    ]).then(() => undefined)
    if (!active) {
      const worker = this.maintenance
      this.maintenance = undefined
      this.draining = Promise.all([this.draining, worker?.stop()]).then(() => undefined)
      this.report()
      return
    }
    if (!this.maintenance)
      this.maintenance = startPolling(
        Effect.tryPromise({
          try: () => this.reconcile(),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        {
          interval: this.options.intervalMs ?? 30000,
          backoff: 120000,
          onError: (error) => {
            this.fatal = error.message
            this.report()
          },
        },
      )
    this.maintenance.refresh()
  }
  private async reconcile() {
    const generation = this.generation
    const current = () => !this.disposed && this.active && this.generation === generation
    await this.draining
    if (!current()) return
    const state = await this.open()
    if (!current()) return
    await state.refresh()
    if (!current()) return
    this.fatal = ''
    for (const [id, target] of this.targets) {
      if (!current()) return
      if (this.sessions.has(id)) continue
      const session: Session = { target, error: '', revision: -1 }
      this.sessions.set(id, session)
      const valid = () =>
        !this.disposed && this.active && this.sessions.get(id) === session && this.targets.has(id)
      session.worker = startReplication({
        state,
        peerId: target.profile.connection.runtimeId ?? target.snapshot?.runtimeId,
        intervalMs: this.options.intervalMs,
        exchange: async (request, signal) => {
          if (!valid()) throw new Error('Thread connection changed')
          const expected =
            session.target.profile.connection.runtimeId ?? session.target.snapshot?.runtimeId
          const response = await this.options.request(
            session.target.profile,
            '/api/threads/state/exchange',
            { ...request, targetRuntimeId: expected },
            signal,
          )
          if (!valid()) throw new Error('Thread connection changed')
          const identity = decode(
            Schema.Struct({ batch: Schema.Struct({ source: Schema.String }) }),
            response,
          )
          if (expected && !isRuntimeStateSource(identity.batch.source, expected))
            throw new Error('Thread sync reached a different runtime')
          return response
        },
        afterExchange: async ({ caughtUp }) => {
          if (!valid() || !caughtUp) return
          if (session.revision !== state.dataRevision) {
            const revision = state.dataRevision
            await this.options.refreshed(session.target.profile)
            if (!valid()) return
            session.revision = revision
          }
          session.error = ''
          this.report()
        },
        onError: (error) => {
          if (valid()) {
            session.error = `${session.target.profile.name}: ${error.message}`
            this.report()
          }
        },
      })
    }
    this.report()
  }
  private report() {
    if (!this.disposed)
      this.options.error(
        this.fatal || [...this.sessions.values()].find((session) => session.error)?.error || '',
      )
  }
  retry() {
    this.maintenance?.refresh()
    for (const session of this.sessions.values()) session.worker?.restart()
  }
  stop() {
    if (this.stopping) return this.stopping
    this.disposed = true
    this.active = false
    return (this.stopping = (async () => {
      await this.maintenance?.stop()
      await this.draining
      await Promise.all(
        [...this.sessions.values()].map(async (session) => {
          await session.worker?.stop()
        }),
      )
      this.sessions.clear()
      await this.opening?.then(
        (state) => state.close(),
        () => undefined,
      )
    })())
  }
}
