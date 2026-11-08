import { Schema } from 'effect'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { StateVersion } from '@dovo/durable-connections'
import { decode, mutableStruct, minValue, maxValue } from '../../shared/schema.js'
import { taskSchema, type Task, type ChatMessage } from '../../workspace.js'

export const threadReplicationChannel = 'shared-threads:v1'
const id = maxValue(minValue(Schema.String, 1), 200)
const identity = { ownerRuntimeId: id, threadId: id }
const message = mutableStruct({
  id,
  role: Schema.Literals(['user', 'assistant']),
  text: maxValue(Schema.String, 6 * 1024 * 1024),
  createdAt: Schema.optional(Schema.String),
})
export const threadRecordSchema = Schema.Union([
  mutableStruct({
    ...identity,
    kind: Schema.Literal('thread'),
    ownerName: maxValue(Schema.String, 200),
    projectName: maxValue(Schema.String, 400),
    createdAt: Schema.String,
    status: taskSchema.fields.status,
    archived: Schema.optional(Schema.Boolean),
    archivedAt: Schema.optional(Schema.String),
    historyRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    removed: Schema.Boolean,
  }),
  mutableStruct({
    ...identity,
    kind: Schema.Literal('title'),
    value: maxValue(minValue(Schema.String, 1), 2000),
  }),
  mutableStruct({ ...identity, kind: Schema.Literal('pinned'), value: Schema.Boolean }),
  mutableStruct({
    ...identity,
    kind: Schema.Literal('snoozedUntil'),
    value: Schema.NullOr(Schema.String),
  }),
  mutableStruct({
    ...identity,
    kind: Schema.Literal('message'),
    messageId: id,
    position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    message: Schema.NullOr(message),
  }),
])
export type ThreadRecord = Schema.Schema.Type<typeof threadRecordSchema>
export const threadVersionSchema = mutableStruct({
  key: Schema.String,
  updatedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  changeId: Schema.String,
  deleted: Schema.Literal(false),
  value: threadRecordSchema,
})
export type ThreadVersion = StateVersion<ThreadRecord>
export const threadReplicaId = (owner: string, threadId: string) =>
  `replica:${bytesToHex(sha256(utf8ToBytes(JSON.stringify([owner, threadId]))))}`
export const threadRecordKey = (record: ThreadRecord) =>
  JSON.stringify([
    record.ownerRuntimeId,
    record.threadId,
    record.kind,
    ...(record.kind === 'message' ? [record.messageId] : []),
  ])
export function validateThreadVersion(version: ThreadVersion) {
  if (version.deleted || version.key !== threadRecordKey(version.value))
    throw new Error('Invalid replicated thread record')
  if (
    version.value.kind === 'message' &&
    version.value.message &&
    version.value.message.id !== version.value.messageId
  )
    throw new Error('Replicated message identity changed')
}
export const threadReplicaReadSchema = mutableStruct({
  ownerRuntimeId: id,
  threadId: id,
  before: Schema.optional(id),
})
export const threadReplicaPageSchema = mutableStruct({ task: taskSchema })
export const threadMetadataEditSchema = Schema.Union([
  mutableStruct({
    ...identity,
    field: Schema.Literal('title'),
    value: maxValue(minValue(Schema.String, 1), 2000),
  }),
  mutableStruct({ ...identity, field: Schema.Literal('pinned'), value: Schema.Boolean }),
  mutableStruct({
    ...identity,
    field: Schema.Literal('snoozedUntil'),
    value: Schema.NullOr(Schema.String),
  }),
])
export type ThreadMetadataEdit = Schema.Schema.Type<typeof threadMetadataEditSchema>

/** A display projection only: no queues, provider sessions, permissions, paths or file data. */
export class ThreadHistoryChangedError extends Error {}

export function replicatedThread(
  versions: readonly ThreadVersion[],
  owner: string,
  threadId: string,
  before?: string,
  messages = true,
): Task | undefined {
  const entries = versions.filter(
    (entry) =>
      !entry.deleted && entry.value.ownerRuntimeId === owner && entry.value.threadId === threadId,
  )
  const records = entries.flatMap((entry) => (entry.deleted ? [] : [entry.value]))
  const descriptor = records.find((record) => record.kind === 'thread')
  if (!descriptor || descriptor.kind !== 'thread' || descriptor.removed) return undefined
  const title = records.find((record) => record.kind === 'title')
  const pinned = records.find((record) => record.kind === 'pinned')
  const snoozed = records.find((record) => record.kind === 'snoozedUntil')
  const history = records
    .flatMap((record) =>
      record.kind === 'message' && record.message
        ? [{ message: record.message, position: record.position }]
        : [],
    )
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.message.id < b.message.id ? -1 : a.message.id > b.message.id ? 1 : 0),
    )
  const end =
    before === undefined
      ? history.length
      : history.findIndex((entry) => entry.message.id === before)
  if (end < 0)
    throw new ThreadHistoryChangedError(
      'This conversation changed. Reload before loading older messages.',
    )
  const start = Math.max(0, end - 40)
  const page: ChatMessage[] = messages
    ? history.slice(start, end).map((entry) => entry.message)
    : []
  return {
    id: threadReplicaId(owner, threadId),
    title: title?.kind === 'title' ? title.value : 'Shared thread',
    repositoryId: '',
    agentId: '',
    status: descriptor.status,
    archived: descriptor.archived ?? false,
    archivedAt: descriptor.archivedAt,
    createdAt: descriptor.createdAt,
    updatedAt: new Date(
      Math.min(
        8640000000000000,
        entries.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0),
      ),
    ).toISOString(),
    messages: page,
    historyBefore: messages && start > 0 ? page[0]?.id : undefined,
    historyRevision: descriptor.historyRevision,
    files: [],
    draft: '',
    example: false,
    pinned: pinned?.kind === 'pinned' ? pinned.value : false,
    snoozedUntil: snoozed?.kind === 'snoozedUntil' ? snoozed.value : null,
    replica: {
      ownerRuntimeId: owner,
      threadId,
      ownerName: descriptor.ownerName,
      projectName: descriptor.projectName,
    },
  }
}
export function replicatedThreadList(
  versions: readonly ThreadVersion[],
  localRuntimeId: string,
  detailIds?: readonly string[],
) {
  const groups = new Map<string, ThreadVersion[]>()
  for (const entry of versions) {
    if (entry.deleted) continue
    const key = JSON.stringify([entry.value.ownerRuntimeId, entry.value.threadId])
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return versions.flatMap((entry) => {
    if (
      entry.deleted ||
      entry.value.kind !== 'thread' ||
      entry.value.ownerRuntimeId === localRuntimeId ||
      entry.value.removed
    )
      return []
    const { ownerRuntimeId, threadId } = entry.value
    const task = replicatedThread(
      groups.get(JSON.stringify([ownerRuntimeId, threadId])) ?? [],
      ownerRuntimeId,
      threadId,
      undefined,
      detailIds === undefined || detailIds.includes(threadReplicaId(ownerRuntimeId, threadId)),
    )
    return task ? [task] : []
  })
}
/** Prefer the live owner; otherwise one reachable replica, retaining cached originals offline. */
export function preferredThreadCopies(
  sources: readonly { runtimeId: string; connected: boolean; tasks: readonly Task[] }[],
) {
  const preferred = new Map<string, { task: Task; rank: number }>()
  for (const source of sources)
    for (const task of source.tasks) {
      const owner = task.replica?.ownerRuntimeId ?? source.runtimeId
      const id = task.replica?.threadId ?? task.id
      const key = JSON.stringify([owner, id])
      const rank = source.connected ? (task.replica ? 2 : 3) : task.replica ? 0 : 1
      const previous = preferred.get(key)
      if (
        !previous ||
        rank > previous.rank ||
        (rank === previous.rank &&
          (task.updatedAt ?? task.createdAt) > (previous.task.updatedAt ?? previous.task.createdAt))
      )
        preferred.set(key, { task, rank })
    }
  return new Set([...preferred.values()].map((entry) => entry.task))
}
export const decodeThreadRecord = (value: unknown) => decode(threadRecordSchema, value)

export function mergeThreadReplicaPage(current: Task, incoming: Task, older = false): Task {
  if (current.id !== incoming.id) return incoming
  if ((incoming.historyRevision ?? 0) < (current.historyRevision ?? 0)) return current
  if ((incoming.historyRevision ?? 0) > (current.historyRevision ?? 0)) return incoming
  // A new tail after an offline gap is a separate window. Keeping both windows would
  // make its cursor skip the gap and prepend later pages ahead of older cached messages.
  const retainedIds = new Set(current.messages.map((message) => message.id))
  if (
    !older &&
    incoming.messages.length &&
    current.messages.length &&
    !incoming.messages.some((message) => retainedIds.has(message.id))
  )
    return incoming
  const combined = new Map(
    (older
      ? [...incoming.messages, ...current.messages]
      : [...current.messages, ...incoming.messages]
    ).map((message) => [message.id, message]),
  )
  const retainedOlder =
    !!incoming.messages.length &&
    current.messages.findIndex((message) => message.id === incoming.messages[0]?.id) > 0
  return {
    ...(older ||
    (incoming.updatedAt ?? incoming.createdAt) < (current.updatedAt ?? current.createdAt)
      ? current
      : incoming),
    messages: [...combined.values()],
    historyBefore: older
      ? incoming.historyBefore
      : !incoming.messages.length || retainedOlder
        ? current.historyBefore
        : incoming.historyBefore,
  }
}
