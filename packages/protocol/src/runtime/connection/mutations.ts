import { createRuntimeClient } from '../../shared/runtime-client.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  reconcileWorkspaceEdit,
  sameWorkspaceEditValue,
  workspaceDraftConsumed,
} from './workspace-reconciliation.js'
import { runtimeSnapshotPath } from './live-sync.js'
import { Effect, Schema, Semaphore } from 'effect'
import { decode, decodeResult, mutableArray, mutableStruct } from '../../shared/schema.js'
import { RuntimeRequestError } from '../../shared/client.js'
import {
  snapshotSchema,
  patchSchema,
  workspaceRecoveriesSchema,
  workspaceRecoverySchema,
  workspacePatchResultSchema,
  type WorkspaceRecovery,
  type RuntimeConnection,
} from './runtime.js'
import {
  WorkspaceStorageError,
  workspacePatchRejection,
  workspacePatchRejected,
} from './workspace-mutations.js'
import type { Task } from '../../workspace.js'
import { savedPendingMessages } from '../../conversation/workflow/pending-message.js'

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
  recoverWorkspaceEdit?: (connection: RuntimeConnection, edit: WorkspaceRecovery) => Promise<void>
  workspaceRecoveries?: (connection: RuntimeConnection) => Promise<WorkspaceRecovery[]>
}
type State = {
  workspaceAcknowledgement?: { version: number; revision: number; instanceId?: string }
  workspaceVersion: number
  refreshedWorkspaceVersion: number
  supported?: boolean
  acknowledgements?: boolean
  workspaceMutations?: boolean
  pending: MutationOutbox
  /** Presentation handoff only; these commands have already left the durable journal. */
  confirmedMessages: MutationOutbox
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
const transientMutation = (item: { path: string }, error: unknown) =>
  transient(error) ||
  (item.path === '/api/workspace' &&
    error instanceof RuntimeRequestError &&
    [500, 426].includes(error.status ?? 0))
// Workspace validation happens before the patch commits. New runtimes explicitly
// identify rejected edits; older runtimes return 400 for invalid input.
const rejectedPatch = (item: { path: string; method: string }, error: unknown) =>
  item.path === '/api/workspace' && item.method === 'PATCH' && workspacePatchRejected(error)
const settledFailure = (item: { path: string; method: string }, error: unknown) =>
  rejectedPatch(item, error) ||
  (error instanceof RuntimeRequestError && error.mutationRetired === true)
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
        workspaceVersion: 0,
        refreshedWorkspaceVersion: 0,
        pending: [],
        confirmedMessages: [],
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
  workspaceRefreshCheckpoint(connection: RuntimeConnection) {
    const state = this.state(connection)
    return state.workspaceVersion
  }
  requiresWorkspaceRefresh(connection: RuntimeConnection) {
    const state = this.state(connection)
    return state.workspaceVersion > state.refreshedWorkspaceVersion
  }
  acceptsWorkspaceSnapshot(
    connection: RuntimeConnection,
    snapshot: { revision: number; runtimeInstanceId?: string },
  ) {
    const ack = this.state(connection).workspaceAcknowledgement
    return (
      !ack || snapshot.runtimeInstanceId !== ack.instanceId || snapshot.revision >= ack.revision
    )
  }
  workspaceRefreshed(
    connection: RuntimeConnection,
    checkpoint: number,
    snapshot?: { revision: number; runtimeInstanceId?: string },
  ) {
    if (snapshot && !this.acceptsWorkspaceSnapshot(connection, snapshot)) return false
    const state = this.state(connection)
    state.refreshedWorkspaceVersion = Math.max(state.refreshedWorkspaceVersion, checkpoint)
    return true
  }
  private workspaceCommitted(state: State, value: unknown) {
    state.workspaceVersion++
    const result = decodeResult(workspacePatchResultSchema, value)
    if (result.success)
      state.workspaceAcknowledgement = {
        version: state.workspaceVersion,
        revision: result.data.revision,
        instanceId: result.data.runtimeInstanceId,
      }
    this.changed()
  }
  pendingMessages(connection: RuntimeConnection, task: Task) {
    const state = this.state(connection)
    return [
      ...savedPendingMessages(task, state.confirmedMessages).map((item) => ({
        ...item,
        state: 'sending' as const,
      })),
      ...savedPendingMessages(task, state.pending),
    ]
  }
  acknowledgeMessages(connection: RuntimeConnection, tasks: readonly Task[]) {
    const state = this.state(connection)
    state.confirmedMessages = state.confirmedMessages.filter((item) => {
      const input = item.input
      if (!input || typeof input !== 'object' || !('id' in input) || !('messageId' in input))
        return false
      const task = tasks.find((task) => task.id === input.id)
      return (
        !task ||
        ![...task.messages, ...(task.queue ?? [])].some((message) => message.id === input.messageId)
      )
    })
  }
  private retainMessage(state: State, item: MutationOutbox[number]) {
    if (item.path === '/api/tasks/message' || item.path === '/api/tasks/steer')
      state.confirmedMessages = [
        ...state.confirmedMessages.filter((previous) => previous.id !== item.id),
        item,
      ]
  }
  private supports(connection: RuntimeConnection, state: State, refresh = false) {
    return Effect.gen(function* () {
      if (state.supported !== undefined && !(refresh && !state.supported)) return state.supported
      const result = yield* Effect.result(
        createRuntimeClient(connection).requestEffect(
          '/api/mutations/status',
          undefined,
          mutableStruct({
            version: Schema.Literal(1),
            acknowledgements: Schema.optional(Schema.Boolean),
            workspaceMutations: Schema.optional(Schema.Literal(1)),
          }),
          { method: 'GET' },
        ),
      )
      if (result._tag === 'Failure') {
        if (result.failure instanceof RuntimeRequestError && result.failure.status === 404)
          return (state.supported = false)
        return yield* Effect.fail(result.failure)
      }
      state.acknowledgements = result.success.acknowledgements
      state.workspaceMutations = result.success.workspaceMutations === 1
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
  private preserveWorkspaceEffect(
    connection: RuntimeConnection,
    input: unknown,
    host: unknown,
    reason?: string,
  ) {
    const patch = decodeResult(patchSchema, input)
    if (!patch.success) return Effect.void
    const recover = this.storage.recoverWorkspaceEdit
    if (!recover)
      return Effect.fail(new Error('Cannot retire this edit without durable recovery storage.'))
    const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify({ patch: patch.data, host }))))
    return operation(() =>
      recover(connection, {
        id,
        createdAt: new Date().toISOString(),
        patch: patch.data,
        host,
        reason,
      }),
    ).pipe(Effect.mapError((error) => new WorkspaceStorageError(error.message, { cause: error })))
  }
  /** Desktop's workspace outbox and mobile's command journal use the same sender
   * and outcome handling, without copying an edit into a second durable journal. */
  workspaceEffect(connection: RuntimeConnection, input: unknown, id: string) {
    const state = this.state(connection)
    return this.supports(connection, state, true).pipe(
      Effect.flatMap((supported) =>
        supported
          ? this.sendRaw(connection, { id, path: '/api/workspace', method: 'PATCH', input })
          : Effect.fail(
              new RuntimeRequestError({
                kind: 'response',
                status: 426,
                message:
                  'Update this runtime to sync saved workspace edits safely. Your edits remain queued.',
              }),
            ),
      ),
      Effect.catch((error) => {
        if (
          error instanceof RuntimeRequestError &&
          (error.mutationRetired ||
            (!state.workspaceMutations &&
              error.status === 409 &&
              error.message.startsWith('This action was already acknowledged.')))
        )
          return this.legacyWorkspaceEffect(connection, input, id, false)
        if (
          !state.workspaceMutations &&
          error instanceof RuntimeRequestError &&
          error.status === 409 &&
          /Another client changed|already exists|not found|restarted while applying|previous attempt failed/.test(
            error.message,
          )
        )
          return this.legacyWorkspaceEffect(
            connection,
            input,
            id,
            !/restarted while applying|previous attempt failed/.test(error.message),
          )
        if (workspacePatchRejected(error) && !state.workspaceMutations)
          return this.preserveWorkspaceEffect(connection, input, null, error.message).pipe(
            Effect.andThen(Effect.fail(error)),
          )
        return Effect.fail(error)
      }),
      Effect.tap((value) => Effect.sync(() => this.workspaceCommitted(state, value))),
      Effect.flatMap((value) => {
        const error = workspacePatchRejection(value)
        return error ? Effect.fail(error) : Effect.succeed(value)
      }),
    )
  }
  private legacyWorkspaceEffect(
    connection: RuntimeConnection,
    input: unknown,
    id: string,
    mayApply: boolean,
  ) {
    return Effect.gen({ self: this }, function* () {
      const snapshot = yield* createRuntimeClient(connection).requestEffect(
        runtimeSnapshotPath(connection),
        undefined,
        snapshotSchema,
        { method: 'GET' },
      )
      const patch = decode(patchSchema, input)
      const entity = snapshot.workspace[patch.collection].find((item) => item.id === patch.id)
      const host = entity ? decode(Schema.Record(Schema.String, Schema.Unknown), entity) : null
      const changes: typeof patch.changes = {}
      let conflicted = !host || patch.create !== undefined || !mayApply
      if (host && patch.create === undefined && mayApply)
        for (const [key, change] of Object.entries(patch.changes)) {
          const merged =
            key === 'draft' && workspaceDraftConsumed(host, change.before)
              ? { value: change.after, conflicted: false }
              : reconcileWorkspaceEdit(change.before, change.after, host[key] ?? null)
          conflicted ||= merged.conflicted
          if (!sameWorkspaceEditValue(host[key] ?? null, merged.value ?? null))
            changes[key] = { before: host[key] ?? null, after: merged.value ?? null }
        }
      if (conflicted)
        yield* this.preserveWorkspaceEffect(
          connection,
          input,
          entity ?? null,
          'The runtime retained competing or uncertain values from an older edit.',
        )
      if (Object.keys(changes).length) {
        const rebased = { collection: patch.collection, id: patch.id, changes }
        // One retry identity per original operation, even if the host changes again.
        // A changed payload must collide with the receipt rather than repeat a write.
        const retryId = bytesToHex(sha256(utf8ToBytes(JSON.stringify({ id, workspaceRetry: 1 }))))
        const response = yield* this.sendRaw(connection, {
          id: retryId,
          path: '/api/workspace',
          method: 'PATCH',
          input: rebased,
        }).pipe(
          Effect.catch((error) =>
            error instanceof RuntimeRequestError &&
            error.status === 409 &&
            error.message === 'This action ID already belongs to another request.'
              ? this.preserveWorkspaceEffect(
                  connection,
                  input,
                  entity ?? null,
                  'An older retry may already have applied. The runtime retained its current state.',
                ).pipe(
                  Effect.as({
                    revision: snapshot.revision,
                    runtimeInstanceId: snapshot.runtimeInstanceId,
                    reconciled: true,
                  }),
                )
              : workspacePatchRejected(error)
                ? this.preserveWorkspaceEffect(
                    connection,
                    input,
                    entity ?? null,
                    error.message,
                  ).pipe(Effect.andThen(Effect.fail(error)))
                : Effect.fail(error),
          ),
        )
        const result = decode(workspacePatchResultSchema, response)
        return { ...result, reconciled: true }
      }
      return {
        revision: snapshot.revision,
        runtimeInstanceId: snapshot.runtimeInstanceId,
        reconciled: true,
        outcome: 'reconciled' as const,
      }
    })
  }
  private workspaceRecoveriesEffect(connection: RuntimeConnection) {
    return Effect.gen({ self: this }, function* () {
      const read = this.storage.workspaceRecoveries
      const localResult = yield* Effect.result(
        read ? operation(() => read(connection)) : Effect.succeed([]),
      )
      const local = localResult._tag === 'Success' ? localResult.success : []
      const remote = yield* Effect.result(
        createRuntimeClient(connection).requestEffect(
          '/api/workspace/recovered-edits',
          undefined,
          workspaceRecoveriesSchema,
          { method: 'GET' },
        ),
      )
      if (
        remote._tag === 'Failure' &&
        !local.length &&
        !(remote.failure instanceof RuntimeRequestError && remote.failure.status === 404)
      )
        return yield* Effect.fail(remote.failure)
      const edits = new Map(
        (remote._tag === 'Success' ? remote.success.edits : []).map((edit) => [edit.id, edit]),
      )
      for (const edit of local)
        edits.set(edit.id, decode(workspaceRecoverySchema, redactRecovery(edit)))
      return {
        edits: [...edits.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        nextCursor: remote._tag === 'Success' ? remote.success.nextCursor : undefined,
        warnings:
          localResult._tag === 'Failure'
            ? ['Local recovered edits could not be read. They remain preserved on this device.']
            : [],
      }
    })
  }
  private send(connection: RuntimeConnection, item: MutationOutbox[number]) {
    return item.path === '/api/workspace' && item.method === 'PATCH'
      ? this.workspaceEffect(connection, item.input, item.id)
      : this.sendRaw(connection, item)
  }
  private sendRaw(connection: RuntimeConnection, item: MutationOutbox[number]) {
    return createRuntimeClient(connection).requestEffect(item.path, item.input, Schema.Unknown, {
      method: item.method,
      mutationId: item.id,
    })
  }
  private acknowledge(connection: RuntimeConnection, state: State, id: string) {
    if (!state.acknowledgements) return Effect.void
    // Only after durable journal removal. Lost acknowledgements retain the full receipt safely.
    return createRuntimeClient(connection)
      .requestEffect('/api/mutations/acknowledge', { ids: [id] }, Schema.Unknown)
      .pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      )
  }
  private drain(
    connection: RuntimeConnection,
    state: State,
    retry = false,
    stopBefore?: string,
    allowBlockedCommands = false,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (!state.pending.length) return
      let blockedError: Error | undefined
      const skipped = new Set<string>()
      while (state.pending.length) {
        const item = state.pending.find(
          (entry) => !skipped.has(entry.id) && (!blockedError || entry.path === '/api/workspace'),
        )
        if (!item || item.id === stopBefore) break
        // A saved workspace validation failure can safely be resolved from its receipt,
        // including journals created by older clients that retained rejected edits.
        if (
          item.blocked &&
          !retry &&
          !(item.path === '/api/workspace' && item.method === 'PATCH')
        ) {
          blockedError = new Error(
            state.error ?? 'A saved action needs review. Retry or discard pending actions.',
          )
          skipped.add(item.id)
          continue
        }
        const result = yield* Effect.result(this.send(connection, item))
        if (result._tag === 'Failure') {
          if (settledFailure(item, result.failure)) {
            yield* this.save(connection, state, (pending) =>
              pending.filter((entry) => entry.id !== item.id),
            )
            yield* this.acknowledge(connection, state, item.id)
            continue
          }
          state.error = transientMutation(item, result.failure)
            ? `Saved actions will sync when this computer is reachable. ${result.failure.message}`
            : result.failure.message
          if (!transientMutation(item, result.failure))
            yield* this.save(connection, state, (pending) =>
              pending.map((entry) => (entry.id === item.id ? { ...entry, blocked: true } : entry)),
            )
          this.changed()
          if (!transientMutation(item, result.failure) && item.path !== '/api/workspace') {
            blockedError = result.failure
            skipped.add(item.id)
            continue
          }
          return yield* Effect.fail(result.failure)
        }
        this.retainMessage(state, item)
        yield* this.save(connection, state, (pending) =>
          pending.filter((entry) => entry.id !== item.id),
        )
        yield* this.acknowledge(connection, state, item.id)
      }
      if (blockedError && !allowBlockedCommands) return yield* Effect.fail(blockedError)
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
          if (
            !(yield* this.supports(
              connection,
              state,
              retry || state.pending.some((item) => item.path === '/api/workspace'),
            ))
          )
            return yield* Effect.fail(
              new RuntimeRequestError({
                kind: 'response',
                status: 426,
                message: 'Update this runtime before recovering saved actions.',
              }),
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
        state.confirmedMessages = []
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
    if (method === 'GET' && path === '/api/workspace/recovered-edits')
      return this.workspaceRecoveriesEffect(connection).pipe(
        Effect.map((value) => decode(schema, value)),
      )
    if (!recoverableMutation(path, method))
      return createRuntimeClient(connection).requestEffect(path, input, schema, { method })
    const state = this.state(connection)
    return state.lock
      .withPermits(1)(
        Effect.gen({ self: this }, function* () {
          yield* this.load(connection, state)
          // Resolve old rejected settings before accepting a new edit, without replaying
          // unrelated commands or discarding conflicts with an uncertain outcome.
          if (
            state.pending[0]?.blocked &&
            state.pending[0].path === '/api/workspace' &&
            state.pending[0].method === 'PATCH'
          ) {
            if (yield* this.supports(connection, state)) {
              const next = state.pending.find(
                (entry) =>
                  !entry.blocked || entry.path !== '/api/workspace' || entry.method !== 'PATCH',
              )
              yield* this.drain(connection, state, false, next?.id, path === '/api/workspace')
            }
          }
          // A UI retry of the same unresolved command keeps its identity, including after restart.
          let item = state.pending.find(
            (entry) =>
              entry.path === path &&
              entry.method === method &&
              JSON.stringify(entry.input) === JSON.stringify(input),
          )
          const created = !item
          if (!item) {
            if (state.pending.some((entry) => entry.blocked) && path !== '/api/workspace')
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
              if (!(yield* this.supports(connection, state, path === '/api/workspace'))) {
                // This new command has never reached the host. Legacy hosts can execute it
                // normally; previously saved commands still require receipt support.
                if (created && state.pending.length === 1 && path !== '/api/workspace') {
                  sent = true
                  return yield* createRuntimeClient(connection).requestEffect(path, input, schema, {
                    method,
                  })
                }
                return yield* Effect.fail(
                  new RuntimeRequestError({
                    kind: 'response',
                    status: 426,
                    message: 'Update this runtime before recovering saved actions.',
                  }),
                )
              }
              yield* this.drain(connection, state, false, command.id, path === '/api/workspace')
              sent = true
              return yield* this.send(connection, command)
            }),
          )
          if (result._tag === 'Failure') {
            state.error = transientMutation(command, result.failure)
              ? `Action saved for reconnect. ${result.failure.message}`
              : result.failure.message
            const rejectedLegacyCommand =
              sent &&
              state.supported === false &&
              result.failure instanceof RuntimeRequestError &&
              result.failure.status !== undefined &&
              !transientMutation(command, result.failure)
            const rejectedEdit = sent && settledFailure(command, result.failure)
            if (
              (!transientMutation(command, result.failure) && !sent && created) ||
              rejectedLegacyCommand ||
              rejectedEdit
            )
              yield* this.save(connection, state, (pending) =>
                pending.filter((entry) => entry.id !== command.id),
              )
            if (rejectedEdit) yield* this.acknowledge(connection, state, command.id)
            if (
              !transientMutation(command, result.failure) &&
              sent &&
              !rejectedLegacyCommand &&
              !rejectedEdit
            )
              yield* this.save(connection, state, (pending) =>
                pending.map((entry) =>
                  entry.id === command.id ? { ...entry, blocked: true } : entry,
                ),
              )
            this.changed()
            // A send is accepted into this client's durable queue. Clear its composer now,
            // rather than resurrecting its text when reconnect later delivers it.
            if (
              transientMutation(command, result.failure) &&
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
          this.retainMessage(state, command)
          yield* this.save(connection, state, (pending) =>
            pending.filter((entry) => entry.id !== command.id),
          )
          yield* this.acknowledge(connection, state, command.id)
          if (!state.pending.some((entry) => entry.blocked)) state.error = null
          this.changed()
          return value
        }),
      )
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            state.error =
              !state.pending.length && settledFailure({ path, method }, error)
                ? null
                : error.message
            this.changed()
          }),
        ),
      )
  }
}

function redactRecovery(value: unknown, sensitive = false): unknown {
  if (sensitive && typeof value === 'string') return '[redacted]'
  if (Array.isArray(value)) return value.map((item) => redactRecovery(item, sensitive))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactRecovery(item, sensitive || key === 'envValues' || key === 'headerValues'),
      ]),
    )
  return value
}
