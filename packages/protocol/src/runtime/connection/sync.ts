import { Schema, Struct } from 'effect'
import { decode, mutableArray, mutableStruct } from '../../shared/schema.js'
import {
  messageSchema,
  taskSchema,
  turnSchema,
  workspaceSchema,
  type Workspace,
  type Task,
} from '../../workspace.js'
import { snapshotSchema, type RuntimeSnapshot } from './runtime.js'
import { activitySchema, activityEventSchema } from '../../automation/activity.js'
const order = mutableArray(Schema.String)
const stateFieldsSchema = snapshotSchema.mapFields(Struct.omit(['workspace', 'revision']))
const stateFieldDeltaSchema = mutableStruct({
  values: stateFieldsSchema.mapFields(Struct.map(Schema.optional)),
  removed: mutableArray(Schema.Literals(Object.keys(stateFieldsSchema.fields))),
})
const turnFieldsSchema = turnSchema.mapFields(Struct.omit(['id']))
const turnFieldDeltaSchema = mutableStruct({
  values: turnFieldsSchema.mapFields(Struct.map(Schema.optional)),
  removed: mutableArray(Schema.Literals(Object.keys(turnFieldsSchema.fields))),
})
const turnsDeltaSchema = mutableStruct({
  order: Schema.optional(order),
  changes: mutableArray(
    mutableStruct({
      id: Schema.String,
      fields: Schema.optional(turnSchema),
      fieldDelta: Schema.optional(turnFieldDeltaSchema),
    }),
  ),
})
const taskFieldsSchema = taskSchema.mapFields(Struct.omit(['messages']))
const taskUpdatesSchema = taskFieldsSchema
  .mapFields(Struct.omit(['id']))
  .mapFields(Struct.map(Schema.optional))
const taskFieldDeltaSchema = mutableStruct({
  values: taskUpdatesSchema,
  removed: mutableArray(
    Schema.Literals(Object.keys(taskFieldsSchema.mapFields(Struct.omit(['id'])).fields)),
  ),
})
const assertTaskFields: (
  input: unknown,
) => asserts input is Schema.Schema.Type<typeof taskFieldsSchema> = (input) =>
  Schema.asserts(taskFieldsSchema, input)
const assertTurn: (input: unknown) => asserts input is Schema.Schema.Type<typeof turnSchema> = (
  input,
) => Schema.asserts(turnSchema, input)
const assertStateFields: (
  input: unknown,
) => asserts input is Schema.Schema.Type<typeof stateFieldsSchema> = (input) =>
  Schema.asserts(stateFieldsSchema, input)
function patchFields<T>(
  previous: object,
  delta: { values: object; removed: readonly string[] },
  assert: (input: unknown) => asserts input is T,
): T {
  const removed = new Set(delta.removed)
  const fields = Object.fromEntries(
    Object.entries({ ...previous, ...delta.values }).filter(([key]) => !removed.has(key)),
  )
  // Validate without decoding/copying unchanged arrays, preserving render identities.
  assert(fields)
  return fields
}
function applyTaskFields(before: Task, delta: Schema.Schema.Type<typeof taskFieldDeltaSchema>) {
  const { messages: _messages, ...previous } = before
  return patchFields(previous, delta, assertTaskFields)
}
const messagesSchema = mutableStruct({
  order: Schema.optional(order),
  changes: mutableArray(
    mutableStruct({
      fields: messageSchema.mapFields(Struct.omit(['text'])),
      text: Schema.Union([
        Schema.String,
        mutableStruct({
          length: Schema.Number.pipe(
            Schema.check(Schema.isInt()),
            Schema.check(Schema.isGreaterThanOrEqualTo(0)),
          ),
          append: Schema.String,
        }),
      ]),
    }),
  ),
})
export const snapshotDeltaSchema = mutableStruct({
  revision: Schema.optional(snapshotSchema.fields.revision),
  state: Schema.optional(snapshotSchema.mapFields(Struct.omit(['workspace']))),
  stateDelta: Schema.optional(stateFieldDeltaSchema),
  workspace: mutableStruct({
    metadata: Schema.optional(
      workspaceSchema.mapFields(Struct.omit(['tasks', 'agents', 'repositories', 'automations'])),
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
            fields: Schema.optional(taskSchema.mapFields(Struct.omit(['messages']))),
            fieldDelta: Schema.optional(taskFieldDeltaSchema),
            turns: Schema.optional(turnsDeltaSchema),
            messages: Schema.optional(messagesSchema),
          }),
        ),
      }),
    ),
  }),
})
const cursor = {
  epoch: Schema.String,
  sequence: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
}
export const activityDeltaSchema = mutableStruct({
  order: Schema.optional(order),
  changes: mutableArray(
    mutableStruct({
      fields: activityEventSchema.mapFields(Struct.omit(['payload'])),
      payload: Schema.Union([
        Schema.String,
        mutableStruct({
          length: Schema.Number.pipe(
            Schema.check(Schema.isInt()),
            Schema.check(Schema.isGreaterThanOrEqualTo(0)),
          ),
          offset: Schema.Number.pipe(
            Schema.check(Schema.isInt()),
            Schema.check(Schema.isGreaterThanOrEqualTo(0)),
          ),
          remove: Schema.Number.pipe(
            Schema.check(Schema.isInt()),
            Schema.check(Schema.isGreaterThanOrEqualTo(0)),
          ),
          insert: Schema.String,
        }),
      ]),
    }),
  ),
})
// Name the payload codecs so declaration emit does not expand the whole workspace schema
// again inside each frame variant. Their decoded and encoded types remain checked here.
const syncSnapshotSchema: Schema.Codec<RuntimeSnapshot, (typeof snapshotSchema)['Encoded']> =
  snapshotSchema
const syncDeltaSchema: Schema.Codec<SnapshotDelta, (typeof snapshotDeltaSchema)['Encoded']> =
  snapshotDeltaSchema
export const syncFrameSchema = Schema.Union([
  mutableStruct({ type: Schema.Literal('watch-ack'), watchId: cursor.sequence }),
  mutableStruct({
    type: Schema.Literal('snapshot'),
    ...cursor,
    tag: Schema.String,
    snapshot: syncSnapshotSchema,
  }),
  mutableStruct({
    type: Schema.Literal('delta'),
    ...cursor,
    tag: Schema.String,
    base: Schema.Number,
    delta: syncDeltaSchema,
  }),
  // Opt-in handoff between scoped views. The predecessor belongs to the old
  // view; the destination cursor can have a different epoch and sequence.
  mutableStruct({
    type: Schema.Literal('selection'),
    ...cursor,
    previousEpoch: Schema.String,
    base: Schema.Number,
    tag: Schema.String,
    delta: syncDeltaSchema,
  }),
  // A format-6 client retained this exact scoped snapshot. Select it before replay.
  mutableStruct({ type: Schema.Literal('selection-resume'), ...cursor, through: cursor.sequence }),
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
])
export const syncInputSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('resume'),
    epoch: Schema.optional(Schema.String),
    sequence: Schema.optional(
      Schema.Number.pipe(
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      ),
    ),
  }),
  mutableStruct({
    type: Schema.Literal('watch'),
    watchId: Schema.optional(cursor.sequence),
    selectionDelta: Schema.optional(Schema.Literal(true)),
    resume: Schema.optional(mutableStruct(cursor)),
    tasks: Schema.optional(
      mutableArray(Schema.String.pipe(Schema.check(Schema.isMaxLength(200)))).pipe(
        Schema.check(Schema.isMaxLength(8)),
      ),
    ),
    scopes: mutableArray(Schema.String.pipe(Schema.check(Schema.isMaxLength(200)))).pipe(
      Schema.check(Schema.isMaxLength(8)),
    ),
    detailScopes: Schema.optional(
      mutableArray(Schema.String.pipe(Schema.check(Schema.isMaxLength(200)))).pipe(
        Schema.check(Schema.isMaxLength(8)),
      ),
    ),
  }),
])
export const syncTicketSchema = mutableStruct({
  ticket: Schema.String,
  format: Schema.optional(Schema.Number),
})
export type SyncFrame = Schema.Schema.Type<typeof syncFrameSchema>
export type SnapshotDelta = Schema.Schema.Type<typeof snapshotDeltaSchema>
function taskMetadata(
  { messages: _messages, updatedAt, turns, ...metadata }: Task,
  compact: boolean,
  incremental: boolean,
) {
  return {
    ...metadata,
    ...(!compact ? { updatedAt } : {}),
    ...(!incremental ? { turns } : {}),
  }
}
function equalArrayItems(a: readonly unknown[], b: readonly unknown[]) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
  return true
}
const equal = (a: unknown, b: unknown) =>
  a === b ||
  (Array.isArray(a) && Array.isArray(b) && equalArrayItems(a, b)) ||
  JSON.stringify(a) === JSON.stringify(b)
// Streaming replaces a task, but usually shares its files, turns and other large fields.
// Compare those references before serializing any changed field. Undefined and missing
// properties are equivalent on the wire, just as they are with JSON.stringify.
function equalFields(a: object, b: object) {
  const entries: [string, unknown][] = Object.entries(a).filter(([, value]) => value !== undefined)
  return (
    entries.length === Object.values(b).filter((value) => value !== undefined).length &&
    entries.every(([key, value]) => Object.hasOwn(b, key) && equal(value, Reflect.get(b, key)))
  )
}
const stateMetadata = ({ revision: _revision, ...metadata }: Omit<RuntimeSnapshot, 'workspace'>) =>
  metadata
function changedFields(previous: object, next: object) {
  return {
    values: Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => value !== undefined && !equal(value, Reflect.get(previous, key)),
      ),
    ),
    removed: Object.keys(previous).filter(
      (key) => Reflect.get(previous, key) !== undefined && Reflect.get(next, key) === undefined,
    ),
  }
}
function turnDelta(
  previous: Task['turns'],
  next: NonNullable<Task['turns']>,
): Schema.Schema.Type<typeof turnsDeltaSchema> | undefined {
  if (previous === next) return undefined
  const old = new Map(previous?.map((turn) => [turn.id, turn]))
  const changes: Schema.Schema.Type<typeof turnsDeltaSchema>['changes'] = []
  for (const turn of next) {
    const before = old.get(turn.id)
    if (before && (before === turn || equalFields(before, turn))) continue
    changes.push({
      id: turn.id,
      ...(before
        ? { fieldDelta: decode(turnFieldDeltaSchema, changedFields(before, turn)) }
        : { fields: turn }),
    })
  }
  const orderChanged = !equal(
    previous?.map((turn) => turn.id),
    next.map((turn) => turn.id),
  )
  if (!orderChanged && !changes.length) return undefined
  return { ...(orderChanged ? { order: next.map((turn) => turn.id) } : {}), changes }
}
export function snapshotDelta(
  previous: RuntimeSnapshot,
  next: RuntimeSnapshot,
  compact = false,
  fieldUpdates = false,
  incremental = false,
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
    const turns =
      incremental && fieldUpdates && before && task.turns !== undefined
        ? turnDelta(before.turns, task.turns)
        : undefined
    const fieldsChanged =
      !before ||
      !!turns ||
      (incremental && before.turns !== undefined && task.turns === undefined) ||
      !equalFields(
        taskMetadata(task, compact, incremental && fieldUpdates),
        taskMetadata(before, compact, incremental && fieldUpdates),
      )
    const updatedAtChanged =
      compact && before && !fieldsChanged && task.updatedAt !== before.updatedAt
    const messageChanges: Schema.Schema.Type<typeof messagesSchema>['changes'] = []
    let messageOrderChanged = false
    if (messages !== oldMessages) {
      const oldById = new Map(oldMessages.map((message) => [message.id, message]))
      for (const message of messages) {
        const last = oldById.get(message.id)
        if (last === message) continue
        const { text, ...messageFields } = message
        const { text: oldText, ...oldMessageFields } = last ?? { text: undefined }
        if (last && text === oldText && equalFields(messageFields, oldMessageFields)) continue
        messageChanges.push({
          fields: messageFields,
          text:
            last && text.startsWith(last.text)
              ? { length: last.text.length, append: text.slice(last.text.length) }
              : text,
        })
      }
      messageOrderChanged = !equal(
        oldMessages.map((message) => message.id),
        messages.map((message) => message.id),
      )
    }
    const messagesChanged = messageChanges.length > 0 || messageOrderChanged
    const fieldDelta =
      fieldsChanged && fieldUpdates && before
        ? decode(taskFieldDeltaSchema, {
            values: Object.fromEntries(
              Object.entries(fields).filter(
                ([key, value]) =>
                  key !== 'id' &&
                  !(key === 'turns' && turns) &&
                  value !== undefined &&
                  !equal(value, Reflect.get(oldFields, key)),
              ),
            ),
            removed: Object.keys(oldFields).filter(
              (key) =>
                key !== 'id' &&
                Reflect.get(oldFields, key) !== undefined &&
                Reflect.get(fields, key) === undefined,
            ),
          })
        : undefined
    if (fieldsChanged || messagesChanged || updatedAtChanged)
      changes.push({
        id: task.id,
        ...(updatedAtChanged ? { updatedAt: task.updatedAt ?? null } : {}),
        ...(fieldDelta
          ? Object.keys(fieldDelta.values).length || fieldDelta.removed.length
            ? { fieldDelta }
            : {}
          : fieldsChanged
            ? { fields }
            : {}),
        ...(turns ? { turns } : {}),
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
    ...(incremental
      ? !equalFields(stateMetadata(state), stateMetadata(oldState))
        ? {
            stateDelta: decode(
              stateFieldDeltaSchema,
              changedFields(stateMetadata(oldState), stateMetadata(state)),
            ),
          }
        : {}
      : !compact || !equalFields(stateMetadata(state), stateMetadata(oldState))
        ? { state }
        : {}),
    ...((compact || incremental) && state.revision !== oldState.revision
      ? { revision: state.revision }
      : {}),
    workspace: {
      ...(!compact || !equalFields(metadata, oldMetadata) ? { metadata } : {}),
      ...(!equal(previous.workspace.agents, agents) ? { agents } : {}),
      ...(!equal(previous.workspace.repositories, repositories) ? { repositories } : {}),
      ...(!equal(previous.workspace.automations, automations) ? { automations } : {}),
      ...(changes.length || taskOrderChanged
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
  if (delta.state && delta.stateDelta) throw new Error('Sync state baseline is ambiguous')
  const { workspace: _workspace, ...previousState } = previous
  const state = delta.stateDelta
    ? patchFields(stateMetadata(previousState), delta.stateDelta, assertStateFields)
    : (delta.state ?? previous)
  const revision = delta.revision ?? delta.state?.revision ?? previous.revision
  // Terminal/status changes do not rebuild the thread workspace or its lookup map.
  if (Object.values(delta.workspace).every((value) => value === undefined))
    return { ...state, revision, workspace: previous.workspace }
  const tasks = new Map(
    delta.workspace.tasks ? previous.workspace.tasks.map((task) => [task.id, task]) : [],
  )
  for (const change of delta.workspace.tasks?.changes ?? []) {
    const before = tasks.get(change.id)
    if (change.fieldDelta && (!before || change.fields))
      throw new Error('Sync field baseline is missing or ambiguous')
    const fields =
      change.fieldDelta && before
        ? applyTaskFields(before, change.fieldDelta)
        : (change.fields ?? before)
    if (!fields || fields.id !== change.id) throw new Error('Sync task baseline is missing')
    let turns: Task['turns']
    if (change.turns) {
      if (
        !before ||
        change.fields ||
        change.fieldDelta?.values.turns !== undefined ||
        change.fieldDelta?.removed.includes('turns')
      )
        throw new Error('Sync turn baseline is missing or ambiguous')
      const byId = new Map(before.turns?.map((turn) => [turn.id, turn]))
      for (const update of change.turns.changes) {
        const last = byId.get(update.id)
        if (update.fieldDelta && (!last || update.fields))
          throw new Error('Sync turn baseline is missing or ambiguous')
        if (!last && !change.turns.order) throw new Error('Sync turn order is missing')
        const turn =
          update.fieldDelta && last
            ? patchFields(last, update.fieldDelta, assertTurn)
            : update.fields
        if (!turn || turn.id !== update.id) throw new Error('Sync turn identity does not match')
        byId.set(update.id, turn)
      }
      const ids = change.turns.order ?? before.turns?.map((turn) => turn.id) ?? []
      if (new Set(ids).size !== ids.length) throw new Error('Sync turn order has duplicate IDs')
      turns = ids.map((id) => {
        const turn = byId.get(id)
        if (!turn) throw new Error('Sync turn baseline is missing')
        return turn
      })
    }
    let ordered = before?.messages ?? []
    if (change.messages) {
      const messages = new Map(ordered.map((message) => [message.id, message]))
      for (const message of change.messages.changes) {
        const old = messages.get(message.fields.id)
        if (typeof message.text !== 'string' && (!old || old.text.length !== message.text.length))
          throw new Error('Sync text baseline does not match')
        const text =
          typeof message.text === 'string' ? message.text : (old?.text ?? '') + message.text.append
        messages.set(message.fields.id, { ...message.fields, text })
      }
      const getMessage = (id: string) => {
        const message = messages.get(id)
        if (!message) throw new Error('Sync message baseline is missing')
        return message
      }
      ordered = change.messages.order
        ? change.messages.order.map(getMessage)
        : ordered.map((message) => getMessage(message.id))
    }
    tasks.set(change.id, {
      ...fields,
      ...(turns ? { turns } : {}),
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
    ...state,
    revision,
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
