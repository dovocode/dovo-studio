import { Data, Effect, Schema, Semaphore } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  decodeResult,
  mutableArray,
  mutableStruct,
  minValue,
  patchSchema,
  workspaceSchema,
  runtimeRequestEffect,
  RuntimeRequestError,
  randomUUID,
  type RuntimeConnection,
  type Workspace,
  type WorkspacePatch,
} from '@dovo/protocol'

type Checkpoint = { generation: number; version: number; idle: boolean }
type Send = (
  connection: RuntimeConnection,
  patch: WorkspacePatch,
) => Promise<unknown> | Effect.Effect<unknown, unknown>
export const workspaceOutboxSchema = mutableStruct({
  version: Schema.Literal(1),
  workspace: workspaceSchema,
  patches: minValue(mutableArray(patchSchema), 1),
  ids: Schema.optional(mutableArray(Schema.NonEmptyString)),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        !value.ids ||
        (value.ids.length === value.patches.length && new Set(value.ids).size === value.ids.length),
      { message: 'Workspace patch IDs must be unique and match the pending patches' },
    ),
  ),
)
export type WorkspaceOutbox = Schema.Schema.Type<typeof workspaceOutboxSchema>
export type WorkspaceOutboxChange = { append: string[]; remove: string[] }
type Persist = (
  connection: RuntimeConnection,
  value: WorkspaceOutbox | null,
  change: WorkspaceOutboxChange,
) => Promise<void>

class SynchronizationError extends Data.TaggedError('SynchronizationError')<{
  readonly message: string
  readonly cause?: unknown
}> {}
const failure = (cause: unknown) =>
  new SynchronizationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
/** The runtime was unreachable or timed out. It may or may not have applied the patch, and
 * resending is safe either way: it treats an identical, already-applied patch as a no-op. */
const transient = (error: SynchronizationError) =>
  error.cause instanceof RuntimeRequestError &&
  (error.cause.kind === 'connection' ||
    error.cause.kind === 'timeout' ||
    error.cause.status === 502 ||
    error.cause.status === 503 ||
    error.cause.status === 504)
const attempt = <A>(run: () => Promise<A> | Effect.Effect<A, unknown>) =>
  Effect.try({ try: run, catch: failure }).pipe(
    Effect.flatMap((value) =>
      Effect.isEffect(value)
        ? value.pipe(Effect.mapError(failure))
        : Effect.tryPromise({ try: () => value, catch: failure }),
    ),
  )
const sendPatch: Send = (connection, patch) =>
  runtimeRequestEffect(
    connection,
    connection.address,
    '/api/workspace',
    patch,
    mutableStruct({
      revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
      runtimeInstanceId: Schema.optional(Schema.String),
    }),
    'PATCH',
  )

/** Serializes this editor's writes; persistence merges stable patch IDs across tabs. */
export class WorkspaceSynchronization {
  private connection: RuntimeConnection | null = null
  private acknowledged?: { instanceId: string; revision: number }
  acceptsRevision(revision: number, instanceId?: string) {
    return (
      !instanceId ||
      this.acknowledged?.instanceId !== instanceId ||
      revision >= this.acknowledged.revision
    )
  }
  private generation = 0
  private version = 0
  private pending: WorkspacePatch[] = []
  private pendingIds: string[] = []
  private writtenIds = new Set<string>()
  private draining: Effect.Effect<void, SynchronizationError> | null = null
  private discarding: object | null = null
  private conflicted = false
  private workspace: Workspace | null = null
  private durable: Effect.Effect<void, SynchronizationError> = Effect.void
  private readonly writer = Effect.runSync(Semaphore.make(1))

  constructor(
    private onError: (message: string | null) => void,
    private send: Send = sendPatch,
    private persist?: Persist,
  ) {}

  bind(connection: RuntimeConnection | null, restored: WorkspaceOutbox | null = null) {
    this.generation++
    this.acknowledged = undefined
    this.connection = connection
    this.pending = restored ? [...restored.patches] : []
    this.pendingIds = restored?.ids ? [...restored.ids] : this.pending.map(() => randomUUID())
    this.writtenIds = new Set(restored?.ids ?? [])
    this.workspace = restored?.workspace ?? null
    this.durable = Effect.void
    this.draining = null
    this.discarding = null
    this.conflicted = this.pending.length > 0
    if (this.conflicted)
      this.onError(
        'Saved edits are waiting to sync. Retry sync, or reload the host workspace from Devices & runtime.',
      )
  }

  private save(
    connection: RuntimeConnection,
    patches: WorkspacePatch[],
    ids: string[],
    remove: string[] = [],
  ): Effect.Effect<void, SynchronizationError> {
    if (!this.persist) return Effect.void
    if (patches.length && !this.workspace)
      return Effect.fail(
        new SynchronizationError({
          message: 'Cannot save pending changes without their workspace.',
        }),
      )
    const value: WorkspaceOutbox | null =
      patches.length && this.workspace
        ? { version: 1, workspace: this.workspace, patches: [...patches], ids: [...ids] }
        : null
    const persist = this.persist
    const written = this.writtenIds
    const capturedIds = [...ids]
    // Each captured value is written once. Failed writes release the semaphore so
    // an explicit retry can proceed, while the failed durability gate stays failed.
    const work = Effect.runSync(
      Effect.cached(
        this.writer
          .withPermits(1)(
            Effect.suspend(() => {
              const append = capturedIds.filter((id) => !written.has(id))
              return attempt(() => persist(connection, value, { append, remove })).pipe(
                Effect.tap(() => Effect.sync(() => append.forEach((id) => written.add(id)))),
              )
            }),
          )
          .pipe(Effect.uninterruptible),
      ),
    )
    this.durable = work
    return work
  }

  enqueue(patches: WorkspacePatch[], workspace?: Workspace) {
    if (!patches.length) return
    this.version++
    if (workspace) this.workspace = workspace
    if (!this.connection) return
    this.pending.push(...patches)
    this.pendingIds.push(...patches.map(() => randomUUID()))
    const generation = this.generation
    // Synchronous editor boundary: begin durability before allowing network flush.
    void runClientEffect(
      this.save(this.connection, this.pending, this.pendingIds).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (generation === this.generation) {
              this.conflicted = true
              this.onError(
                `Could not save pending changes. Keep this window open. ${error.message}`,
              )
            }
          }),
        ),
      ),
    )
  }

  checkpoint(): Checkpoint {
    return {
      generation: this.generation,
      version: this.version,
      idle: !this.pending.length && !this.isSending() && !this.conflicted,
    }
  }
  isCurrent(checkpoint: Checkpoint) {
    return checkpoint.generation === this.generation
  }
  accepts(checkpoint: Checkpoint) {
    return (
      this.isCurrent(checkpoint) &&
      checkpoint.version === this.version &&
      checkpoint.idle &&
      this.checkpoint().idle
    )
  }
  acceptsSaved(checkpoint: Checkpoint) {
    return this.isCurrent(checkpoint) && checkpoint.version === this.version && !this.isSending()
  }
  /** Preserve unsent edits without requiring the old address to be reachable. */
  savedEffect() {
    return Effect.gen({ self: this }, function* () {
      if (this.discarding)
        return yield* Effect.fail(
          new SynchronizationError({ message: 'Wait for saved edits to finish clearing.' }),
        )
      if (this.draining) yield* this.draining.pipe(Effect.catch(() => Effect.void))
      yield* this.durable
      const outbox: WorkspaceOutbox | null =
        this.pending.length && this.workspace
          ? {
              version: 1,
              workspace: this.workspace,
              patches: [...this.pending],
              ids: [...this.pendingIds],
            }
          : null
      return { checkpoint: this.checkpoint(), outbox }
    })
  }
  clearNetworkError() {
    if (this.conflicted) return
    // The host answered a poll: resume edits that were held back by a transient failure.
    if (this.pending.length && !this.draining && this.connection)
      void runClientEffect(this.flushEffect()).catch(() => undefined)
    else this.onError(null)
  }
  isSending() {
    return this.draining !== null || this.discarding !== null
  }
  hasPending() {
    return this.pending.length > 0
  }

  retryEffect(): Effect.Effect<void, SynchronizationError> {
    return Effect.suspend(() => {
      if (this.discarding)
        return Effect.fail(
          new SynchronizationError({ message: 'Wait for saved edits to finish clearing.' }),
        )
      if (this.draining) return this.draining
      this.version++
      this.conflicted = false
      const generation = this.generation
      return Effect.gen({ self: this }, function* () {
        if (this.connection) yield* this.save(this.connection, this.pending, this.pendingIds)
        if (generation !== this.generation)
          return yield* Effect.fail(
            new SynchronizationError({
              message: 'Runtime connection changed while saving pending edits.',
            }),
          )
        yield* this.flushEffect()
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (generation === this.generation) {
              this.conflicted = true
              this.onError(error.message)
            }
          }),
        ),
      )
    })
  }
  retry() {
    return runClientEffect(this.retryEffect())
  }

  discardEffect(checkpoint: Checkpoint) {
    const operation = {}
    return Effect.gen({ self: this }, function* () {
      if (
        !this.connection ||
        this.isSending() ||
        !this.isCurrent(checkpoint) ||
        this.version !== checkpoint.version
      )
        return yield* Effect.fail(
          new SynchronizationError({
            message: 'Changes are still in progress. Wait before reloading.',
          }),
        )
      const remove = [...this.pendingIds]
      this.discarding = operation
      yield* this.save(this.connection, [], [], remove)
      if (!this.isCurrent(checkpoint))
        return yield* Effect.fail(
          new SynchronizationError({
            message:
              'The workspace changed while clearing saved edits. Review the current changes.',
          }),
        )
      const removed = new Set(remove)
      for (let index = this.pendingIds.length - 1; index >= 0; index--) {
        if (!removed.has(this.pendingIds[index])) continue
        this.pendingIds.splice(index, 1)
        this.pending.splice(index, 1)
      }
      const changed = this.version !== checkpoint.version
      if (!this.pending.length) this.workspace = null
      this.conflicted = changed && this.pending.length > 0
      this.version++
      if (changed)
        return yield* Effect.fail(
          new SynchronizationError({
            message:
              'Saved edits were cleared. New edits remain queued; review them before syncing.',
          }),
        )
    }).pipe(
      // A committed removal and its in-memory retirement are one operation.
      Effect.uninterruptible,
      Effect.ensuring(
        Effect.sync(() => {
          if (this.discarding === operation) this.discarding = null
        }),
      ),
    )
  }
  discard(checkpoint: Checkpoint) {
    return runClientEffect(this.discardEffect(checkpoint))
  }

  flushEffect(): Effect.Effect<void, SynchronizationError> {
    return Effect.suspend(() => {
      if (this.discarding)
        return Effect.fail(
          new SynchronizationError({ message: 'Wait for saved edits to finish clearing.' }),
        )
      if (this.draining) return this.draining
      const target = this.connection
      if (!target) return Effect.void
      if (this.conflicted)
        return Effect.fail(
          new SynchronizationError({
            message:
              'Changes are waiting to sync. Retry sync, or reload the host workspace from Devices & runtime.',
          }),
        )
      const generation = this.generation
      const pending = this.pending
      const pendingIds = this.pendingIds
      const work = Effect.runSync(
        Effect.cached(
          Effect.gen({ self: this }, function* () {
            while (pending.length && generation === this.generation) {
              yield* this.durable
              if (generation !== this.generation) return
              const response = yield* attempt(() => this.send(target, pending[0]))
              if (generation !== this.generation) return
              const acknowledged = decodeResult(
                mutableStruct({
                  revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
                  runtimeInstanceId: Schema.String,
                }),
                response,
              )
              if (acknowledged.success) {
                const { runtimeInstanceId: instanceId, revision } = acknowledged.data
                this.acknowledged = {
                  instanceId,
                  revision:
                    this.acknowledged?.instanceId === instanceId
                      ? Math.max(revision, this.acknowledged.revision)
                      : revision,
                }
              }
              // Preserve an acknowledged patch until the durable queue commits.
              yield* this.save(target, pending.slice(1), pendingIds.slice(1), [pendingIds[0]]).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    pending.shift()
                    pendingIds.shift()
                  }),
                ),
                Effect.uninterruptible,
              )
            }
            if (generation === this.generation) this.onError(null)
          }).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (generation !== this.generation) return
                // A dropped connection is not a conflict: keep the queue and retry on the
                // next request or successful poll instead of blocking every action.
                if (transient(error)) {
                  this.onError(`Changes will sync when the runtime is reachable. ${error.message}`)
                  return
                }
                this.conflicted = true
                this.onError(error.message)
              }),
            ),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                if (generation === this.generation && pending.length) {
                  this.conflicted = true
                  this.onError(
                    'Sync was interrupted. Your edits remain queued. Retry sync before continuing.',
                  )
                }
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (this.draining === work) this.draining = null
              }),
            ),
          ),
        ),
      )
      this.draining = work
      return work
    })
  }
  flush() {
    return runClientEffect(this.flushEffect())
  }
}
