import { Effect, Semaphore } from 'effect'
import type { Task } from '../../workspace.js'
import { taskBudgetUsage } from '../../tasks/task-budget.js'
import type { RuntimeSnapshot } from '../connection/runtime.js'
import { runtimeSnapshotCacheSchema, type RuntimeReadCache } from './read-cache.js'
const sizes = new WeakMap<Task, number>()
function taskBytes(task: Task) {
  let size = sizes.get(task)
  if (size === undefined) {
    size = new TextEncoder().encode(JSON.stringify(task)).byteLength
    sizes.set(task, size)
  }
  return size
}

/** Preserve only cached history, while using fresh shell fields for status, drafts and settings. */
export function cachedThread(summary: Task, cached: Task): Task {
  if ((summary.historyRevision ?? 0) !== (cached.historyRevision ?? 0)) return summary
  const messageIds = new Set(cached.messages.map((message) => message.id))
  const ownedTurns = new Set(
    cached.messages.flatMap((message) => (message.turnId ? [message.turnId] : [])),
  )
  const turns = new Map(
    cached.turns
      ?.filter((turn) => messageIds.has(turn.assistantId) || ownedTurns.has(turn.id))
      .map((turn) => [turn.id, turn]),
  )
  const summaryTurns = new Set(summary.turns?.map((turn) => turn.id))
  // A newer latest-only summary cannot tell us how an older running turn finished. Its
  // cached status and growing duration would contradict the authoritative aggregate totals.
  if ([...turns.values()].some((turn) => turn.status === 'running' && !summaryTurns.has(turn.id)))
    return summary
  // The wire summary's totals already include every turn before its latest one. Restoring
  // turn metadata alongside cached messages moves those turns out of the aggregate budget.
  const restoredUsage = taskBudgetUsage({
    turns: [...turns.values()].filter((turn) => !summaryTurns.has(turn.id)),
  })
  for (const turn of summary.turns ?? [])
    turns.set(turn.id, {
      ...turn,
      checkpoint: turn.checkpoint ?? turns.get(turn.id)?.checkpoint,
    })
  return {
    ...summary,
    messages: cached.messages,
    historyBefore: cached.historyBefore,
    sideChats: summary.sideChats?.map((chat) => ({
      ...chat,
      messages: cached.sideChats?.find((entry) => entry.id === chat.id)?.messages ?? [],
    })),
    files: summary.files.map((file) => {
      const previous = cached.files.find((entry) => entry.path === file.path)
      return previous ? { ...file, before: previous.before, after: previous.after } : file
    }),
    turns:
      summary.turns === undefined && cached.turns === undefined ? undefined : [...turns.values()],
    historyTotals: summary.historyTotals
      ? {
          ...summary.historyTotals,
          tokens:
            summary.historyTotals.tokens === undefined
              ? undefined
              : Math.max(0, summary.historyTotals.tokens - (restoredUsage.tokens ?? 0)),
          milliseconds: Math.max(
            0,
            summary.historyTotals.milliseconds - restoredUsage.minutes * 60000,
          ),
        }
      : undefined,
    forkedFrom: summary.forkedFrom
      ? { ...summary.forkedFrom, snapshot: cached.forkedFrom?.snapshot }
      : undefined,
  }
}
export function retainCachedThreads(
  previous: RuntimeSnapshot | undefined,
  next: RuntimeSnapshot,
): RuntimeSnapshot {
  if (!previous || !next.detailTaskIds) return next
  const old = new Map(previous.workspace.tasks.map((task) => [task.id, task]))
  const summaries = new Map(next.workspace.tasks.map((task) => [task.id, task]))
  const ids = new Set(next.detailTaskIds)
  const retained = new Map<string, Task>()
  let retainedBytes = 0
  // Stored detail order is most recently selected first, independently of workspace ordering.
  for (const id of previous.detailTaskIds ?? [...old.keys()]) {
    const task = summaries.get(id),
      cached = old.get(id)
    if (
      ids.has(id) ||
      !task ||
      !cached ||
      (task.historyRevision ?? 0) !== (cached.historyRevision ?? 0)
    )
      continue
    if (ids.size >= 20) break
    const size = taskBytes(cached)
    if (retainedBytes + size > 8 * 1024 * 1024) continue
    const restored = cachedThread(task, cached)
    if (restored === task) continue
    retainedBytes += size
    ids.add(id)
    retained.set(id, restored)
  }
  const tasks = next.workspace.tasks.map((task) => retained.get(task.id) ?? task)

  return { ...next, detailTaskIds: [...ids], workspace: { ...next.workspace, tasks } }
}

/** Bound the persistent aggregate too, including full snapshots from older runtimes. */
export function boundedSnapshotCache(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  const ids = snapshot.detailTaskIds ?? snapshot.workspace.tasks.map((task) => task.id)
  const byId = new Map(snapshot.workspace.tasks.map((task) => [task.id, task]))
  const kept = new Set<string>()
  let bytes = 0
  for (const id of ids) {
    const task = byId.get(id)
    if (!task) continue
    if (kept.size >= 20) break
    const size = taskBytes(task)
    if (bytes + size > 8 * 1024 * 1024) continue
    kept.add(id)
    bytes += size
  }
  return {
    ...snapshot,
    detailTaskIds: [...kept],
    workspace: {
      ...snapshot.workspace,
      tasks: snapshot.workspace.tasks.map((task) =>
        kept.has(task.id)
          ? task
          : {
              ...task,
              messages: [],
              historyBefore: undefined,
              sideChats: task.sideChats?.map((chat) => ({ ...chat, messages: [] })),
              files: task.files.map((file) => ({
                ...file,
                before: '',
                after: '',
                diskContents: undefined,
              })),
              turns: task.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
              forkedFrom: task.forkedFrom ? { ...task.forkedFrom, snapshot: undefined } : undefined,
            },
      ),
    },
  }
}
type Envelope = typeof runtimeSnapshotCacheSchema.Type
const replicas = new WeakMap<
  RuntimeReadCache,
  { snapshot?: RuntimeSnapshot; loaded: boolean; lock: Semaphore.Semaphore }
>()
/** Reuse the writer's bounded, decoded replica instead of decoding it again on each selection. */
export function cachedRuntimeThread(cache: RuntimeReadCache, taskId: string): Task | undefined {
  if (cache.closed) {
    replicas.delete(cache)
    return undefined
  }
  const snapshot = replicas.get(cache)?.snapshot
  if (snapshot?.detailTaskIds && !snapshot.detailTaskIds.includes(taskId)) return undefined
  return snapshot?.workspace.tasks.find((task) => task.id === taskId)
}
export function writeRuntimeSnapshotCache(cache: RuntimeReadCache, envelope: Envelope) {
  let replica = replicas.get(cache)
  if (!replica) {
    replica = { loaded: false, lock: Effect.runSync(Semaphore.make(1)) }
    replicas.set(cache, replica)
  }
  const state = replica
  return state.lock.withPermits(1)(
    Effect.gen(function* () {
      if (cache.closed) return
      if (!state.loaded) {
        state.snapshot = (yield* cache.readEffect(
          'snapshot',
          runtimeSnapshotCacheSchema,
        ))?.value.snapshot
        state.loaded = true
      }
      const snapshot = boundedSnapshotCache(retainCachedThreads(state.snapshot, envelope.snapshot))
      yield* cache.writeEffect('snapshot', { ...envelope, snapshot })
      if (cache.closed) return
      state.snapshot = snapshot
    }),
  )
}
