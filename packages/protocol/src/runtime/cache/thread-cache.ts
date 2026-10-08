import { Effect, Semaphore } from 'effect'
import type { Task } from '../../workspace.js'
import type { RuntimeSnapshot } from '../connection/runtime.js'
import { runtimeSnapshotCacheSchema, type RuntimeReadCache } from './read-cache.js'

/** Preserve only cached history, while using fresh shell fields for status, drafts and settings. */
export function cachedThread(summary: Task, cached: Task): Task {
  if ((summary.historyRevision ?? 0) !== (cached.historyRevision ?? 0)) return summary
  const turns = new Map(cached.turns?.map((turn) => [turn.id, turn]))
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
    turns: summary.turns?.map((turn) => ({ ...turn, checkpoint: turns.get(turn.id)?.checkpoint })),
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
    const size = new TextEncoder().encode(JSON.stringify(cached)).byteLength
    if (ids.size >= 20 || retainedBytes + size > 8 * 1024 * 1024) continue
    retainedBytes += size
    ids.add(id)
    retained.set(id, cachedThread(task, cached))
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
    const size = new TextEncoder().encode(JSON.stringify(task)).byteLength
    if (kept.size >= 20 || bytes + size > 8 * 1024 * 1024) continue
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
export function writeRuntimeSnapshotCache(cache: RuntimeReadCache, envelope: Envelope) {
  let replica = replicas.get(cache)
  if (!replica) {
    replica = { loaded: false, lock: Effect.runSync(Semaphore.make(1)) }
    replicas.set(cache, replica)
  }
  const state = replica
  return state.lock.withPermits(1)(
    Effect.gen(function* () {
      if (!state.loaded) {
        state.snapshot = (yield* cache.readEffect(
          'snapshot',
          runtimeSnapshotCacheSchema,
        ))?.value.snapshot
        state.loaded = true
      }
      const snapshot = boundedSnapshotCache(retainCachedThreads(state.snapshot, envelope.snapshot))
      yield* cache.writeEffect('snapshot', { ...envelope, snapshot })
      state.snapshot = snapshot
    }),
  )
}
