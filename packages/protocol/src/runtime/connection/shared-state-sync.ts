import {
  sharedSettingsVersions,
  sharedSettingsFromVersions,
  sharedSettingsVersionEntry,
} from './shared-state-values.js'
import {
  DurableState,
  startPolling,
  startReplication,
  type StateStorage,
} from '@dovo/durable-connections'
import { Effect, Result, Schema } from 'effect'
import { decode } from '../../shared/schema.js'
import { isRuntimeStateSource } from './replication-identity.js'
import {
  sharedSettingsSchema,
  scopedSettingsValueSchema,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
} from '../../workspace.js'
import type { RuntimeOverview } from './runtime-fleet.js'
import type { RuntimeProfile } from './runtime-fleet.js'
import {
  mergeSharedSettings,
  pendingSharedSettings,
  sharedSettingsSyncSchema,
  projectOrganizationCategories,
} from './scoped-settings.js'

type Target = Pick<RuntimeOverview, 'profile' | 'connected' | 'snapshot'>
type Worker = { stop(): Promise<void>; retry(): void }
type Session = {
  target: Target
  known: SharedSettingsEntry[]
  error: string
  fingerprint: string
  received: boolean
  worker?: Worker
}
export interface SharedStateSyncOptions {
  storage: StateStorage
  createReplicaId(): string
  readShared(): readonly SharedSettingsEntry[]
  publish(shared: SharedSettingsEntry[]): void
  request(
    profile: RuntimeProfile,
    path: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>
  refreshed?(profile: RuntimeProfile): Promise<void>
  error(message: string): void
  intervalMs?: number | null
}
const key = (target: Target) =>
  JSON.stringify([
    target.profile.id,
    target.profile.connection,
    target.snapshot?.runtimeId,
    target.snapshot?.stateReplicationVersion ?? 0,
  ])
const sharedValue = (state: DurableState<ScopedSettingsValue>) =>
  sharedSettingsFromVersions(state.latest())

/** One durable app replica shared by all paired-runtime sessions. React and native I/O stay
 * in adapters. Snapshot imports migrate existing preferences without inventing new revisions. */
export class SharedStateSynchronization {
  private opening?: Promise<DurableState<ScopedSettingsValue>>
  private targets = new Map<string, Target>()
  private sessions = new Map<string, Session>()
  private maintenance?: ReturnType<typeof startPolling<Error>>
  private active = false
  private disposed = false
  private fatal = ''
  private stopPromise?: Promise<void>
  private draining = Promise.resolve()
  private generation = 0
  private fingerprint = ''

  constructor(private options: SharedStateSyncOptions) {}
  private open() {
    return (this.opening ??= DurableState.openPersisted({
      channel: 'shared-settings:v1',
      storage: this.options.storage,
      createReplicaId: () => this.options.createReplicaId(),
      decode: (value) => decode(scopedSettingsValueSchema, value),
      validateVersion: (entry) => {
        if (
          entry.deleted ||
          (sharedSettingsVersionEntry(entry).key !== 'global' &&
            !/^project:[^/\s]+\/[^\r\n]+$/.test(sharedSettingsVersionEntry(entry).key))
        )
          throw new Error('Invalid shared settings state')
        decode(sharedSettingsSchema, [sharedSettingsVersionEntry(entry)])
      },
      validateState: (latest) => {
        decode(sharedSettingsSchema, sharedSettingsFromVersions(latest))
      },
    }).catch((error: unknown) => {
      this.opening = undefined
      throw error
    }))
  }
  update(targets: readonly Target[], active: boolean) {
    if (this.disposed) return
    const fingerprint = JSON.stringify([
      active,
      this.options.readShared(),
      targets
        .map((target) =>
          JSON.stringify([
            key(target),
            target.connected,
            target.snapshot?.runtimeId,
            target.snapshot?.settingsScopesSupported,
            target.snapshot?.defaults?.scopedSettings?.shared ?? [],
          ]),
        )
        .sort(),
    ])
    if (fingerprint === this.fingerprint) return
    this.fingerprint = fingerprint
    this.generation++
    this.targets = new Map(targets.map((target) => [key(target), target]))
    this.active = active
    for (const [id, session] of this.sessions) {
      const target = this.targets.get(id)
      if (target) session.target = target
    }
    if (!active) {
      const maintenance = this.maintenance
      this.maintenance = undefined
      const sessions = [...this.sessions.values()]
      this.sessions.clear()
      this.draining = Promise.all([
        this.draining,
        maintenance?.stop(),
        ...sessions.map((session) => session.worker?.stop()),
      ]).then(() => undefined)
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
    const current = () => generation === this.generation && this.active && !this.disposed
    await this.draining
    if (!current()) return
    const state = await this.open()
    if (!current()) return
    await state.refresh()
    if (!current()) return
    // Snapshots are decoded presentation values. Older clients can omit fields, so
    // only the raw exchange may supply another replica's immutable versions.
    await state.importVersions(sharedSettingsVersions(this.options.readShared()))
    if (!current()) return
    this.publish(state)
    this.fatal = ''
    for (const [id, session] of this.sessions) {
      const target = this.targets.get(id)
      if (target?.connected && target.snapshot?.settingsScopesSupported) continue
      this.sessions.delete(id)
      await session.worker?.stop()
      if (!current()) return
    }
    for (const [id, target] of this.targets) {
      if (!current()) return
      if (!target.connected || !target.snapshot?.settingsScopesSupported) continue
      const previous = this.sessions.get(id)
      if (previous) {
        const known = mergeSharedSettings(
          previous.known,
          target.snapshot.defaults?.scopedSettings?.shared ?? [],
        )
        if (JSON.stringify(known) !== JSON.stringify(previous.known)) {
          previous.known = known
          previous.worker?.retry()
        }
        continue
      }
      const session: Session = {
        target,
        error: '',
        known: target.snapshot.defaults?.scopedSettings?.shared ?? [],
        fingerprint: '',
        received: false,
      }
      this.sessions.set(id, session)
      const valid = () =>
        this.active &&
        !this.disposed &&
        this.sessions.get(id) === session &&
        this.targets.has(id) &&
        this.targets.get(id)?.connected === true
      const publish = async () => {
        if (!valid()) return
        this.publish(state)
        const fingerprint = JSON.stringify(sharedValue(state))
        if (fingerprint !== session.fingerprint) {
          await this.options.refreshed?.(session.target.profile)
          if (!valid()) return
          session.fingerprint = fingerprint
        }
        session.error = ''
        this.report()
      }
      const failure = (error: Error) => {
        if (valid()) {
          session.error = `${session.target.profile.name}: ${error.message}`
          this.report()
        }
      }
      const prepare = async () => {
        if (!valid()) throw new Error('Shared state connection changed')
        await state.importVersions(sharedSettingsVersions(this.options.readShared()))
        if (!valid()) throw new Error('Shared state connection changed')
      }
      if (target.snapshot.stateReplicationVersion === 1) {
        const worker = startReplication({
          state,
          peerId: target.profile.connection.runtimeId ?? target.snapshot?.runtimeId,
          intervalMs: this.options.intervalMs,
          beforeExchange: prepare,
          afterExchange: publish,
          onError: failure,
          exchange: async (request, signal) => {
            if (!valid()) throw new Error('Shared state connection changed')
            const expected =
              session.target.profile.connection.runtimeId ?? session.target.snapshot?.runtimeId
            const result = await this.options.request(
              session.target.profile,
              '/api/state/exchange',
              { ...request, targetRuntimeId: expected },
              signal,
            )
            if (!valid()) throw new Error('Shared state connection changed')
            const response = decode(
              Schema.Struct({ batch: Schema.Struct({ source: Schema.String }) }),
              result,
            )
            if (expected && !isRuntimeStateSource(response.batch.source, expected))
              throw new Error('Shared state reached a different runtime')
            return result
          },
        })
        session.worker = { stop: () => worker.stop(), retry: () => worker.restart() }
      } else {
        // Compatibility is an explicit legacy endpoint, never a simulated durable receipt.
        const worker = startPolling(
          Effect.tryPromise({
            try: async (signal) => {
              await state.refresh()
              await prepare()
              const pending = pendingSharedSettings(
                sharedValue(state),
                session.known,
                session.target.snapshot?.projectOrganizationSupported
                  ? []
                  : projectOrganizationCategories,
              )
              if (!pending.length && session.received) {
                if (valid()) {
                  session.error = ''
                  this.report()
                }
                return
              }
              const raw = await this.options.request(
                session.target.profile,
                '/api/agents/settings/sync',
                { shared: pending },
                signal,
              )
              if (signal.aborted || !valid()) return
              const result = Schema.decodeUnknownResult(sharedSettingsSyncSchema, {
                onExcessProperty: 'error',
              })(raw)
              if (Result.isFailure(result))
                throw new Error(
                  'Shared settings require a compatible app version; saved data was kept',
                )
              await state.importVersions(sharedSettingsVersions(result.success.shared))
              session.received = true
              session.known = mergeSharedSettings(session.known, result.success.shared)
              await publish()
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
          { interval: this.options.intervalMs ?? 30000, backoff: 120000, onError: failure },
        )
        const unsubscribe = state.subscribe(worker.refresh)
        session.worker = {
          stop: async () => {
            unsubscribe()
            await worker.stop()
          },
          retry: worker.refresh,
        }
      }
    }
    this.report()
  }
  private publish(state: DurableState<ScopedSettingsValue>) {
    const shared = sharedValue(state)
    if (JSON.stringify(shared) !== JSON.stringify(this.options.readShared()))
      this.options.publish(shared)
  }
  private report() {
    if (!this.disposed)
      this.options.error(
        this.fatal ||
          [...this.sessions.values()]
            .map((session) => session.error)
            .filter(Boolean)
            .join('\n'),
      )
  }
  retry() {
    this.maintenance?.refresh()
    for (const session of this.sessions.values()) session.worker?.retry()
  }
  stop() {
    if (this.stopPromise) return this.stopPromise
    this.disposed = true
    this.active = false
    this.stopPromise = (async () => {
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
    })()
    return this.stopPromise
  }
}
