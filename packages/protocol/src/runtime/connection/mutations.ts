import { Effect, Schema } from 'effect'
import { decode, mutableArray, mutableStruct } from '../../shared/schema.js'
import { runtimeRequestEffect, RuntimeRequestError } from '../../shared/client.js'
import type { RuntimeConnection } from './runtime.js'

const mutations = new Set([
  '/api/tasks/message',
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
    method: Schema.Literal('POST', 'PATCH'),
    input: Schema.Unknown,
    /** Failed domain checks require an explicit retry or discard; reconnect cannot fix them. */
    blocked: Schema.optional(Schema.Boolean),
  }),
)
export type MutationOutbox = Schema.Schema.Type<typeof mutationOutboxSchema>
export type MutationStorage = {
  read: (connection: RuntimeConnection) => Promise<unknown>
  write: (connection: RuntimeConnection, pending: MutationOutbox) => Promise<void>
  id: () => string
}
type State = {
  supported?: boolean
  pending: MutationOutbox
  loaded: boolean
  error: string | null
  lock: Effect.Semaphore
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
 * writer per host/credential; acknowledgements are removed only after storage commits. */
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
        loaded: false,
        error: null,
        lock: Effect.runSync(Effect.makeSemaphore(1)),
      }
      this.states.set(key, state)
    }
    return state
  }
  status(connection: RuntimeConnection) {
    const state = this.state(connection)
    return { pending: state.pending.length, error: state.error }
  }
  private supports(connection: RuntimeConnection, state: State) {
    return Effect.gen(function* () {
      if (state.supported !== undefined) return state.supported
      const result = yield* Effect.either(
        runtimeRequestEffect(
          connection,
          connection.address,
          '/api/mutations/status',
          undefined,
          mutableStruct({ version: Schema.Literal(1) }),
          'GET',
        ),
      )
      if (result._tag === 'Left') {
        if (result.left instanceof RuntimeRequestError && result.left.status === 404)
          return (state.supported = false)
        return yield* Effect.fail(result.left)
      }
      return (state.supported = true)
    })
  }
  private load(connection: RuntimeConnection, state: State) {
    return Effect.gen(this, function* () {
      if (state.loaded) return
      const value = yield* operation(() => this.storage.read(connection))
      state.pending = yield* Effect.try({
        try: () => decode(mutationOutboxSchema, value ?? []),
        catch: (error) =>
          new Error('Saved actions could not be read. They have been preserved.', { cause: error }),
      })
      state.loaded = true
      this.changed()
    })
  }
  private save(connection: RuntimeConnection, state: State, pending: MutationOutbox) {
    return operation(() => this.storage.write(connection, pending)).pipe(
      Effect.tap(() =>
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
  private drain(connection: RuntimeConnection, state: State, retry = false, stopBefore?: string) {
    return Effect.gen(this, function* () {
      if (!state.pending.length) return
      while (state.pending.length && state.pending[0]?.id !== stopBefore) {
        const item = state.pending[0]!
        if (item.blocked && !retry)
          return yield* Effect.fail(
            new Error(
              state.error ?? 'A saved action needs review. Retry or discard pending actions.',
            ),
          )
        const result = yield* Effect.either(this.send(connection, item))
        if (result._tag === 'Left') {
          state.error = transient(result.left)
            ? `Saved actions will sync when this computer is reachable. ${result.left.message}`
            : result.left.message
          if (!transient(result.left))
            yield* this.save(connection, state, [
              { ...item, blocked: true },
              ...state.pending.slice(1),
            ])
          this.changed()
          return yield* Effect.fail(result.left)
        }
        yield* this.save(connection, state, state.pending.slice(1))
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
        Effect.gen(this, function* () {
          yield* this.load(connection, state)
          if (!state.pending.length) return
          if (!(yield* this.supports(connection, state)))
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
      Effect.gen(this, function* () {
        yield* this.load(connection, state)
        yield* this.save(connection, state, [])
        state.error = null
        this.changed()
      }),
    )
  }
  requestEffect<T extends Schema.Schema.AnyNoContext>(
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
        Effect.gen(this, function* () {
          yield* this.load(connection, state)
          if (state.supported === false && !state.pending.length)
            return yield* runtimeRequestEffect(
              connection,
              connection.address,
              path,
              input,
              schema,
              method,
            )
          // A UI retry of the same unresolved command keeps its identity, including after restart.
          let item = state.pending.find(
            (entry) =>
              entry.path === path &&
              entry.method === method &&
              JSON.stringify(entry.input) === JSON.stringify(input),
          )
          const created = !item
          if (!item) {
            if (method !== 'POST' && method !== 'PATCH')
              return yield* Effect.fail(new Error('Cannot journal a read'))
            item = { id: this.storage.id(), path, method, input }
            yield* this.save(connection, state, [...state.pending, item])
          }
          const command = item
          const result = yield* Effect.either(
            Effect.gen(this, function* () {
              if (!(yield* this.supports(connection, state))) {
                // This new command has never reached the host. Legacy hosts can execute it
                // normally; previously saved commands still require receipt support.
                if (created && state.pending.length === 1)
                  return yield* runtimeRequestEffect(
                    connection,
                    connection.address,
                    path,
                    input,
                    schema,
                    method,
                  )
                return yield* Effect.fail(
                  new Error('Update this runtime before recovering saved actions.'),
                )
              }
              yield* this.drain(connection, state, false, command.id)
              return yield* this.send(connection, command)
            }),
          )
          if (result._tag === 'Left') {
            state.error = transient(result.left)
              ? `Action saved for reconnect. ${result.left.message}`
              : result.left.message
            if (!transient(result.left))
              yield* this.save(
                connection,
                state,
                state.pending.map((entry) =>
                  entry.id === command.id ? { ...entry, blocked: true } : entry,
                ),
              )
            this.changed()
            // A send is accepted into this client's durable queue. Clear its composer now,
            // rather than resurrecting its text when reconnect later delivers it.
            if (transient(result.left) && ['/api/tasks/message', '/api/tasks/steer'].includes(path))
              return yield* Effect.try({
                try: () => decode(schema, { ok: true, pending: true }),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
            return yield* Effect.fail(result.left)
          }
          const value = yield* Effect.try({
            try: () => decode(schema, result.right),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
          yield* this.save(connection, state, state.pending.slice(1))
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
