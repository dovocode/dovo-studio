import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
import {
  messageSchema,
  taskSchema,
  workspaceSchema,
  type Workspace,
  type Task,
} from '../../workspace.js'
import { snapshotSchema, type RuntimeSnapshot } from './runtime.js'
import { activitySchema, activityEventSchema } from '../../automation/activity.js'
const order = mutableArray(Schema.String)
const messagesSchema = mutableStruct({
  order: Schema.optional(order),
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
  revision: Schema.optional(snapshotSchema.fields.revision),
  state: Schema.optional(snapshotSchema.omit('workspace')),
  workspace: mutableStruct({
    metadata: Schema.optional(
      workspaceSchema.omit('tasks', 'agents', 'repositories', 'automations'),
    ),
    agents: Schema.optional(workspaceSchema.fields.agents),
    repositories: Schema.optional(workspaceSchema.fields.repositories),
    automations: Schema.optional(workspaceSchema.fields.automations),
    tasks: Schema.optional(
      mutableStruct({
        order: Schema.optional(order),
        changes: mutableArray(
          mutableStruct({
            id: Schema.String,
            updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
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
export const activityDeltaSchema = mutableStruct({
  order: Schema.optional(order),
  changes: mutableArray(
    mutableStruct({
      fields: activityEventSchema.omit('payload'),
      payload: Schema.Union(
        Schema.String,
        mutableStruct({
          length: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          offset: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          remove: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          insert: Schema.String,
        }),
      ),
    }),
  ),
})
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
  mutableStruct({
    type: Schema.Literal('activity-delta'),
    scope: Schema.String,
    delta: activityDeltaSchema,
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
const taskMetadata = ({ messages: _messages, updatedAt: _updatedAt, ...metadata }: Task) => metadata
const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
const stateMetadata = ({ revision: _revision, ...metadata }: Omit<RuntimeSnapshot, 'workspace'>) =>
  metadata
export function snapshotDelta(
  previous: RuntimeSnapshot,
  next: RuntimeSnapshot,
  compact = false,
): SnapshotDelta {
  const { workspace, ...state } = next
  const { tasks, agents, repositories, automations, ...metadata } = workspace
  const old = new Map(previous.workspace.tasks.map((task) => [task.id, task]))
  const changes: NonNullable<SnapshotDelta['workspace']['tasks']>['changes'] = []
  for (const task of tasks) {
    const before = old.get(task.id)
    if (before === task) continue
    const { messages, ...fields } = task
    const { messages: oldMessages, ...oldFields } = before ?? { messages: [] }
    const fieldsChanged =
      !before ||
      (compact ? !equal(taskMetadata(task), taskMetadata(before)) : !equal(fields, oldFields))
    const updatedAtChanged =
      compact && before && !fieldsChanged && task.updatedAt !== before.updatedAt
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
    const messageOrderChanged = !equal(
      oldMessages.map((message) => message.id),
      messages.map((message) => message.id),
    )
    const messagesChanged =
      messageChanges.length > 0 ||
      !equal(
        oldMessages.map((message) => message.id),
        messages.map((message) => message.id),
      )
    if (fieldsChanged || messagesChanged || updatedAtChanged)
      changes.push({
        id: task.id,
        ...(updatedAtChanged ? { updatedAt: task.updatedAt ?? null } : {}),
        ...(fieldsChanged ? { fields } : {}),
        ...(messagesChanged
          ? {
              messages: {
                ...(!compact || messageOrderChanged
                  ? { order: messages.map((message) => message.id) }
                  : {}),
                changes: messageChanges,
              },
            }
          : {}),
      })
  }
  const { workspace: previousWorkspace, ...oldState } = previous
  const {
    tasks: _tasks,
    agents: _agents,
    repositories: _repositories,
    automations: _automations,
    ...oldMetadata
  } = previousWorkspace
  const taskOrderChanged = !equal(
    previous.workspace.tasks.map((task) => task.id),
    tasks.map((task) => task.id),
  )
  return {
    ...(!compact || !equal(stateMetadata(state), stateMetadata(oldState)) ? { state } : {}),
    ...(compact && state.revision !== oldState.revision ? { revision: state.revision } : {}),
    workspace: {
      ...(!compact || !equal(metadata, oldMetadata) ? { metadata } : {}),
      ...(!equal(previous.workspace.agents, agents) ? { agents } : {}),
      ...(!equal(previous.workspace.repositories, repositories) ? { repositories } : {}),
      ...(!equal(previous.workspace.automations, automations) ? { automations } : {}),
      ...(changes.length ||
      !equal(
        previous.workspace.tasks.map((task) => task.id),
        tasks.map((task) => task.id),
      )
        ? {
            tasks: {
              ...(!compact || taskOrderChanged ? { order: tasks.map((task) => task.id) } : {}),
              changes,
            },
          }
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
      change.messages?.order?.map((id) => {
        const message = messages.get(id)
        if (!message) throw new Error('Sync message baseline is missing')
        return message
      }) ??
      (change.messages
        ? before?.messages.map((message) => messages.get(message.id)!)
        : before?.messages) ??
      []
    tasks.set(change.id, {
      ...fields,
      ...(change.updatedAt !== undefined ? { updatedAt: change.updatedAt ?? undefined } : {}),
      messages: ordered,
    })
  }
  const workspace: Workspace = {
    ...(delta.workspace.metadata ?? previous.workspace),
    agents: delta.workspace.agents ?? previous.workspace.agents,
    repositories: delta.workspace.repositories ?? previous.workspace.repositories,
    automations: delta.workspace.automations ?? previous.workspace.automations,
    tasks:
      delta.workspace.tasks?.order?.map((id) => {
        const task = tasks.get(id)
        if (!task) throw new Error('Sync task baseline is missing')
        return task
      }) ??
      (delta.workspace.tasks
        ? previous.workspace.tasks.map((task) => tasks.get(task.id)!)
        : previous.workspace.tasks),
  }
  return {
    ...(delta.state ?? previous),
    revision: delta.revision ?? delta.state?.revision ?? previous.revision,
    workspace,
  }
}

type ActivityEvent = Schema.Schema.Type<typeof activityEventSchema>
export function activityDelta(
  previous: ActivityEvent[],
  next: ActivityEvent[],
): Schema.Schema.Type<typeof activityDeltaSchema> {
  const old = new Map(previous.map((event) => [event.id, event]))
  const changes: Schema.Schema.Type<typeof activityDeltaSchema>['changes'] = []
  for (const event of next) {
    const before = old.get(event.id)
    const { payload, ...fields } = event
    const { payload: oldPayload, ...oldFields } = before ?? { payload: '' }
    if (before && payload === oldPayload && equal(fields, oldFields)) continue
    let update: (typeof changes)[number]['payload'] = payload
    if (before && payload !== oldPayload) {
      let offset = 0,
        suffix = 0
      while (
        offset < Math.min(payload.length, oldPayload.length) &&
        payload[offset] === oldPayload[offset]
      )
        offset++
      while (
        suffix < Math.min(payload.length, oldPayload.length) - offset &&
        payload[payload.length - 1 - suffix] === oldPayload[oldPayload.length - 1 - suffix]
      )
        suffix++
      const insert = payload.slice(offset, payload.length - suffix)
      if (insert.length + 80 < payload.length)
        update = {
          length: oldPayload.length,
          offset,
          remove: oldPayload.length - offset - suffix,
          insert,
        }
    }
    changes.push({ fields, payload: update })
  }
  return {
    ...(!equal(
      previous.map((event) => event.id),
      next.map((event) => event.id),
    )
      ? { order: next.map((event) => event.id) }
      : {}),
    changes,
  }
}
export function applyActivityDelta(
  previous: ActivityEvent[],
  delta: Schema.Schema.Type<typeof activityDeltaSchema>,
  scope: string,
): ActivityEvent[] {
  const events = new Map(previous.map((event) => [event.id, event]))
  for (const change of delta.changes) {
    const old = events.get(change.fields.id)?.payload
    const patch = change.payload
    if (
      typeof patch !== 'string' &&
      (old === undefined || old.length !== patch.length || patch.offset + patch.remove > old.length)
    )
      throw new Error('Activity payload baseline does not match')
    const payload =
      typeof patch === 'string'
        ? patch
        : old!.slice(0, patch.offset) + patch.insert + old!.slice(patch.offset + patch.remove)
    events.set(change.fields.id, { ...change.fields, payload })
  }
  return (delta.order ?? previous.map((event) => event.id)).map((id) => {
    const event = events.get(id)
    if (!event || event.scope !== scope) throw new Error('Activity baseline is missing')
    return event
  })
}
