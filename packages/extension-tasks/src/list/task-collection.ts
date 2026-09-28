import type { RuntimeOverview, RuntimeSnapshot, Task, Workspace } from '@dovo/studio-core'

export type TaskSource = {
  runtimeId: string | null
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

const taskRuntimeName = (entry: RuntimeOverview) =>
  entry.profile.name === new URL(entry.profile.connection.address).hostname
    ? (entry.snapshot?.runtimeHost ?? entry.profile.name)
    : entry.profile.name

// Keep unsent local edits authoritative while retaining every other computer's cached work.
export function taskSources({
  workspace,
  snapshot,
  activeRuntimeId,
  connected,
  runtimes,
}: {
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
