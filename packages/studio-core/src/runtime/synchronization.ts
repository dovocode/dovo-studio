import { Data, Effect, Schema } from 'effect'
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
})
export type WorkspaceOutbox = Schema.Schema.Type<typeof workspaceOutboxSchema>
type Persist = (connection: RuntimeConnection, value: WorkspaceOutbox | null) => Promise<void>

export class SynchronizationError extends Data.TaggedError('SynchronizationError')<{
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
      revision: Schema.Number.pipe(Schema.finite()),
      runtimeInstanceId: Schema.optional(Schema.String),
    }),
    'PATCH',
  )

/** Owns the durable outbox and serializes writes independently of network availability. */
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
  private draining: Effect.Effect<void, SynchronizationError> | null = null
  private conflicted = false
  private workspace: Workspace | null = null
  private durable: Effect.Effect<void, SynchronizationError> = Effect.void
  private readonly writer = Effect.runSync(Effect.makeSemaphore(1))

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
    this.workspace = restored?.workspace ?? null
    this.durable = Effect.void
    this.draining = null
    this.conflicted = this.pending.length > 0
    if (this.conflicted)
      this.onError(
        'Saved edits are waiting to sync. Retry sync, or reload the host workspace from Devices & runtime.',
      )
  }

  private save(
    connection: RuntimeConnection,
    patches: WorkspacePatch[],
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
        ? { version: 1, workspace: this.workspace, patches: [...patches] }
        : null
    const persist = this.persist
    // Each captured value is written once. Failed writes release the semaphore so
    // an explicit retry can proceed, while the failed durability gate stays failed.
    const work = Effect.runSync(
      Effect.cached(
        this.writer
          .withPermits(1)(attempt(() => persist(connection, value)))
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
    const generation = this.generation
    // Synchronous editor boundary: begin durability before allowing network flush.
    void runClientEffect(
      this.save(this.connection, this.pending).pipe(
        Effect.catchAll((error) =>
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
      idle: !this.pending.length && !this.draining && !this.conflicted,
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
    return this.isCurrent(checkpoint) && checkpoint.version === this.version && !this.draining
  }
  /** Preserve unsent edits without requiring the old address to be reachable. */
  savedEffect() {
    return Effect.gen(this, function* () {
      if (this.draining) yield* this.draining.pipe(Effect.catchAll(() => Effect.void))
      yield* this.durable
      const outbox: WorkspaceOutbox | null =
        this.pending.length && this.workspace
          ? { version: 1, workspace: this.workspace, patches: [...this.pending] }
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
    return this.draining !== null
  }
  hasPending() {
    return this.pending.length > 0
  }

  retryEffect(): Effect.Effect<void, SynchronizationError> {
    return Effect.suspend(() => {
      if (this.draining) return this.draining
      this.version++
      this.conflicted = false
      const generation = this.generation
      return Effect.gen(this, function* () {
        if (this.connection) yield* this.save(this.connection, this.pending)
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
    return Effect.gen(this, function* () {
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
      yield* this.save(this.connection, [])
      if (!this.isCurrent(checkpoint) || this.version !== checkpoint.version || this.isSending())
        return yield* Effect.fail(
          new SynchronizationError({
            message:
              'The workspace changed while clearing saved edits. Review the current changes.',
          }),
        )
      this.pending = []
      this.workspace = null
      this.conflicted = false
      this.version++
    })
  }
  discard(checkpoint: Checkpoint) {
    return runClientEffect(this.discardEffect(checkpoint))
  }

  flushEffect(): Effect.Effect<void, SynchronizationError> {
    return Effect.suspend(() => {
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
      const work = Effect.runSync(
        Effect.cached(
          Effect.gen(this, function* () {
            while (pending.length && generation === this.generation) {
              yield* this.durable
              if (generation !== this.generation) return
              const response = yield* attempt(() => this.send(target, pending[0]))
              if (generation !== this.generation) return
              const acknowledged = decodeResult(
                mutableStruct({
                  revision: Schema.Number.pipe(Schema.finite()),
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
              yield* this.save(target, pending.slice(1))
              pending.shift()
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
