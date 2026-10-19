import { Schema } from 'effect'
import { mutableArray, mutableStruct, maxValue, minValue } from '../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const threadWatchCountsSchema = mutableStruct({
  pipelines: count,
  pullRequests: count,
  failures: count,
})
export const threadParentSchema = mutableStruct({
  runtimeId: id,
  threadId: id,
  title: Schema.optional(maxValue(Schema.String, 1000)),
})
export type ThreadParent = typeof threadParentSchema.Type
export const threadNativeAgentSchema = mutableStruct({
  key: maxValue(Schema.String, 64),
  name: maxValue(Schema.String, 1000),
  status: Schema.Literals(['working', 'completed', 'failed', 'stopped', 'unknown']),
  working: Schema.Boolean,
})
export type ThreadNativeAgent = typeof threadNativeAgentSchema.Type
const threadPresentationFields = {
  repositoryId: Schema.optional(id),
  projectIdentity: Schema.optional(maxValue(Schema.String, 2000)),
  projectKind: Schema.optional(Schema.Literals(['scratch', 'project'])),
  nativeAgents: Schema.optional(maxValue(mutableArray(threadNativeAgentSchema), 40)),
  nativeAgentOverflow: Schema.optional(
    mutableStruct({
      total: count,
      working: count,
      failed: count,
      failureKey: Schema.optional(maxValue(Schema.String, 64)),
    }),
  ),
}
const threadWatchEntrySchema = mutableStruct({
  ...threadPresentationFields,
  runtimeId: id,
  threadId: id,
  title: Schema.optional(maxValue(Schema.String, 1000)),
  projectName: Schema.optional(maxValue(Schema.String, 1000)),
  computerName: Schema.optional(maxValue(Schema.String, 1000)),
  parent: Schema.optional(threadParentSchema),
  status: Schema.optional(maxValue(Schema.String, 80)),
  failureVersion: Schema.optional(maxValue(Schema.String, 64)),
  paused: Schema.optional(Schema.Boolean),
  offline: Schema.optional(Schema.Boolean),
  attention: maxValue(mutableArray(id), 100),
  watches: threadWatchCountsSchema,
  phase: Schema.Literals(['draft', 'running', 'waiting', 'needs-input', 'completed']),
  revision: Schema.String,
})
export type ThreadWatchEntry = typeof threadWatchEntrySchema.Type
export const threadWatchSnapshotSchema = mutableStruct({
  ...threadPresentationFields,
  runtimeId: Schema.optional(id),
  title: maxValue(Schema.String, 1000),
  projectName: Schema.optional(maxValue(Schema.String, 1000)),
  failureVersion: Schema.optional(maxValue(Schema.String, 64)),
  phase: Schema.Literals(['draft', 'running', 'waiting', 'needs-input', 'completed']),
  revision: Schema.String,
  attention: maxValue(mutableArray(id), 100),
  watches: threadWatchCountsSchema,
  // Flat own-thread facts prevent recursive snapshots from multiplying shared descendants.
  entries: Schema.optional(maxValue(mutableArray(threadWatchEntrySchema), 1000)),
  /** Bounded presentation, including stopped/offline spawned branches. Never summed as counts. */
  threads: Schema.optional(maxValue(mutableArray(threadWatchEntrySchema), 200)),
  partial: Schema.optional(Schema.Boolean),
  status: Schema.optional(maxValue(Schema.String, 80)),
  error: Schema.optional(maxValue(Schema.String, 2000)),
  result: Schema.optional(maxValue(Schema.String, 20000)),
  resultTruncated: Schema.optional(Schema.Boolean),
})
export const threadWatchSummarySchema = mutableStruct({
  runtimeId: id,
  threadId: id,
  computerName: Schema.String,
  relation: Schema.Literals(['spawned', 'linked']),
  status: Schema.Literals(['watching', 'completed', 'stopped']),
  snapshot: Schema.optional(threadWatchSnapshotSchema),
  checkedAt: Schema.optional(Schema.String),
  lastSuccessAt: Schema.optional(Schema.String),
  offline: Schema.Boolean,
  paused: Schema.optional(Schema.Boolean),
  delegated: Schema.optional(Schema.Boolean),
  stopRequested: Schema.optional(Schema.Boolean),
})
export type ThreadWatchSnapshot = typeof threadWatchSnapshotSchema.Type
export type ThreadWatchSummary = typeof threadWatchSummarySchema.Type

/** Prefer the direct observer, then fresh and healthy paths. Profile IDs stay host-local. */
export function compareThreadWatchSources(
  a: ThreadWatchSummary,
  b: ThreadWatchSummary,
  fact: Pick<ThreadWatchEntry, 'runtimeId' | 'threadId'>,
  runtimeId: string,
) {
  const direct = (watch: ThreadWatchSummary) =>
    watch.threadId === fact.threadId &&
    (watch.snapshot?.runtimeId ?? (watch.runtimeId === 'local' ? runtimeId : watch.runtimeId)) ===
      fact.runtimeId
  return (
    Number(direct(a)) - Number(direct(b)) ||
    (a.lastSuccessAt ?? '').localeCompare(b.lastSuccessAt ?? '') ||
    Number(!a.offline && !a.paused && a.status !== 'stopped') -
      Number(!b.offline && !b.paused && b.status !== 'stopped') ||
    JSON.stringify([a.runtimeId, a.threadId, a.snapshot?.revision]).localeCompare(
      JSON.stringify([b.runtimeId, b.threadId, b.snapshot?.revision]),
    )
  )
}

/** Local facts win over cached copies that travelled back through a remote cycle. */
export function mergeThreadWatchEntries(
  local: readonly ThreadWatchEntry[],
  remote: readonly ThreadWatchSummary[],
  runtimeId: string,
) {
  const key = (entry: Pick<ThreadWatchEntry, 'runtimeId' | 'threadId'>) =>
    JSON.stringify([entry.runtimeId, entry.threadId])
  const entries = new Map(local.slice(0, 1000).map((entry) => [key(entry), entry]))
  const sources = new Map<string, ThreadWatchSummary>()
  let partial = local.length > 1000
  for (const watch of [...remote].sort((a, b) =>
    (b.lastSuccessAt ?? '').localeCompare(a.lastSuccessAt ?? ''),
  )) {
    if (watch.status === 'stopped' || watch.paused || !watch.snapshot) continue
    const snapshot = watch.snapshot
    partial ||= !!snapshot.partial
    const facts = snapshot.entries ?? [
      {
        runtimeId:
          snapshot.runtimeId ?? (watch.runtimeId === 'local' ? runtimeId : watch.runtimeId),
        threadId: watch.threadId,
        attention: snapshot.attention,
        watches: snapshot.watches,
        phase: snapshot.phase,
        revision: snapshot.revision,
      },
    ]
    for (const entry of facts) {
      const previous = sources.get(key(entry))
      if (
        entries.has(key(entry)) &&
        (!previous || compareThreadWatchSources(watch, previous, entry, runtimeId) <= 0)
      )
        continue
      if (entry.runtimeId === runtimeId && watch.runtimeId !== 'local') continue
      if (!entries.has(key(entry)) && entries.size >= 1000) {
        partial = true
        continue
      }
      sources.set(key(entry), watch)
      entries.set(key(entry), watch.offline ? { ...entry, offline: true } : entry)
    }
  }
  return { entries: [...entries.values()], partial }
}
export function sumThreadWatchEntries(entries: readonly ThreadWatchEntry[]) {
  return entries.reduce(
    (total, entry) => ({
      pipelines: total.pipelines + entry.watches.pipelines,
      pullRequests: total.pullRequests + entry.watches.pullRequests,
      failures: total.failures + entry.watches.failures,
    }),
    { pipelines: 0, pullRequests: 0, failures: 0 },
  )
}
