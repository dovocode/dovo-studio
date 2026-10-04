import { runtimeComputerName } from '@dovo/protocol'
import type { RuntimeOverview, RuntimeSnapshot, Task, Workspace } from '@dovo/studio-core'

export type TaskSource = {
  runtimeId: string | null
  address?: string
  name: string
  workspace: Workspace
  snapshot: RuntimeSnapshot | null
  online: boolean
}
export type TaskEntry = {
  key: string
  task: Task
  source: TaskSource
  needsInput: boolean
  projectKey: string
  projectName: string
}

export const taskCollectionKey = (runtimeId: string | null, entityId: string) =>
  JSON.stringify([runtimeId, entityId])

const taskRuntimeName = runtimeComputerName

// Keep unsent local edits authoritative while retaining every other computer's cached work.
export function taskSources({
  workspace,
  snapshot,
  activeRuntimeId,
  connected,
  runtimes,
  connection,
}: {
  connection?: { address: string } | null
  workspace: Workspace
  snapshot: RuntimeSnapshot | null
  activeRuntimeId: string | null
  connected: boolean
  runtimes: readonly RuntimeOverview[]
}): TaskSource[] {
  const active = runtimes.find((entry) => entry.profile.id === activeRuntimeId)
  return [
    {
      runtimeId: activeRuntimeId,
      address: connection?.address ?? active?.profile.connection.address,
      name: active ? taskRuntimeName(active) : (snapshot?.runtimeHost ?? 'This computer'),
      workspace,
      snapshot,
      online: connected,
    },
    ...runtimes.flatMap((entry) =>
      entry.profile.id === activeRuntimeId || !entry.snapshot
        ? []
        : [
            {
              runtimeId: entry.profile.id,
              address: entry.profile.connection.address,
              name: taskRuntimeName(entry),
              workspace: entry.snapshot.workspace,
              snapshot: entry.snapshot,
              online: entry.connected,
            },
          ],
    ),
  ]
}

export function collectTasks(sources: readonly TaskSource[]): TaskEntry[] {
  return sources.flatMap((source) => {
    const input = new Set(
      [...(source.snapshot?.questions ?? []), ...(source.snapshot?.approvals ?? [])].map(
        (request) => request.taskId,
      ),
    )
    return source.workspace.tasks
      .filter((task) => !task.example)
      .map((task) => ({
        key: taskCollectionKey(source.runtimeId, task.id),
        task,
        source,
        needsInput: input.has(task.id),
        projectKey: taskCollectionKey(source.runtimeId, task.repositoryId),
        projectName:
          source.workspace.repositories.find((repo) => repo.id === task.repositoryId)?.name ??
          'No project',
      }))
  })
}

/** Delegated threads remain navigable, but belong to their parent in list views. */
export function mainTaskEntries(entries: readonly TaskEntry[]): TaskEntry[] {
  return entries.filter(({ task }) => !task.delegation)
}
