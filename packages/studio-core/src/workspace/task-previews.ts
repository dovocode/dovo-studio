import type {
  RuntimeConnection,
  RuntimeSnapshot,
  Task,
  Workspace,
  WorkspacePatchResult,
} from '@dovo/protocol'

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
  runtimeInstanceId?: string
  acknowledged?: WorkspacePatchResult
}

export function taskPreviewConfirmed(
  preview: TaskPreview,
  snapshot: RuntimeSnapshot,
  pending: readonly TaskPreview[] = [],
) {
  const ack = preview.acknowledged
  if (!ack) return false
  // A later confirmed edit must continue covering an older request whose reply is delayed.
  if (
    pending
      .slice(0, pending.indexOf(preview))
      .some(
        (older) =>
          !older.acknowledged &&
          older.taskId === preview.taskId &&
          older.connection.address === preview.connection.address &&
          older.connection.token === preview.connection.token &&
          Object.keys(older.changes).some((field) => Object.hasOwn(preview.changes, field)),
      )
  )
    return false
  if (ack.runtimeInstanceId && snapshot.runtimeInstanceId !== ack.runtimeInstanceId)
    return (
      !!preview.runtimeInstanceId &&
      !!snapshot.runtimeInstanceId &&
      snapshot.runtimeInstanceId !== preview.runtimeInstanceId
    )
  return snapshot.revision >= ack.revision
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
export async function withTaskPreview<A extends WorkspacePatchResult>(
  preview: TaskPreview,
  publish: (update: (items: TaskPreview[]) => TaskPreview[]) => void,
  action: () => Promise<A>,
): Promise<A> {
  publish((items) => [...items, preview])
  try {
    const acknowledged = await action()
    publish((items) =>
      items.map((item) => (item.id === preview.id ? { ...item, acknowledged } : item)),
    )
    return acknowledged
  } catch (error) {
    publish((items) => items.filter((item) => item.id !== preview.id))
    throw error
  }
}
