import type { RuntimeConnection, Task, Workspace } from '@dovo/protocol'

export type TaskPreviewChanges = Partial<
  Pick<
    Task,
    'title' | 'pinned' | 'archived' | 'snoozedUntil' | 'agentId' | 'agentOverrides' | 'harness'
  >
>
export type TaskPreview = {
  id: symbol
  connection: RuntimeConnection
  taskId: string
  changes: TaskPreviewChanges
}

export function previewWorkspace(
  workspace: Workspace,
  connection: RuntimeConnection | null,
  pending: readonly TaskPreview[],
): Workspace {
  if (!connection) return workspace
  const byTask = new Map<string, TaskPreviewChanges>()
  for (const item of pending) {
    if (
      item.connection.address !== connection.address ||
      item.connection.token !== connection.token
    )
      continue
    byTask.set(item.taskId, { ...byTask.get(item.taskId), ...item.changes })
  }
  if (!byTask.size) return workspace
  let changed = false
  const tasks = workspace.tasks.map((task) => {
    const patch = byTask.get(task.id)
    if (
      !patch ||
      !Object.entries(patch).some(([key, value]) => !Object.is(task[key as keyof Task], value))
    )
      return task
    changed = true
    return { ...task, ...patch }
  })
  if (!changed) return workspace
  return {
    ...workspace,
    tasks,
  }
}

/** Keep previews separate from the durable outbox and authoritative offline snapshots. */
export async function withTaskPreview<A>(
  preview: TaskPreview,
  publish: (update: (items: TaskPreview[]) => TaskPreview[]) => void,
  action: () => Promise<A>,
): Promise<A> {
  publish((items) => [...items, preview])
  try {
    return await action()
  } finally {
    publish((items) => items.filter((item) => item.id !== preview.id))
  }
}
