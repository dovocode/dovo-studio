import { createRuntimeClient } from '../../shared/runtime-client.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  reconcileWorkspaceEdit,
  sameWorkspaceEditValue,
  workspaceDraftConsumed,
} from './workspace-reconciliation.js'
import { runtimeSnapshotPath } from './live-sync.js'
import { Effect, Result, Schema, Semaphore } from 'effect'
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
import { taskMessageSchema } from '../../tasks/task-message.js'
import { taskSchema, type Task } from '../../workspace.js'
import { savedPendingMessages } from '../../conversation/workflow/pending-message.js'
import {
  attachmentUploadSchema,
  attachmentReplaceSchema,
  attachmentUploadResultSchema,
} from '../../shared/attachments.js'

const attachmentUploadPaths = new Set([
  '/api/attachments/recoverable-upload',
  '/api/attachments/recoverable-replace',
])
const attachmentUpload = (item: { path: string }) => attachmentUploadPaths.has(item.path)
const attachmentAckPath = '/api/attachments/acknowledge-upload'
const attachmentAck = (item: { path: string }) => item.path === attachmentAckPath
const attachmentJournal = (item: { path: string }) => attachmentUpload(item) || attachmentAck(item)

const queueActionSchema = mutableStruct({
  id: Schema.String,
  action: Schema.String,
  messageId: Schema.optional(Schema.String),
})

const mutations = new Set([
  '/api/threads/metadata',
  '/api/tasks/message',
  '/api/tasks/queue',
  '/api/scm/pulls/link-thread',
  '/api/tasks/steer',
  '/api/tasks/cancel',
  '/api/tasks/lifecycle',
  '/api/tasks/list-action',
  '/api/tasks/viewed',
  '/api/tasks/checklist/clear',
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
    /** Credential renewal lost the original receipt namespace. Never replay without consent. */
    reviewAfterRenewal: Schema.optional(Schema.Boolean),
    receiptToken: Schema.optional(Schema.String),
    attachmentReplacement: Schema.optional(Schema.Boolean),
    /** Keep a new offline thread visible across a crash until its snapshot is cached. */
    retainUntilCached: Schema.optional(Schema.Boolean),
  }),
)
export type MutationOutbox = Schema.Schema.Type<typeof mutationOutboxSchema>
export type SavedMutationAction = {
  id: string
  label: string
  preview?: string
  taskId?: string
  blocked: boolean
  reviewRequired: boolean
}
export type RuntimeMutationStatus = {
  pending: number
  error: string | null
  reviewRequired?: boolean
  actions?: SavedMutationAction[]
}
const actionLabels: Record<string, string> = {
  '/api/threads/metadata': 'Change shared thread metadata',
  '/api/tasks/message': 'Send message',
  '/api/tasks/steer': 'Steer agent',
  '/api/tasks/cancel': 'Stop agent',
  '/api/tasks/lifecycle': 'Change thread state',
  '/api/tasks/list-action': 'Change thread list',
  '/api/tasks/viewed': 'Mark thread viewed',
  '/api/tasks/checklist/clear': 'Clear checklist',
  '/api/scm/pulls/link-thread': 'Link pull request',
  '/api/workspace': 'Save workspace edit',
  '/api/runtime/preferences/save': 'Save computer preferences',
  '/api/agents/defaults/save': 'Save agent defaults',
  '/api/agents/settings/save': 'Save agent settings',
  '/api/agents/settings/sync': 'Sync agent settings',
  '/api/agents/setup/save': 'Save agent setup',
  '/api/agents/title-settings/save': 'Save title settings',
  '/api/previews/browser/profiles/save': 'Save browser profiles',
}
function savedAction(item: MutationOutbox[number]): SavedMutationAction {
  const input = item.input
  const message = item.path === '/api/tasks/message' || item.path === '/api/tasks/steer'
  const record = input && typeof input === 'object' ? input : undefined
  return {
    id: item.id,
    label: actionLabels[item.path] ?? 'Saved action',
    // Only message text is previewed. Settings payloads can contain credentials.
    ...(message && record && 'text' in record && typeof record.text === 'string'
      ? { preview: record.text.slice(0, 500) }
      : {}),
    ...(item.path.startsWith('/api/tasks/') &&
    record &&
    'id' in record &&
    typeof record.id === 'string'
      ? { taskId: record.id }
      : {}),
    blocked: !!item.blocked,
    reviewRequired: !!item.reviewAfterRenewal,
  }
}
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
  queueMutations?: boolean
  pending: MutationOutbox
  /** Presentation handoff only; these commands have already left the durable journal. */
  confirmedMessages: MutationOutbox
  confirmedTasks: MutationOutbox
  activeAttachments: Set<string>
  error: string | null
  /** Lock order: sender → admission → journal. Enqueue uses only the two local locks. */
  lock: Semaphore.Semaphore
  /** Serializes admission with credential transfer, discard and forget. */
  admission: Semaphore.Semaphore
  /** Prevents a slow journal read from overwriting a newer durable update in memory. */
  journal: Semaphore.Semaphore
  replaced?: boolean
  renewedCredential?: string
  /** Automatic recovery per account credential: one shared attempt and a bounded backoff. */
  automatic: Map<string, AutomaticRecovery>
}
type AutomaticRecovery = {
  run?: Promise<Result.Result<void, Error>>
  failures: number
  retryAt: number
  wake?: ReturnType<typeof setTimeout>
}
/** 1s, 2s, 4s ... 30s between automatic attempts while the host keeps failing transiently. */
const automaticRetryDelay = (failures: number) => Math.min(30000, 1000 * 2 ** (failures - 1))
const connectionKey = (connection: RuntimeConnection) =>
  JSON.stringify([new URL(connection.address).origin, connection.token])
const accountCredential = (connection: RuntimeConnection) =>
  JSON.stringify([
    connection.accountSession,
    connection.token,
    connection.internet?.session,
    connection.internet?.token,
  ])
const transient = (error: unknown) =>
  error instanceof RuntimeRequestError &&
  (error.kind === 'connection' ||
    error.kind === 'timeout' ||
    [502, 503, 504].includes(error.status ?? 0))
const transientMutation = (item: { path: string }, error: unknown) =>
  transient(error) ||
  (error instanceof RuntimeRequestError &&
    error.status === 403 &&
    error.message === 'Account access requires an authorized Dovo Connect tunnel') ||
  (item.path === '/api/workspace' &&
    error instanceof RuntimeRequestError &&
    [500, 426].includes(error.status ?? 0))
// Workspace validation happens before the patch commits. New runtimes explicitly
// identify rejected edits; older runtimes return 400 for invalid input.
const rejectedPatch = (item: { path: string; method: string }, error: unknown) =>
  item.path === '/api/workspace' && item.method === 'PATCH' && workspacePatchRejected(error)
const settledFailure = (item: { path: string; method: string }, error: unknown) =>
  rejectedPatch(item, error) ||
  (error instanceof RuntimeRequestError &&
    (error.mutationRetired === true ||
      (['/api/tasks/checklist/clear', '/api/tasks/list-action', '/api/tasks/queue'].includes(
        item.path,
      ) &&
        error.mutationRejected === true)))
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
        confirmedTasks: [],
        activeAttachments: new Set(),
        error: null,
        lock: Effect.runSync(Semaphore.make(1)),
        automatic: new Map(),
        admission: Effect.runSync(Semaphore.make(1)),
        journal: Effect.runSync(Semaphore.make(1)),
      }
      this.states.set(key, state)
    }
    return state
  }
  status(connection: RuntimeConnection) {
    const state = this.state(connection)
    return {
      pending: state.pending.filter(
        (item) =>
          !state.activeAttachments.has(item.id) &&
          !state.confirmedTasks.some((task) => task.id === item.id),
      ).length,
      error: state.error,
      reviewRequired: state.pending.some((item) => item.reviewAfterRenewal),
      actions: state.pending
        .filter(
          (item) =>
            !attachmentJournal(item) && !state.confirmedTasks.some((task) => task.id === item.id),
        )
        .map(savedAction),
    }
  }
  attachmentUploads(connection: RuntimeConnection) {
    const state = this.state(connection)
    return state.pending.filter(
      (item) => attachmentJournal(item) && !state.activeAttachments.has(item.id),
    )
  }
  attachmentPendingEffect(connection: RuntimeConnection, id: string) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        yield* this.load(connection, state)
        return state.pending.some((item) => item.id === id && attachmentJournal(item))
      }),
    )
  }
  reviewAttachments(connection: RuntimeConnection) {
    const state = this.state(connection)
    if (
      state.pending.some((item) => attachmentJournal(item) && !state.activeAttachments.has(item.id))
    ) {
      state.error = 'Saved attachments need review.'
      this.changed()
    }
  }
  requestAttachmentEffect(connection: RuntimeConnection, value: unknown, replacement: boolean) {
    return Effect.suspend(() => {
      let staged = false
      let completed = false
      let activeId: string | undefined
      return Effect.gen({ self: this }, function* () {
        const capability = yield* createRuntimeClient(connection).requestEffect(
          '/api/mutations/status',
          undefined,
          mutableStruct({
            version: Schema.Literal(1),
            attachmentUploads: Schema.optional(Schema.Literals([1, 2])),
          }),
          { method: 'GET' },
        )
        if (capability.attachmentUploads !== 2)
          return yield* Effect.fail(
            new Error('Update this computer before attaching files safely.'),
          )
        const input = yield* Effect.try({
          try: () => decode(replacement ? attachmentReplaceSchema : attachmentUploadSchema, value),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        activeId = input.id
        this.state(connection).activeAttachments.add(input.id)
        yield* this.stageAttachmentEffect(connection, input, replacement)
        staged = true
        const result = yield* createRuntimeClient(connection).requestEffect(
          replacement
            ? '/api/attachments/recoverable-replace'
            : '/api/attachments/recoverable-upload',
          input,
          attachmentUploadResultSchema,
        )
        if (result.attachment.id !== input.id)
          return yield* Effect.fail(
            new Error('Upload response identity does not match. The upload was preserved.'),
          )
        completed = true
        return result
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (activeId) this.state(connection).activeAttachments.delete(activeId)
            if (staged && !completed) {
              this.state(connection).error = 'Saved attachments need review.'
              this.changed()
            }
          }),
        ),
      )
    })
  }
  retryAttachmentAfterReviewEffect(connection: RuntimeConnection, id: string) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        if (
          state.replaced ||
          (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
        )
          return yield* Effect.fail(new Error('The computer connection changed.'))
        yield* this.load(connection, state)
        const item = state.pending.find((entry) => entry.id === id && attachmentJournal(entry))
        if (!item) return yield* Effect.fail(new Error('Saved attachment not found.'))
        if (item.reviewAfterRenewal)
          return yield* Effect.fail(
            new Error(
              'Computer access changed. This upload needs manual review on its original computer.',
            ),
          )
        const input = yield* Effect.try({
          try: () =>
            decode(
              (
                attachmentAck(item)
                  ? item.attachmentReplacement
                  : item.path === '/api/attachments/recoverable-replace'
              )
                ? attachmentReplaceSchema
                : attachmentUploadSchema,
              item.input,
            ),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        if (input.id !== id)
          return yield* Effect.fail(
            new Error('Saved attachment identity is invalid. It was preserved.'),
          )
        const receipt = yield* createRuntimeClient(connection).requestEffect(
          '/api/attachments/upload-receipt',
          { id },
          mutableStruct({
            receipt: Schema.NullOr(attachmentUploadResultSchema),
            available: Schema.Boolean,
          }),
        )
        if (receipt.receipt && !receipt.available)
          return yield* Effect.fail(
            new Error(
              'The committed attachment is no longer available. Its saved upload was preserved.',
            ),
          )
        if (
          !receipt.receipt &&
          (attachmentAck(item) || (!input.detached && !input.queuedMessageId))
        )
          return yield* Effect.fail(
            new Error('The upload outcome cannot be safely replayed. It was preserved.'),
          )
        const result =
          receipt.receipt ??
          (yield* createRuntimeClient(connection).requestEffect(
            item.path,
            input,
            attachmentUploadResultSchema,
          ))
        if (result.attachment.id !== id)
          return yield* Effect.fail(
            new Error('Upload receipt identity does not match. The upload was preserved.'),
          )
        return result
      }),
    )
  }
  stageAttachmentEffect(connection: RuntimeConnection, value: unknown, replacement: boolean) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        if (
          state.replaced ||
          (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
        )
          return yield* Effect.fail(new Error('The computer connection changed.'))
        const input = yield* Effect.try({
          try: () => decode(replacement ? attachmentReplaceSchema : attachmentUploadSchema, value),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        const path = replacement
          ? '/api/attachments/recoverable-replace'
          : '/api/attachments/recoverable-upload'
        yield* this.save(connection, state, (pending) => {
          const existing = pending.find((item) => item.id === input.id)
          if (existing) {
            if (existing.path !== path || JSON.stringify(existing.input) !== JSON.stringify(input))
              throw new Error('Saved upload identity conflict. The original upload was preserved.')
            return pending
          }
          return [...pending, { id: input.id, path, method: 'POST', input }]
        })
      }).pipe(Effect.uninterruptible),
    )
  }
  finishAttachmentEffect(connection: RuntimeConnection, id: string) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        if (
          state.replaced ||
          (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
        )
          return yield* Effect.fail(new Error('The computer connection changed.'))
        yield* this.load(connection, state)
        const item = state.pending.find((entry) => entry.id === id && attachmentJournal(entry))
        if (!item) return yield* Effect.fail(new Error('Saved attachment not found.'))
        if (item.reviewAfterRenewal)
          return yield* Effect.fail(
            new Error('Computer access changed. Review this upload on its original connection.'),
          )
        if (attachmentAck(item)) {
          yield* this.sendAttachmentAck(connection, state, id)
          return
        }
        const confirmation = yield* createRuntimeClient(connection).requestEffect(
          '/api/attachments/upload-handled',
          { id },
          mutableStruct({ handled: Schema.Boolean }),
        )
        if (!confirmation.handled)
          return yield* Effect.fail(
            new Error('Save or recover this attachment before confirming it.'),
          )
        yield* this.save(connection, state, (pending) =>
          pending.map((item) =>
            item.id === id && attachmentUpload(item)
              ? {
                  id,
                  path: attachmentAckPath,
                  method: 'POST' as const,
                  input: item.input,
                  attachmentReplacement: item.path.endsWith('recoverable-replace'),
                }
              : item,
          ),
        )
        yield* this.sendAttachmentAck(connection, state, id)
        if (!state.pending.length && state.error === 'Saved attachments need review.') {
          state.error = null
          this.changed()
        }
      }).pipe(Effect.uninterruptible),
    )
  }
  discardAttachmentEffect(connection: RuntimeConnection, id: string) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        if (
          state.replaced ||
          (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
        )
          return yield* Effect.fail(new Error('The computer connection changed.'))
        yield* this.load(connection, state)
        const item = state.pending.find((entry) => entry.id === id && attachmentJournal(entry))
        if (!item) return yield* Effect.fail(new Error('Saved attachment not found.'))
        if (item.reviewAfterRenewal)
          return yield* Effect.fail(
            new Error('Computer access changed. Review this upload on its original connection.'),
          )
        yield* createRuntimeClient(connection).requestEffect(
          (
            attachmentAck(item)
              ? item.attachmentReplacement
              : item.path.endsWith('recoverable-replace')
          )
            ? '/api/attachments/abandon-replace'
            : '/api/attachments/abandon-upload',
          item.input,
          mutableStruct({ ok: Schema.Literal(true) }),
        )
        yield* this.save(connection, state, (pending) =>
          pending.filter((entry) => entry.id !== id || !attachmentJournal(entry)),
        )
        if (!state.pending.length && state.error === 'Saved attachments need review.') {
          state.error = null
          this.changed()
        }
      }).pipe(Effect.uninterruptible),
    )
  }
  private sendAttachmentAck(connection: RuntimeConnection, state: State, id: string) {
    return Effect.gen({ self: this }, function* () {
      const confirmation = yield* createRuntimeClient(connection).requestEffect(
        '/api/attachments/upload-handled',
        { id },
        mutableStruct({ handled: Schema.Boolean }),
      )
      if (!confirmation.handled)
        return yield* Effect.fail(
          new Error('The attachment destination changed. Its upload was preserved for review.'),
        )
      yield* createRuntimeClient(connection).requestEffect(
        attachmentAckPath,
        { id },
        mutableStruct({ ok: Schema.Literal(true) }),
      )
      yield* this.save(connection, state, (pending) =>
        pending.filter((item) => item.id !== id || !attachmentAck(item)),
      )
    })
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
    const patch = item.path === '/api/workspace' ? decodeResult(patchSchema, item.input) : undefined
    if (
      item.retainUntilCached &&
      patch?.success &&
      patch.data.collection === 'tasks' &&
      patch.data.create
    )
      state.confirmedTasks = [...state.confirmedTasks.filter((entry) => entry.id !== item.id), item]
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
            queueMutations: Schema.optional(Schema.Literal(1)),
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
      state.queueMutations = result.success.queueMutations === 1
      return (state.supported = true)
    })
  }
  private load(connection: RuntimeConnection, state: State) {
    return state.journal.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const value = yield* operation(() => this.storage.read(connection))
        const pending = yield* Effect.try({
          try: () => decode(mutationOutboxSchema, value ?? []),
          catch: (error) =>
            new Error('Saved actions could not be read. They have been preserved.', {
              cause: error,
            }),
        })
        // This comparison only suppresses notifications; every operation still reads and
        // uses the freshly decoded durable journal, including other clients' changes.
        const comparable = (items: MutationOutbox) =>
          items.map((item) => (attachmentJournal(item) ? { ...item, input: null } : item))
        const changed =
          JSON.stringify(comparable(pending)) !== JSON.stringify(comparable(state.pending))
        state.pending = pending
        if (changed) this.changed()
      }),
    )
  }
  private save(
    connection: RuntimeConnection,
    state: State,
    change: (pending: MutationOutbox) => MutationOutbox,
  ) {
    return state.journal.withPermits(1)(
      operation(() => this.storage.update(connection, change)).pipe(
        Effect.tap((pending) =>
          Effect.sync(() => {
            state.pending = pending
            this.changed()
          }),
        ),
        Effect.uninterruptible,
      ),
    )
  }
  /** Local admission never waits for a network-held sender lock. Only durable queue sends
   * and their task configuration can be deferred; run-specific actions remain foreground. */
  enqueueEffect<T extends Schema.Codec<unknown, unknown>>(
    connection: RuntimeConnection,
    path: string,
    input: unknown,
    schema: T,
    method = 'POST',
  ) {
    const state = this.state(connection)
    return state.admission.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        if (
          state.replaced ||
          (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
        )
          return yield* Effect.fail(new Error('Computer access changed. Try this action again.'))
        const patch =
          path === '/api/workspace' && method === 'PATCH'
            ? decodeResult(patchSchema, input)
            : undefined
        const message =
          path === '/api/tasks/message' && method === 'POST'
            ? decodeResult(taskMessageSchema, input)
            : undefined
        if (
          !(patch?.success && patch.data.collection === 'tasks') &&
          !(
            message?.success &&
            !!message.data.messageId &&
            !message.data.sendNow &&
            !message.data.runId
          )
        )
          return yield* Effect.fail(new Error('This action needs a connection to the computer.'))
        // Decode the acknowledgement before writing: a mismatched caller must never commit
        // a command and then report that local admission failed.
        const result = yield* Effect.try({
          try: () => decode(schema, patch?.success ? { revision: 0 } : { ok: true, pending: true }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        yield* this.save(connection, state, (pending) => {
          if (pending.some((entry) => entry.blocked || entry.reviewAfterRenewal))
            throw new Error('Review saved actions before sending another message.')
          if (message?.success) {
            const content = (value: typeof message.data) =>
              JSON.stringify({
                ...value,
                // A local title preview can change `before` between admission and a UI retry.
                initialTitle: value.initialTitle
                  ? { ...value.initialTitle, before: '' }
                  : undefined,
              })
            const previous = pending.find((entry) => {
              if (entry.path !== path || entry.method !== method) return false
              const saved = decodeResult(taskMessageSchema, entry.input)
              if (
                !saved.success ||
                saved.data.id !== message.data.id ||
                saved.data.messageId !== message.data.messageId
              )
                return false
              if (content(saved.data) !== content(message.data))
                throw new Error('This saved message already has different content.')
              return true
            })
            if (previous) return pending
          }
          if (
            pending.some(
              (entry) =>
                entry.path === path &&
                entry.method === method &&
                JSON.stringify(entry.input) === JSON.stringify(input),
            )
          )
            return pending
          return [
            ...pending,
            {
              id: this.storage.id(),
              path,
              method: method === 'PATCH' ? 'PATCH' : 'POST',
              input,
              ...(patch?.success && patch.data.create ? { retainUntilCached: true } : {}),
            },
          ]
        })
        return result
      }).pipe(Effect.uninterruptible),
    )
  }
  /** Restore presentation without making a network request. */
  restoreEffect(connection: RuntimeConnection) {
    return this.load(connection, this.state(connection))
  }
  /** Call only after the authoritative snapshot has been durably cached. Until then,
   * the creation receipt remains replayable and its full task remains recoverable offline. */
  taskCreationsCachedEffect(connection: RuntimeConnection, tasks: readonly Task[]) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const ids = new Set(
          state.confirmedTasks
            .filter((item) => {
              const patch = decodeResult(patchSchema, item.input)
              return patch.success && tasks.some((task) => task.id === patch.data.id)
            })
            .map((item) => item.id),
        )
        if (!ids.size || state.replaced) return
        yield* this.save(connection, state, (pending) =>
          pending.filter((item) => !ids.has(item.id)),
        )
        state.confirmedTasks = state.confirmedTasks.filter((item) => !ids.has(item.id))
        for (const id of ids) yield* this.acknowledge(connection, state, id)
      }),
    )
  }
  /** Pending task creation is presentation only; authoritative snapshots stay untouched. */
  pendingTasks(connection: RuntimeConnection, tasks: Task[]): Task[] {
    const state = this.state(connection)
    let result = tasks
    for (const item of [...state.confirmedTasks, ...state.confirmedMessages, ...state.pending]) {
      if (item.path === '/api/tasks/message') {
        const message = decodeResult(taskMessageSchema, item.input)
        if (message.success && message.data.initialTitle) {
          const title = message.data.initialTitle
          result = result.map((task) =>
            task.id === message.data.id && task.title === title.before
              ? { ...task, title: title.after }
              : task,
          )
        }
        continue
      }
      if (item.path !== '/api/workspace') continue
      const patch = decodeResult(patchSchema, item.input)
      if (!patch.success || patch.data.collection !== 'tasks') continue
      const existing = result.find((task) => task.id === patch.data.id)
      if (existing && !Object.keys(patch.data.changes).length) continue
      const value = existing ?? patch.data.create
      if (!value) continue
      const decoded = decodeResult(taskSchema, {
        ...value,
        ...Object.fromEntries(
          Object.entries(patch.data.changes).map(([key, edit]) => [key, edit.after]),
        ),
      })
      if (!decoded.success) continue
      result = existing
        ? result.map((task) => (task.id === decoded.data.id ? decoded.data : task))
        : [decoded.data, ...result]
    }
    return result
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
        const response = yield* this.sendRaw(
          connection,
          {
            id: retryId,
            path: '/api/workspace',
            method: 'PATCH',
            input: rebased,
          },
          id,
        ).pipe(
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
  private bindReceipt(connection: RuntimeConnection, id: string, token: string | undefined) {
    const state = this.state(connection)
    return Effect.gen({ self: this }, function* () {
      const item = state.pending.find((entry) => entry.id === id)
      if (item?.reviewAfterRenewal)
        return yield* Effect.fail(
          new Error('Review saved actions before retrying; some may already have run.'),
        )
      if (!item || !token || item.receiptToken === token) return
      const safe =
        (item.path === '/api/tasks/message' || item.path === '/api/tasks/steer') &&
        item.input !== null &&
        typeof item.input === 'object' &&
        'messageId' in item.input &&
        typeof item.input.messageId === 'string' &&
        !!item.input.messageId
      if (item.receiptToken && !safe) {
        yield* this.save(connection, state, (pending) =>
          pending.map((entry) =>
            entry.id === id ? { ...entry, reviewAfterRenewal: true } : entry,
          ),
        )
        return yield* Effect.fail(
          new Error(
            'The connection credential changed. Some saved actions may already have run. Review them before retrying.',
          ),
        )
      }
      yield* this.save(connection, state, (pending) =>
        pending.map((entry) => (entry.id === id ? { ...entry, receiptToken: token } : entry)),
      )
    }).pipe(
      Effect.mapError(
        (error) =>
          new RuntimeRequestError({ kind: 'request', message: error.message, cause: error }),
      ),
    )
  }
  private sendRaw(
    connection: RuntimeConnection,
    item: MutationOutbox[number],
    receiptId = item.id,
  ) {
    const send = createRuntimeClient(connection).requestEffect(
      item.path,
      item.input,
      Schema.Unknown,
      {
        method: item.method,
        mutationId: item.id,
        beforeMutation: (token) => this.bindReceipt(connection, receiptId, token),
      },
    )
    if (item.path !== '/api/tasks/queue') return send
    const state = this.state(connection)
    return this.supports(connection, state).pipe(
      Effect.flatMap(() =>
        state.queueMutations
          ? send
          : Effect.fail(
              new RuntimeRequestError({
                kind: 'response',
                status: 426,
                message: 'Update this runtime before recovering saved queue actions.',
              }),
            ),
      ),
    )
  }
  private acknowledge(connection: RuntimeConnection, state: State, id: string) {
    if (!state.acknowledgements) return Effect.void
    // Only after durable journal removal. Receipt compaction must not hold the mutation
    // queue or add a network round trip to the caller's foreground action. A lost
    // acknowledgement safely leaves the full receipt on the runtime.
    const cleanup = createRuntimeClient(connection)
      .requestEffect('/api/mutations/acknowledge', { ids: [id] }, Schema.Unknown)
      .pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      )
    return Effect.sync(() => {
      Effect.runFork(cleanup)
    })
  }
  private drain(
    connection: RuntimeConnection,
    state: State,
    retry = false,
    stopBefore?: string,
    allowBlockedCommands = false,
    onlyId?: string,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (!state.pending.length) return
      let blockedError: Error | undefined
      const skipped = new Set(state.confirmedTasks.map((item) => item.id))
      while (state.pending.length) {
        const item = state.pending.find(
          (entry) =>
            (!onlyId || entry.id === onlyId) &&
            !skipped.has(entry.id) &&
            (!blockedError || entry.path === '/api/workspace'),
        )
        if (!item || item.id === stopBefore) break
        if (attachmentUpload(item)) {
          skipped.add(item.id)
          continue
        }
        if (item.reviewAfterRenewal) {
          blockedError = new Error(
            'Computer access was renewed. Some saved actions may already have run. Review them before retrying.',
          )
          state.error = blockedError.message
          this.changed()
          skipped.add(item.id)
          continue
        }
        if (attachmentAck(item)) {
          yield* this.sendAttachmentAck(connection, state, item.id)
          continue
        }
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
        if (item.retainUntilCached) {
          skipped.add(item.id)
          continue
        }
        yield* this.save(connection, state, (pending) =>
          pending.filter((entry) => entry.id !== item.id),
        )
        yield* this.acknowledge(connection, state, item.id)
      }
      if (blockedError && !allowBlockedCommands) return yield* Effect.fail(blockedError)
      if (
        !state.pending.some(
          (item) =>
            !attachmentUpload(item) && !state.confirmedTasks.some((task) => task.id === item.id),
        )
      ) {
        state.error = state.pending.some(
          (item) => attachmentJournal(item) && !state.activeAttachments.has(item.id),
        )
          ? 'Saved attachments need review.'
          : null
        this.changed()
      }
    })
  }
  /** Without arguments this is an automatic recovery, as triggered by snapshots, polling and
   * app activation. Concurrent automatic calls share one attempt. After a transient failure,
   * automatic calls wait for a bounded backoff; one call during the backoff schedules a single
   * attempt when it ends. An explicit retry, renewal confirmation or selected action always
   * runs at once. */
  recoverEffect(
    connection: RuntimeConnection,
    retry = false,
    confirmRenewalReplay = false,
    actionId?: string,
  ) {
    const state = this.state(connection)
    const credential = accountCredential(connection)
    if (retry || confirmRenewalReplay || actionId !== undefined)
      return this.recoverNow(connection, state, retry, confirmRenewalReplay, actionId).pipe(
        this.settleAutomatic(state, credential),
      )
    return Effect.suspend(() => {
      const automatic = state.automatic.get(credential) ?? { failures: 0, retryAt: 0 }
      state.automatic.set(credential, automatic)
      if (!automatic.run && Date.now() < automatic.retryAt) {
        if (!automatic.wake && state.pending.length)
          automatic.wake = setTimeout(
            () => {
              automatic.wake = undefined
              void Effect.runPromise(Effect.result(this.recoverEffect(connection)))
            },
            Math.max(0, automatic.retryAt - Date.now()),
          )
        return Effect.void
      }
      // Detached so one interrupted caller cannot cancel the attempt that others joined.
      const run = (automatic.run ??= Effect.runPromise(
        Effect.result(
          this.recoverNow(connection, state).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                automatic.run = undefined
              }),
            ),
            this.settleAutomatic(state, credential),
          ),
        ),
      ))
      return Effect.promise(() => run).pipe(Effect.flatMap(Effect.fromResult))
    })
  }
  /** Success ends the backoff. Only a host or tunnel that answers but cannot accept the action
   * now (502-504, timeout, Connect lease) extends it: snapshots keep arriving in that state and
   * each would retry. A refused connection cannot coexist with fresh snapshots, so the next one
   * retries at once. Domain failures already block their action. A host without receipt support
   * is checked at once after an upgrade. Recoverable workspace errors also use backoff. */
  private settleAutomatic(state: State, credential: string) {
    return <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const automatic = state.automatic.get(credential)
            clearTimeout(automatic?.wake)
            if (automatic && !automatic.run) state.automatic.delete(credential)
            else if (automatic)
              Object.assign(automatic, { failures: 0, retryAt: 0, wake: undefined })
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (
              !(error instanceof RuntimeRequestError) ||
              error.kind === 'connection' ||
              !transientMutation(
                {
                  path:
                    state.supported && state.pending.some((item) => item.path === '/api/workspace')
                      ? '/api/workspace'
                      : '',
                },
                error,
              )
            )
              return
            const automatic = state.automatic.get(credential) ?? { failures: 0, retryAt: 0 }
            state.automatic.set(credential, automatic)
            automatic.failures++
            automatic.retryAt = Date.now() + automaticRetryDelay(automatic.failures)
          }),
        ),
      )
  }
  private recoverNow(
    connection: RuntimeConnection,
    state: State,
    retry = false,
    confirmRenewalReplay = false,
    actionId?: string,
  ) {
    return state.lock
      .withPermits(1)(
        Effect.gen({ self: this }, function* () {
          if (
            state.replaced ||
            (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
          )
            return
          yield* this.load(connection, state)
          if (actionId && !state.pending.some((item) => item.id === actionId)) return
          if (confirmRenewalReplay)
            yield* this.save(connection, state, (pending) =>
              pending.map((item) =>
                item.reviewAfterRenewal &&
                (!actionId || item.id === actionId) &&
                !attachmentJournal(item)
                  ? { ...item, reviewAfterRenewal: undefined, receiptToken: undefined }
                  : item,
              ),
            )
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
          yield* this.drain(connection, state, retry, undefined, false, actionId)
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
  discardEffect(connection: RuntimeConnection, actionId?: string) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      state.admission.withPermits(1)(
        Effect.gen({ self: this }, function* () {
          if (
            state.replaced ||
            (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
          )
            return yield* Effect.fail(
              new Error(
                'Computer connection changed. Review its saved actions before discarding them.',
              ),
            )
          const loaded = yield* Effect.result(this.load(connection, state))
          if (actionId) {
            if (loaded._tag === 'Failure') return yield* Effect.fail(loaded.failure)
            yield* this.save(connection, state, (pending) =>
              pending.filter((item) => item.id !== actionId || attachmentJournal(item)),
            )
            state.confirmedMessages = state.confirmedMessages.filter((item) => item.id !== actionId)
            state.confirmedTasks = state.confirmedTasks.filter((item) => item.id !== actionId)
          } else if (loaded._tag === 'Success' && state.pending.some(attachmentJournal))
            yield* this.save(connection, state, (pending) => pending.filter(attachmentJournal))
          else {
            yield* state.journal.withPermits(1)(
              operation(() => this.storage.clear(connection)).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    state.pending = []
                  }),
                ),
              ),
            )
          }
          if (!actionId) {
            state.confirmedMessages = []
            state.confirmedTasks = []
          }
          state.error = state.pending.length ? 'Saved attachments need review.' : null
          this.changed()
        }).pipe(Effect.uninterruptible),
      ),
    )
  }
  assertEmptyEffect(connection: RuntimeConnection) {
    const state = this.state(connection)
    return state.lock.withPermits(1)(
      state.admission.withPermits(1)(
        Effect.gen({ self: this }, function* () {
          if (
            state.replaced ||
            (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
          )
            return yield* Effect.fail(
              new Error(
                'Computer connection changed. Review its saved actions before forgetting it.',
              ),
            )
          yield* this.load(connection, state)
          if (state.pending.length) {
            const error =
              'This computer has saved actions waiting to sync. Retry or discard them before forgetting it.'
            if (state.error !== error) {
              state.error = error
              this.changed()
            }
            return yield* Effect.fail(new Error(state.error))
          }
        }),
      ),
    )
  }
  /** Preserve the journal before publishing a verified replacement credential. Copying first
   * leaves the source intact on failure; IDs make an interrupted handoff safe to repeat.
   * Only task submissions have domain-level deduplication across device credentials. */
  renewConnectionEffect<E>(
    previous: RuntimeConnection,
    next: RuntimeConnection,
    commit: Effect.Effect<void, E>,
  ) {
    if (
      connectionKey(previous) === connectionKey(next) &&
      accountCredential(previous) === accountCredential(next)
    )
      return commit
    const source = this.state(previous),
      destination = this.state(next)
    const states =
      connectionKey(previous) < connectionKey(next) ? [source, destination] : [destination, source]
    const transfer = Effect.gen({ self: this }, function* () {
      if (
        !previous.runtimeId ||
        previous.runtimeId !== next.runtimeId ||
        !(previous.accountSession ?? next.internet?.session) ||
        (previous.accountSession ?? previous.internet?.session ?? next.internet?.session) !==
          (next.accountSession ?? next.internet?.session)
      )
        return yield* Effect.fail(
          new Error('Cannot move saved actions to a different computer or account'),
        )
      if (
        source.replaced ||
        (source.renewedCredential && source.renewedCredential !== accountCredential(previous))
      )
        return yield* Effect.fail(new Error('Computer connection already changed'))
      yield* this.load(previous, source)
      const pending = source.pending.map((item) => {
        const input = item.input
        const safe =
          (item.path === '/api/tasks/message' || item.path === '/api/tasks/steer') &&
          input !== null &&
          typeof input === 'object' &&
          'messageId' in input &&
          typeof input.messageId === 'string' &&
          !!input.messageId
        return safe ? { ...item, blocked: undefined } : { ...item, reviewAfterRenewal: true }
      })
      yield* this.save(next, destination, (saved) => {
        const result = [...saved]
        for (const item of pending) {
          const existing = result.find((entry) => entry.id === item.id)
          if (
            existing &&
            (existing.path !== item.path ||
              existing.method !== item.method ||
              JSON.stringify(existing.input) !== JSON.stringify(item.input))
          )
            throw new Error('Saved action identity conflict. Original actions were preserved.')
          if (!existing) result.push(item)
          else result[result.indexOf(existing)] = { ...existing, ...item }
        }
        return result
      })
      if (
        source !== destination &&
        this.storage.workspaceRecoveries &&
        this.storage.recoverWorkspaceEdit
      ) {
        const edits = yield* operation(() => this.storage.workspaceRecoveries!(previous))
        for (const edit of edits)
          yield* operation(() => this.storage.recoverWorkspaceEdit!(next, edit))
      }
      yield* commit
      destination.renewedCredential = accountCredential(next)
      source.replaced = source !== destination
      // The replacement already owns a durable copy. A failed cleanup must not undo it.
      if (source !== destination) yield* this.discardTransferredSource(previous, source)
      destination.error = pending.some((item) => item.reviewAfterRenewal)
        ? 'Computer access was renewed. Review saved actions before retrying; some may already have run.'
        : null
      this.changed()
    }).pipe(Effect.uninterruptible)
    return source === destination
      ? source.lock.withPermits(1)(source.admission.withPermits(1)(transfer))
      : states[0]!.lock.withPermits(1)(
          states[1]!.lock.withPermits(1)(
            states[0]!.admission.withPermits(1)(states[1]!.admission.withPermits(1)(transfer)),
          ),
        )
  }
  private discardTransferredSource(connection: RuntimeConnection, state: State) {
    return state.journal.withPermits(1)(
      operation(() => this.storage.clear(connection)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            state.pending = []
            state.confirmedMessages = []
            state.confirmedTasks = []
            state.error = null
          }),
        ),
        // Old credentials are no longer selected. Keep their journal if cleanup is unavailable.
        Effect.catch(() => Effect.void),
      ),
    )
  }
  requestEffect<T extends Schema.Codec<unknown, unknown>>(
    connection: RuntimeConnection,
    path: string,
    input: unknown,
    schema: T,
    method = 'POST',
  ) {
    // Stop controls a specific execution attempt. It must remain available while
    // unrelated edits or commands are blocked, and must never wait behind their sender.
    // Keep the server receipt and frozen run token, without queuing a delayed Stop.
    if (method === 'POST' && path === '/api/tasks/cancel') {
      const state = this.state(connection)
      if (
        state.replaced ||
        (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
      )
        return Effect.fail(new Error('Computer access changed. Try this action again.'))
      return createRuntimeClient(connection).requestEffect(path, input, schema, {
        method,
        mutationId: bytesToHex(sha256(utf8ToBytes(JSON.stringify({ path, input })))),
      })
    }
    if (method === 'GET' && path === '/api/workspace/recovered-edits')
      return this.workspaceRecoveriesEffect(connection).pipe(
        Effect.map((value) => decode(schema, value)),
      )
    const queueAction =
      path === '/api/tasks/queue' ? decodeResult(queueActionSchema, input) : undefined
    // Relative actions, steering and draft restores retain their existing foreground flow.
    const durableQueueAction =
      queueAction?.success && ['duplicate', 'move'].includes(queueAction.data.action)
    if (!recoverableMutation(path, method) || (path === '/api/tasks/queue' && !durableQueueAction))
      return createRuntimeClient(connection).requestEffect(path, input, schema, { method })
    const state = this.state(connection)
    return state.lock
      .withPermits(1)(
        Effect.gen({ self: this }, function* () {
          if (
            state.replaced ||
            (state.renewedCredential && state.renewedCredential !== accountCredential(connection))
          )
            return yield* Effect.fail(new Error('Computer access changed. Try this action again.'))
          yield* this.load(connection, state)
          if (path === '/api/tasks/queue') {
            yield* this.supports(connection, state)
            // Older hosts cannot receipt queue commands. Keep their foreground controls usable.
            if (!state.queueMutations && !state.pending.some((entry) => entry.path === path))
              return yield* createRuntimeClient(connection).requestEffect(path, input, schema, {
                method,
              })
          }
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
          let item = state.pending.find((entry) => {
            if (entry.path !== path || entry.method !== method) return false
            if (JSON.stringify(entry.input) === JSON.stringify(input)) return true
            // A remounted queue row creates a new candidate copy ID. An unresolved duplicate
            // is a retry of the original intent, so keep its durable copy and receipt IDs.
            if (
              path !== '/api/tasks/queue' ||
              !queueAction?.success ||
              queueAction.data.action !== 'duplicate'
            )
              return false
            const previous = decodeResult(queueActionSchema, entry.input)
            return (
              previous.success &&
              previous.data.action === 'duplicate' &&
              previous.data.id === queueAction.data.id &&
              previous.data.messageId === queueAction.data.messageId
            )
          })
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
            try: () =>
              decode(
                schema,
                path === '/api/tasks/queue' &&
                  !created &&
                  typeof result.success === 'object' &&
                  result.success !== null
                  ? { ...result.success, recovered: true }
                  : result.success,
              ),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
          this.retainMessage(state, command)
          if (!command.retainUntilCached) {
            yield* this.save(connection, state, (pending) =>
              pending.filter((entry) => entry.id !== command.id),
            )
            yield* this.acknowledge(connection, state, command.id)
          }
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
