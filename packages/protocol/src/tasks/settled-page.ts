import type { Task } from '../workspace.js'
import { compareTaskActivity } from './task-priority.js'

export const settledSummaryPageSize = 25
/** Other orderings need complete summaries so the first page cannot omit their top rows. */
export function supportsSettledSummaryPaging(sort: string) {
  return sort === 'priority' || sort === 'activity'
}

/** The same logical thread can appear on its owner and on several replica hosts. */
export function settledThreadKey(task: Pick<Task, 'id' | 'replica'>, runtimeId: string) {
  return JSON.stringify([
    task.replica?.ownerRuntimeId ?? runtimeId,
    task.replica?.threadId ?? task.id,
  ])
}

/** Count omitted roots once, excluding copies already available from another computer. */
export function omittedSettledCount(
  sources: readonly {
    runtimeId: string
    tasks: readonly Pick<Task, 'id' | 'replica' | 'threadWatches'>[]
    page?: { omitted: number; threadKeys?: readonly string[] }
  }[],
) {
  const loaded = new Set(
    sources.flatMap((source) =>
      source.tasks.map((task) => settledThreadKey(task, source.runtimeId)),
    ),
  )
  const omitted = new Set<string>()
  const legacy = new Map<string, number>()
  for (const source of sources)
    for (const task of source.tasks)
      for (const watch of task.threadWatches ?? []) {
        if (watch.relation !== 'spawned') continue
        const runtimeId =
          watch.snapshot?.runtimeId ??
          (watch.runtimeId === 'local' ? source.runtimeId : watch.runtimeId)
        loaded.add(JSON.stringify([runtimeId, watch.threadId]))
      }
  for (const source of sources) {
    if (source.page?.threadKeys) {
      for (const key of source.page.threadKeys) if (!loaded.has(key)) omitted.add(key)
    } else {
      // Older runtimes report only a scalar. Do not add it twice for connection aliases.
      legacy.set(
        source.runtimeId,
        Math.max(legacy.get(source.runtimeId) ?? 0, source.page?.omitted ?? 0),
      )
    }
  }
  return omitted.size + [...legacy.values()].reduce((sum, count) => sum + count, 0)
}
/** Retain live/protected rows and ancestors even when their settled date is old. */
export function settledSummaryPage<T extends Task>(
  tasks: readonly T[],
  limit: number,
  selected: readonly string[] = [],
  now = Date.now(),
) {
  const protectedIds = new Set(selected)
  const relatedIds = new Set<string>()
  for (const task of tasks) {
    // A page must not turn a child into a root, or an unsent side chat into an orphan.
    const parentId =
      task.delegation?.parentTaskId ?? task.spawnParent?.threadId ?? task.sideThread?.parentTaskId
    if (parentId) {
      protectedIds.add(task.id)
      relatedIds.add(parentId)
    }
    for (const watch of task.threadWatches ?? [])
      if (watch.relation === 'spawned') {
        protectedIds.add(task.id)
        relatedIds.add(watch.threadId)
        for (const child of watch.snapshot?.threads ?? watch.snapshot?.entries ?? [])
          relatedIds.add(child.threadId)
      }
    for (const child of task.subagents ?? [])
      if (child.taskId) {
        protectedIds.add(task.id)
        relatedIds.add(child.taskId)
      }
  }
  // Keep the worst retained row at the heap root: selecting 25 from a large
  // workspace costs O(n log 25), without sorting the complete workspace.
  const heap: number[] = []
  const kept = new Set<string>()
  const compare = (a: number, b: number) => compareTaskActivity(tasks[a]!, tasks[b]!) || a - b
  let eligible = 0
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]!
    if (
      !task.archived ||
      task.example ||
      task.archivedAt ||
      task.pinned ||
      task.status === 'running' ||
      task.waitingForFeedback ||
      protectedIds.has(task.id) ||
      relatedIds.has(task.replica?.threadId ?? task.id) ||
      (task.snoozedUntil && Date.parse(task.snoozedUntil) > now)
    ) {
      kept.add(task.id)
      continue
    }
    eligible++
    if (limit <= 0) continue
    if (heap.length < limit) {
      let child = heap.length
      heap.push(index)
      while (child > 0) {
        const parent = (child - 1) >>> 1
        if (compare(heap[parent]!, index) >= 0) break
        heap[child] = heap[parent]!
        child = parent
      }
      heap[child] = index
    } else if (compare(index, heap[0]!) < 0) {
      let parent = 0
      while (parent * 2 + 1 < heap.length) {
        let child = parent * 2 + 1
        if (child + 1 < heap.length && compare(heap[child + 1]!, heap[child]!) > 0) child++
        if (compare(index, heap[child]!) >= 0) break
        heap[parent] = heap[child]!
        parent = child
      }
      heap[parent] = index
    }
  }
  for (const index of heap) kept.add(tasks[index]!.id)
  return {
    tasks: tasks.filter((task) => kept.has(task.id)),
    omitted: eligible - heap.length,
    omittedTasks: tasks.filter((task) => !kept.has(task.id)),
  }
}
