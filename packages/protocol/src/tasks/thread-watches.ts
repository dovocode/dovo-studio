import { Schema } from 'effect'
import { mutableArray, mutableStruct, maxValue, minValue } from '../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const threadWatchCountsSchema = mutableStruct({
  pipelines: count,
  pullRequests: count,
  failures: count,
})
const threadWatchEntrySchema = mutableStruct({
  runtimeId: id,
  threadId: id,
  attention: maxValue(mutableArray(id), 100),
  watches: threadWatchCountsSchema,
  phase: Schema.Literals(['draft', 'running', 'waiting', 'needs-input', 'completed']),
  revision: Schema.String,
})
export type ThreadWatchEntry = typeof threadWatchEntrySchema.Type
export const threadWatchSnapshotSchema = mutableStruct({
  runtimeId: Schema.optional(id),
  title: maxValue(Schema.String, 1000),
  phase: Schema.Literals(['draft', 'running', 'waiting', 'needs-input', 'completed']),
  revision: Schema.String,
  attention: maxValue(mutableArray(id), 100),
  watches: threadWatchCountsSchema,
  // Flat own-thread facts prevent recursive snapshots from multiplying shared descendants.
  entries: Schema.optional(maxValue(mutableArray(threadWatchEntrySchema), 1000)),
  partial: Schema.optional(Schema.Boolean),
})
export const threadWatchSummarySchema = mutableStruct({
  runtimeId: id,
  threadId: id,
  computerName: Schema.String,
  relation: Schema.Literals(['spawned', 'linked']),
  status: Schema.Literals(['watching', 'stopped']),
  snapshot: Schema.optional(threadWatchSnapshotSchema),
  checkedAt: Schema.optional(Schema.String),
  lastSuccessAt: Schema.optional(Schema.String),
  offline: Schema.Boolean,
  paused: Schema.optional(Schema.Boolean),
})
export type ThreadWatchSnapshot = typeof threadWatchSnapshotSchema.Type
export type ThreadWatchSummary = typeof threadWatchSummarySchema.Type

/** Local facts win over cached copies that travelled back through a remote cycle. */
export function mergeThreadWatchEntries(
  local: readonly ThreadWatchEntry[],
  remote: readonly ThreadWatchSummary[],
  runtimeId: string,
) {
  const key = (entry: Pick<ThreadWatchEntry, 'runtimeId' | 'threadId'>) =>
    JSON.stringify([entry.runtimeId, entry.threadId])
  const entries = new Map(local.slice(0, 1000).map((entry) => [key(entry), entry]))
  let partial = local.length > 1000
  for (const watch of [...remote].sort((a, b) =>
    (b.lastSuccessAt ?? '').localeCompare(a.lastSuccessAt ?? ''),
  )) {
    if (watch.status !== 'watching' || watch.paused || !watch.snapshot) continue
    const snapshot = watch.snapshot
    partial ||= !!snapshot.partial
    const facts = snapshot.entries ?? [
      {
        runtimeId: watch.runtimeId === 'local' ? runtimeId : watch.runtimeId,
        threadId: watch.threadId,
        attention: snapshot.attention,
        watches: snapshot.watches,
        phase: snapshot.phase,
        revision: snapshot.revision,
      },
    ]
    for (const entry of facts) {
      if ((entry.runtimeId === runtimeId && watch.runtimeId !== 'local') || entries.has(key(entry)))
        continue
      if (entries.size >= 1000) {
        partial = true
        continue
      }
      entries.set(key(entry), entry)
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
