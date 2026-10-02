import { Effect } from 'effect'
import type { Task } from '../../workspace.js'
import type { RuntimeSnapshot } from '../connection/runtime.js'
import { runtimeSnapshotCacheSchema, type RuntimeReadCache } from './read-cache.js'

/** Preserve only cached history, while using fresh shell fields for status, drafts and settings. */
export function cachedThread(summary: Task, cached: Task): Task {
  const turns = new Map(cached.turns?.map((turn) => [turn.id, turn]))
  return {
    ...summary,
    messages: cached.messages,
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
  const oldIds = new Set(previous.detailTaskIds ?? [...old.keys()])
  const ids = new Set(next.detailTaskIds)
  const tasks = next.workspace.tasks.map((task) => {
    const cached = old.get(task.id)
    if (ids.has(task.id) || !cached || !oldIds.has(task.id)) return task
    ids.add(task.id)
    return cachedThread(task, cached)
  })
  return { ...next, detailTaskIds: [...ids], workspace: { ...next.workspace, tasks } }
}
type Envelope = typeof runtimeSnapshotCacheSchema.Type
const replicas = new WeakMap<
  RuntimeReadCache,
  { snapshot?: RuntimeSnapshot; loaded: boolean; lock: Effect.Semaphore }
>()
export function writeRuntimeSnapshotCache(cache: RuntimeReadCache, envelope: Envelope) {
  let replica = replicas.get(cache)
  if (!replica) {
    replica = { loaded: false, lock: Effect.runSync(Effect.makeSemaphore(1)) }
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
      const snapshot = retainCachedThreads(state.snapshot, envelope.snapshot)
      yield* cache.writeEffect('snapshot', { ...envelope, snapshot })
      state.snapshot = snapshot
    }),
  )
}
