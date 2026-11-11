import { Effect, Schema } from 'effect'
import { decodeResult, maxValue, minValue, mutableStruct, refine } from '../shared/schema.js'
import { attachmentIdsSchema } from '../shared/attachments.js'
import { taskSchema, turnSettingsSchema, type Task } from '../workspace.js'

const id = maxValue(minValue(Schema.String, 1), 200)
/** The configuration an unsent draft may carry into a new thread. Every other task field is
 * runtime-owned (queue, history, run, provider, session, recovery, replica and lock state),
 * so a thread start cannot inject it. Clients with other fields create the thread first. */
const threadStartFields = new Set<string>([
  'id',
  'title',
  'status',
  'createdAt',
  'messages',
  'files',
  'draft',
  'example',
  'origin',
  'repositoryId',
  'agentId',
  'agentName',
  'agentIcon',
  'harness',
  'harnessCustomized',
  'agentOverrides',
  'modelSelection',
  'modelSelectionDifficulty',
  'autoProject',
  'autoProjectExecution',
  'draftTurnSettings',
  'draftPlan',
  'execution',
  'existingWorktreePath',
  'worktreeBaseBranch',
  'worktreeFromOrigin',
  'worktreeIncludeChanges',
  'checkoutBranch',
  'setupCommand',
  'submodules',
  'linkedCheckouts',
  'settleBehavior',
  'archiveAfterSettledDays',
  'pinned',
] satisfies (keyof Task)[])
const startsCleanDraft = (task: Task) =>
  task.status === 'draft' &&
  !task.example &&
  !task.messages.length &&
  !task.files.length &&
  Object.entries(task).every(([key, value]) => value === undefined || threadStartFields.has(key))
/** One durable submission, including first-message setup on runtimes that advertise it. */
export const taskMessageSchema = refine(
  refine(
    mutableStruct({
      id,
      messageId: id,
      text: maxValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 120000),
      attachmentIds: attachmentIdsSchema.pipe(
        Schema.withDecodingDefaultType(Effect.sync(() => [])),
      ),
      turnSettings: Schema.optional(turnSettingsSchema),
      review: Schema.optional(Schema.Boolean),
      plan: Schema.optional(Schema.Boolean),
      queueOnly: Schema.optional(Schema.Boolean),
      preserveQueuePause: Schema.optional(Schema.Boolean),
      sendNow: Schema.optional(Schema.Boolean),
      runId: Schema.optional(id),
      selectProject: Schema.optional(Schema.Boolean),
      initialTitle: Schema.optional(
        mutableStruct({
          before: Schema.String,
          after: maxValue(minValue(Schema.String, 1), 80),
        }),
      ),
      /** The unsent local draft this message starts, on runtimes with `threadStartSupported`.
       * Attachments upload to an existing thread, so their drafts are still created first. */
      createTask: Schema.optional(taskSchema),
    }),
    (input) => !!input.text || !!input.attachmentIds.length,
    'Add a message or attachment',
  ),
  (input) =>
    !input.createTask ||
    (input.createTask.id === input.id &&
      startsCleanDraft(input.createTask) &&
      !input.attachmentIds.length &&
      !input.runId &&
      !input.sendNow),
  'Only a new draft without attachments or runtime state can start with this message',
)

/** The acknowledgement of a message with `createTask`. Durable local admission returns only
 * `pending`. A runtime acknowledgement adds its cursor: a snapshot from the same
 * `runtimeInstanceId` at `revision` or later contains the thread and message, unless the
 * thread was deleted later. A runtime never recreates a deleted thread. */
export const threadStartResultSchema = mutableStruct({
  ok: Schema.Boolean,
  pending: Schema.optional(Schema.Boolean),
  revision: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
  runtimeInstanceId: Schema.optional(Schema.String),
})

/** Add an unsent local draft to its first message on runtimes with `threadStartSupported`.
 * The message text replaces the draft, so the created thread starts with an empty composer.
 * Returns undefined when the message cannot start the thread, for example with attachments. */
export function threadStartMessage(input: unknown, task: Task) {
  if (input === null || typeof input !== 'object') return undefined
  const createTask: Task = { ...task, draft: '' }
  const message = decodeResult(taskMessageSchema, { ...input, createTask })
  return message.success ? { ...input, createTask } : undefined
}
