import { Effect, Schema, Semaphore } from 'effect'
import { decode, mutableArray, mutableStruct } from '../../shared/schema.js'
import { runtimeRequestEffect, RuntimeRequestError } from '../../shared/client.js'
import type { RuntimeConnection } from './runtime.js'

const mutations = new Set([
  '/api/tasks/message',
  '/api/scm/pulls/link-thread',
  '/api/tasks/steer',
  '/api/tasks/cancel',
  '/api/tasks/lifecycle',
  '/api/tasks/viewed',
  '/api/runtime/preferences/save',
  '/api/agents/defaults/save',
  '/api/agents/settings/save',
  '/api/agents/settings/sync',
  '/api/agents/setup/save',
  '/api/agents/title-settings/save',
  '/api/previews/browser/profiles/save',
])
export const recoverableMutation = (path: string, method = 'POST') =>
  (method === 'PATCH' && path === '/api/workspace') || (method === 'POST' && mutations.has(path))
export const mutationOutboxSchema = mutableArray(
  mutableStruct({
    id: Schema.String,
    path: Schema.String,
    method: Schema.Literals(['POST', 'PATCH']),
    input: Schema.Unknown,
    /** Failed domain checks require an explicit retry or discard; reconnect cannot fix them. */
    blocked: Schema.optional(Schema.Boolean),
  }),
)
export type MutationOutbox = Schema.Schema.Type<typeof mutationOutboxSchema>
export type MutationStorage = {
  read: (connection: RuntimeConnection) => Promise<unknown>
  /** Atomically read, change and commit a host/credential journal across all writers. */
  update: (
    connection: RuntimeConnection,
    change: (pending: MutationOutbox) => MutationOutbox,
  ) => Promise<MutationOutbox>
  /** Explicit discard must also work when the journal cannot be decoded. */
  clear: (connection: RuntimeConnection) => Promise<void>
  id: () => string
}
type State = {
  supported?: boolean
  acknowledgements?: boolean
  pending: MutationOutbox
  error: string | null
  lock: Semaphore.Semaphore
}
const connectionKey = (connection: RuntimeConnection) =>
  JSON.stringify([new URL(connection.address).origin, connection.token])
const transient = (error: unknown) =>
  error instanceof RuntimeRequestError &&
  (error.kind === 'connection' ||
    error.kind === 'timeout' ||
    [502, 503, 504].includes(error.status ?? 0))
const operation = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

/** A journal of user-authorized commands, separate from disposable read caches. One ordered
 * local sender per host/credential; journal updates are atomic across clients and
 * acknowledgements are removed by identity only after storage commits. */
export class RuntimeMutations {
  private states = new Map<string, State>()
  constructor(
    private storage: MutationStorage,
    private changed: () => void = () => {},
  ) {}
  private state(connection: RuntimeConnection) {
    const key = connectionKey(connection)
    let state = this.states.get(key)
    if (!state) {
      state = {
        pending: [],
        error: null,
        lock: Effect.runSync(Semaphore.make(1)),
      }
      this.states.set(key, state)
    }
    return state
  }
  status(connection: RuntimeConnection) {
    const state = this.state(connection)
    return { pending: state.pending.length, error: state.error }
  }
  private supports(connection: RuntimeConnection, state: State, refresh = false) {
    return Effect.gen(function* () {
      if (state.supported !== undefined && !(refresh && !state.supported)) return state.supported
      const result = yield* Effect.result(
        runtimeRequestEffect(
          connection,
          connection.address,
          '/api/mutations/status',
          undefined,
          mutableStruct({
            version: Schema.Literal(1),
            acknowledgements: Schema.optional(Schema.Boolean),
          }),
          'GET',
        ),
      )
      if (result._tag === 'Failure') {
        if (result.failure instanceof RuntimeRequestError && result.failure.status === 404)
          return (state.supported = false)
        return yield* Effect.fail(result.failure)
      }
      state.acknowledgements = result.success.acknowledgements
      return (state.supported = true)
    })
  }
  private load(connection: RuntimeConnection, state: State) {
    return Effect.gen({ self: this }, function* () {
      const value = yield* operation(() => this.storage.read(connection))
      const pending = yield* Effect.try({
        try: () => decode(mutationOutboxSchema, value ?? []),
        catch: (error) =>
          new Error('Saved actions could not be read. They have been preserved.', { cause: error }),
      })
      // This comparison only suppresses notifications; every operation still reads and
      // uses the freshly decoded durable journal, including other clients' changes.
      const changed = JSON.stringify(pending) !== JSON.stringify(state.pending)
      state.pending = pending
      if (changed) this.changed()
    })
  }
  private save(
    connection: RuntimeConnection,
    state: State,
    change: (pending: MutationOutbox) => MutationOutbox,
  ) {
    return operation(() => this.storage.update(connection, change)).pipe(
      Effect.tap((pending) =>
        Effect.sync(() => {
          state.pending = pending
          this.changed()
        }),
      ),
      Effect.uninterruptible,
    )
  }
  private send(connection: RuntimeConnection, item: MutationOutbox[number]) {
    return runtimeRequestEffect(
      connection,
      connection.address,
      item.path,
      item.input,
      Schema.Unknown,
      item.method,
      undefined,
      { mutationId: item.id },
    )
  }
  private acknowledge(connection: RuntimeConnection, state: State, id: string) {
    if (!state.acknowledgements) return Effect.void
    // Only after durable journal removal. Lost acknowledgements retain the full receipt safely.
    return runtimeRequestEffect(
      connection,
      connection.address,
      '/api/mutations/acknowledge',
      { ids: [id] },
      Schema.Unknown,
    ).pipe(
      Effect.asVoid,
      Effect.catch(() => Effect.void),
    )
  }
  private drain(connection: RuntimeConnection, state: State, retry = false, stopBefore?: string) {
    return Effect.gen({ self: this }, function* () {
      if (!state.pending.length) return
      while (state.pending.length && state.pending[0]?.id !== stopBefore) {
        const item = state.pending[0]!
        if (item.blocked && !retry)
          return yield* Effect.fail(
            new Error(
              state.error ?? 'A saved action needs review. Retry or discard pending actions.',
            ),
          )
        const result = yield* Effect.result(this.send(connection, item))
        if (result._tag === 'Failure') {
          state.error = transient(result.failure)
            ? `Saved actions will sync when this computer is reachable. ${result.failure.message}`
            : result.failure.message
          if (!transient(result.failure))
            yield* this.save(connection, state, (pending) =>
              pending.map((entry) => (entry.id === item.id ? { ...entry, blocked: true } : entry)),
            )
          this.changed()
          return yield* Effect.fail(result.failure)
        }
        yield* this.save(connection, state, (pending) =>
          pending.filter((entry) => entry.id !== item.id),
        )
        yield* this.acknowledge(connection, state, item.id)
      }
      if (!state.pending.length) {
        state.error = null
        this.changed()
      }
    })
  }
  recoverEffect(connection: RuntimeConnection, retry = false) {
    const state = this.state(connection)
    return state.lock
      .withPermits(1)(
        Effect.gen({ self: this }, function* () {
          yield* this.load(connection, state)
          if (!state.pending.length) {
            if (state.error !== null) {
              state.error = null
              this.changed()
            }
            return
          }
          // An explicit retry after upgrading a legacy host must recheck its receipts.
          if (!(yield* this.supports(connection, state, retry)))
            return yield* Effect.fail(
              new Error('Update this runtime before recovering saved actions.'),
            )
          yield* this.drain(connection, state, retry)
        }),
      )
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            state.error = error.message
            this.changed()
          }),
        ),
      )
  }
  discardEffect(connection: RuntimeConnection) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        yield* operation(() => this.storage.clear(connection))
        state.pending = []
        state.error = null
        this.changed()
      }).pipe(Effect.uninterruptible),
    )
  }
  assertEmptyEffect(connection: RuntimeConnection) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        yield* this.load(connection, state)
        if (state.pending.length)
          return yield* Effect.fail(
            new Error(
              'This computer has saved actions waiting to sync. Retry or discard them before forgetting it.',
            ),
          )
      }),
    )
  }
  requestEffect<T extends Schema.Codec<unknown, unknown>>(
    connection: RuntimeConnection,
    path: string,
    input: unknown,
    schema: T,
    method = 'POST',
  ) {
    if (!recoverableMutation(path, method))
      return runtimeRequestEffect(connection, connection.address, path, input, schema, method)
    const state = this.state(connection)
    return state.lock
      .withPermits(1)(
        Effect.gen({ self: this }, function* () {
          yield* this.load(connection, state)
          // A UI retry of the same unresolved command keeps its identity, including after restart.
          let item = state.pending.find(
            (entry) =>
              entry.path === path &&
              entry.method === method &&
              JSON.stringify(entry.input) === JSON.stringify(input),
          )
          const created = !item
          if (!item) {
            if (state.pending.some((entry) => entry.blocked))
              return yield* Effect.fail(
                new Error(
                  'A saved action needs review. Retry or discard pending actions before sending another.',
                ),
              )
            if (method !== 'POST' && method !== 'PATCH')
              return yield* Effect.fail(new Error('Cannot journal a read'))
            item = { id: this.storage.id(), path, method, input }
            const appended = item
            yield* this.save(connection, state, (pending) => [...pending, appended])
          }
          const command = item
          let sent = false
          const result = yield* Effect.result(
            Effect.gen({ self: this }, function* () {
              if (!(yield* this.supports(connection, state))) {
                // This new command has never reached the host. Legacy hosts can execute it
                // normally; previously saved commands still require receipt support.
                if (created && state.pending.length === 1) {
                  sent = true
                  return yield* runtimeRequestEffect(
                    connection,
                    connection.address,
                    path,
                    input,
                    schema,
                    method,
                  )
                }
                return yield* Effect.fail(
                  new Error('Update this runtime before recovering saved actions.'),
                )
              }
              yield* this.drain(connection, state, false, command.id)
              sent = true
              return yield* this.send(connection, command)
            }),
          )
          if (result._tag === 'Failure') {
            state.error = transient(result.failure)
              ? `Action saved for reconnect. ${result.failure.message}`
              : result.failure.message
            const rejectedLegacyCommand =
              sent &&
              state.supported === false &&
              result.failure instanceof RuntimeRequestError &&
              result.failure.status !== undefined &&
              !transient(result.failure)
            if ((!transient(result.failure) && !sent && created) || rejectedLegacyCommand)
              yield* this.save(connection, state, (pending) =>
                pending.filter((entry) => entry.id !== command.id),
              )
            if (!transient(result.failure) && sent && !rejectedLegacyCommand)
              yield* this.save(connection, state, (pending) =>
                pending.map((entry) =>
                  entry.id === command.id ? { ...entry, blocked: true } : entry,
                ),
              )
            this.changed()
            // A send is accepted into this client's durable queue. Clear its composer now,
            // rather than resurrecting its text when reconnect later delivers it.
            if (
              transient(result.failure) &&
              ['/api/tasks/message', '/api/tasks/steer'].includes(path)
            )
              return yield* Effect.try({
                try: () => decode(schema, { ok: true, pending: true }),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
            return yield* Effect.fail(result.failure)
          }
          const value = yield* Effect.try({
            try: () => decode(schema, result.success),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
          yield* this.save(connection, state, (pending) =>
            pending.filter((entry) => entry.id !== command.id),
          )
          yield* this.acknowledge(connection, state, command.id)
          state.error = null
          this.changed()
          return value
        }),
      )
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            state.error = error.message
            this.changed()
          }),
        ),
      )
  }
}
