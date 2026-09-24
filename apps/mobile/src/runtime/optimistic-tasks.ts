import type { RuntimeConnection, RuntimeOverview, Task } from '@dovo/protocol'
import { Effect } from 'effect'

export type TaskPreview = Partial<Pick<Task, 'pinned' | 'archived' | 'snoozedUntil'>>
export type OptimisticTask = {
  id: symbol
  connection: RuntimeConnection
  taskId: string
  changes: TaskPreview
}

/** Overlays are presentation only: never mutate snapshots or the persisted offline cache. */
export function previewTasks(
  entry: RuntimeOverview,
  pending: readonly OptimisticTask[],
): RuntimeOverview {
  if (!entry.snapshot) return entry
  const byTask = new Map<string, TaskPreview>()
  const connection = entry.profile.connection
  for (const item of pending) {
    if (
      item.connection.address !== connection.address ||
      item.connection.token !== connection.token
    )
      continue
    byTask.set(item.taskId, { ...byTask.get(item.taskId), ...item.changes })
  }
  if (!byTask.size) return entry
  let changed = false
  const tasks = entry.snapshot.workspace.tasks.map((task) => {
    const patch = byTask.get(task.id)
    if (
      !patch ||
      !Object.entries(patch).some(([key, value]) => !Object.is(task[key as keyof Task], value))
    )
      return task
    changed = true
    return { ...task, ...patch }
  })
  if (!changed) return entry
  return {
    ...entry,
    snapshot: {
      ...entry.snapshot,
      workspace: {
        ...entry.snapshot.workspace,
        tasks,
      },
    },
  }
}

export function optimisticTaskEffect<A, E>(
  pending: OptimisticTask,
  publish: (change: (items: OptimisticTask[]) => OptimisticTask[]) => void,
  request: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.acquireUseRelease(
    Effect.sync(() => publish((items) => [...items, pending])),
    () => request,
    () => Effect.sync(() => publish((items) => items.filter((item) => item.id !== pending.id))),
  )
}
