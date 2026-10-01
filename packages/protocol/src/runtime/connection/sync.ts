import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
import { messageSchema, taskSchema, workspaceSchema, type Workspace } from '../../workspace.js'
import { snapshotSchema, type RuntimeSnapshot } from './runtime.js'
import { activitySchema } from '../../automation/activity.js'
const order = mutableArray(Schema.String)
const messagesSchema = mutableStruct({
  order,
  changes: mutableArray(
    mutableStruct({
      fields: messageSchema.omit('text'),
      text: Schema.Union(
        Schema.String,
        mutableStruct({
          length: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          append: Schema.String,
        }),
      ),
    }),
  ),
})
export const snapshotDeltaSchema = mutableStruct({
  state: snapshotSchema.omit('workspace'),
  workspace: mutableStruct({
    metadata: workspaceSchema.omit('tasks', 'agents', 'repositories', 'automations'),
    agents: Schema.optional(workspaceSchema.fields.agents),
    repositories: Schema.optional(workspaceSchema.fields.repositories),
    automations: Schema.optional(workspaceSchema.fields.automations),
    tasks: Schema.optional(
      mutableStruct({
        order,
        changes: mutableArray(
          mutableStruct({
            id: Schema.String,
            fields: Schema.optional(taskSchema.omit('messages')),
            messages: Schema.optional(messagesSchema),
          }),
        ),
      }),
    ),
  }),
})
const cursor = {
  epoch: Schema.String,
  sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
}
export const syncFrameSchema = Schema.Union(
  mutableStruct({
    type: Schema.Literal('snapshot'),
    ...cursor,
    tag: Schema.String,
    snapshot: snapshotSchema,
  }),
  mutableStruct({
    type: Schema.Literal('delta'),
    ...cursor,
    tag: Schema.String,
    base: Schema.Number,
    delta: snapshotDeltaSchema,
  }),
  mutableStruct({
    type: Schema.Literal('activity'),
    scope: Schema.String,
    order,
    events: activitySchema.fields.events,
  }),
  mutableStruct({ type: Schema.Literal('heartbeat'), ...cursor }),
)
export const syncInputSchema = Schema.Union(
  mutableStruct({
    type: Schema.Literal('resume'),
    epoch: Schema.optional(Schema.String),
    sequence: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
  mutableStruct({
    type: Schema.Literal('watch'),
    scopes: mutableArray(Schema.String.pipe(Schema.maxLength(200))).pipe(Schema.maxItems(8)),
  }),
)
export const syncTicketSchema = mutableStruct({ ticket: Schema.String })
export type SyncFrame = Schema.Schema.Type<typeof syncFrameSchema>
export type SnapshotDelta = Schema.Schema.Type<typeof snapshotDeltaSchema>
const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
export function snapshotDelta(previous: RuntimeSnapshot, next: RuntimeSnapshot): SnapshotDelta {
  const { workspace, ...state } = next
  const { tasks, agents, repositories, automations, ...metadata } = workspace
  const old = new Map(previous.workspace.tasks.map((task) => [task.id, task]))
  const changes: NonNullable<SnapshotDelta['workspace']['tasks']>['changes'] = []
  for (const task of tasks) {
    const before = old.get(task.id)
    if (before === task) continue
    const { messages, ...fields } = task
    const { messages: oldMessages, ...oldFields } = before ?? { messages: [] }
    const fieldsChanged = !before || !equal(fields, oldFields)
    const messageChanges: Schema.Schema.Type<typeof messagesSchema>['changes'] = []
    const oldById = new Map(oldMessages.map((message) => [message.id, message]))
    for (const message of messages) {
      const last = oldById.get(message.id)
      if (last === message) continue
      const { text, ...messageFields } = message
      const { text: oldText, ...oldMessageFields } = last ?? { text: undefined }
      if (last && text === oldText && equal(messageFields, oldMessageFields)) continue
      messageChanges.push({
        fields: messageFields,
        text:
          last && text.startsWith(last.text)
            ? { length: last.text.length, append: text.slice(last.text.length) }
            : text,
      })
    }
    const messagesChanged =
      messageChanges.length > 0 ||
      !equal(
        oldMessages.map((message) => message.id),
        messages.map((message) => message.id),
      )
    if (fieldsChanged || messagesChanged)
      changes.push({
        id: task.id,
        ...(fieldsChanged ? { fields } : {}),
        ...(messagesChanged
          ? { messages: { order: messages.map((message) => message.id), changes: messageChanges } }
          : {}),
      })
  }
  return {
    state,
    workspace: {
      metadata,
      ...(!equal(previous.workspace.agents, agents) ? { agents } : {}),
      ...(!equal(previous.workspace.repositories, repositories) ? { repositories } : {}),
      ...(!equal(previous.workspace.automations, automations) ? { automations } : {}),
      ...(changes.length ||
      !equal(
        previous.workspace.tasks.map((task) => task.id),
        tasks.map((task) => task.id),
      )
        ? { tasks: { order: tasks.map((task) => task.id), changes } }
        : {}),
    },
  }
}
export function applySnapshotDelta(
  previous: RuntimeSnapshot,
  delta: SnapshotDelta,
): RuntimeSnapshot {
  const tasks = new Map(previous.workspace.tasks.map((task) => [task.id, task]))
  for (const change of delta.workspace.tasks?.changes ?? []) {
    const before = tasks.get(change.id)
    const fields = change.fields ?? before
    if (!fields || fields.id !== change.id) throw new Error('Sync task baseline is missing')
    const messages = new Map(before?.messages.map((message) => [message.id, message]) ?? [])
    for (const message of change.messages?.changes ?? []) {
      const old = messages.get(message.fields.id)
      if (typeof message.text !== 'string' && (!old || old.text.length !== message.text.length))
        throw new Error('Sync text baseline does not match')
      const text =
        typeof message.text === 'string' ? message.text : (old?.text ?? '') + message.text.append
      messages.set(message.fields.id, { ...message.fields, text })
    }
    const ordered =
      change.messages?.order.map((id) => {
        const message = messages.get(id)
        if (!message) throw new Error('Sync message baseline is missing')
        return message
      }) ??
      before?.messages ??
      []
    tasks.set(change.id, { ...fields, messages: ordered })
  }
  const workspace: Workspace = {
    ...delta.workspace.metadata,
    agents: delta.workspace.agents ?? previous.workspace.agents,
    repositories: delta.workspace.repositories ?? previous.workspace.repositories,
    automations: delta.workspace.automations ?? previous.workspace.automations,
    tasks:
      delta.workspace.tasks?.order.map((id) => {
        const task = tasks.get(id)
        if (!task) throw new Error('Sync task baseline is missing')
        return task
      }) ?? previous.workspace.tasks,
  }
  return { ...delta.state, workspace }
}
