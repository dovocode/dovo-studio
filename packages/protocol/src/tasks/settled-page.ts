import type { Task } from '../workspace.js'
import { compareTaskActivity } from './task-priority.js'

export const settledSummaryPageSize = 25
/** Other orderings need complete summaries so the first page cannot omit their top rows. */
export function supportsSettledSummaryPaging(sort: string) {
  return sort === 'priority' || sort === 'activity'
}
/** Retain live/protected rows and ancestors even when their settled date is old. */
export function settledSummaryPage<T extends Task>(
  tasks: readonly T[],
  limit: number,
  selected: readonly string[] = [],
  now = Date.now(),
) {
  const protectedIds = new Set(selected)
  for (const task of tasks)
    for (const child of task.subagents ?? [])
      if (child.taskId) {
        protectedIds.add(task.id)
        protectedIds.add(child.taskId)
      }
  // Keep the worst retained row at the heap root: selecting 25 from a large
  // workspace costs O(n log 25), without sorting or retaining every omitted row.
  const heap: number[] = []
  const kept = new Set<string>()
  const compare = (a: number, b: number) => compareTaskActivity(tasks[a]!, tasks[b]!) || a - b
  let eligible = 0
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]!
    if (
      !task.archived ||
      task.archivedAt ||
      task.pinned ||
      task.status === 'running' ||
      task.waitingForFeedback ||
      protectedIds.has(task.id) ||
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
  return { tasks: tasks.filter((task) => kept.has(task.id)), omitted: eligible - heap.length }
}
