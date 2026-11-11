import { runtimeComputerName, taskFamilyInputIds, preferredThreadCopies } from '@dovo/protocol'
import type { RuntimeOverview, RuntimeSnapshot, Task, Workspace } from '@dovo/studio-core'
import { unusedSideDraft } from '../detail/side-threads'

export type TaskSource = {
  runtimeId: string | null
  connection?: import('@dovo/protocol').RuntimeConnection
  address?: string
  name: string
  workspace: Workspace
  snapshot: RuntimeSnapshot | null
  online: boolean
}
/**
 * The computer facts a sidebar row renders. Unlike a source it keeps its identity while only
 * task content streams, so memoized rows neither re-render nor retain old workspace snapshots.
 */
export type TaskOwner = Pick<TaskSource, 'runtimeId' | 'address' | 'name' | 'online'> & {
  /** Portable runtime identity for unified Studio references, when known. */
  runtimeIdentity?: string
  agents: Workspace['agents']
  repositories: Workspace['repositories']
  runtimeIcon: RuntimeSnapshot['runtimeIcon']
  acpInstallations: RuntimeSnapshot['acpInstallations']
  threadBehaviorSupported?: boolean
  worktreeDeletionOverrideSupported: boolean
  threadHandoffsSupported?: boolean
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
  const sources: TaskSource[] = [
    {
      runtimeId: activeRuntimeId,
      connection: active?.profile.connection,
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
              connection: entry.profile.connection,
              address: entry.profile.connection.address,
              name: taskRuntimeName(entry),
              workspace: entry.snapshot.workspace,
              snapshot: entry.snapshot,
              online: entry.connected,
            },
          ],
    ),
  ]
  const preferred = preferredThreadCopies(
    sources.map((source) => ({
      runtimeId:
        source.snapshot?.runtimeId ?? source.connection?.runtimeId ?? source.runtimeId ?? '',
      connected: source.online,
      tasks: source.workspace.tasks,
    })),
  )
  return sources.map((source) => {
    const tasks = source.workspace.tasks.filter((task) => preferred.has(task))
    return tasks.length === source.workspace.tasks.length
      ? source
      : { ...source, workspace: { ...source.workspace, tasks } }
  })
}

export function collectTasks(sources: readonly TaskSource[]): TaskEntry[] {
  return sources.flatMap((source) => {
    const input = taskFamilyInputIds(
      source.workspace.tasks,
      [...(source.snapshot?.questions ?? []), ...(source.snapshot?.approvals ?? [])].map(
        (request) => request.taskId,
      ),
    )
    return source.workspace.tasks
      .filter((task) => !task.example)
      .map((task) => {
        const repository = source.workspace.repositories.find(
          (repo) => repo.id === task.repositoryId,
        )
        return {
          key: taskCollectionKey(source.runtimeId, task.id),
          task,
          source,
          needsInput: input.has(task.id),
          projectKey: taskCollectionKey(source.runtimeId, task.repositoryId),
          projectName:
            task.replica?.projectName ??
            (repository?.kind === 'scratch' ? 'No Project' : (repository?.name ?? 'No Project')),
        }
      })
  })
}

/**
 * Never-started side chat drafts stay in their parent's side chats, search and attention until
 * someone needs to act on them.
 */
export function hiddenSideDraft(entry: Pick<TaskEntry, 'task' | 'needsInput' | 'source'>) {
  return (
    !entry.needsInput &&
    unusedSideDraft(entry.task) &&
    entry.source.workspace.tasks.some((task) => task.id === entry.task.sideThread?.parentTaskId)
  )
}

/** Delegated threads remain navigable, but belong to their parent in list views. */
export function mainTaskEntries(entries: readonly TaskEntry[]): TaskEntry[] {
  return entries.filter((entry) => !entry.task.delegation && !hiddenSideDraft(entry))
}

/** Reuse the previous owner while every row-facing fact is unchanged. */
export function retainTaskOwner(previous: TaskOwner | undefined, source: TaskSource): TaskOwner {
  const acpInstallations = source.snapshot?.acpInstallations ?? []
  const next: TaskOwner = {
    runtimeId: source.runtimeId,
    runtimeIdentity: source.snapshot?.runtimeId ?? source.connection?.runtimeId,
    address: source.address,
    name: source.name,
    online: source.online,
    agents: source.workspace.agents,
    repositories: source.workspace.repositories,
    runtimeIcon: source.snapshot?.runtimeIcon,
    acpInstallations:
      previous && JSON.stringify(previous.acpInstallations) === JSON.stringify(acpInstallations)
        ? previous.acpInstallations
        : acpInstallations,
    threadBehaviorSupported: source.snapshot?.threadBehaviorSupported === true,
    worktreeDeletionOverrideSupported: source.snapshot?.worktreeDeletionOverrideSupported === true,
    threadHandoffsSupported: source.snapshot?.threadHandoffsSupported === true,
  }
  return previous &&
    (Object.keys(next) as (keyof TaskOwner)[]).every((key) => Object.is(previous[key], next[key]))
    ? previous
    : next
}
