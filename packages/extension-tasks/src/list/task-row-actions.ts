import { decode, workspacePatchResultSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  sameWorkspaceFields,
  useWorkspaceSelector,
  type Repository,
  type Task,
  type WorkspaceContextValue,
} from '@dovo/studio-core'
import type { TaskSource } from './task-collection'
export type TaskRowChanges = Partial<
  Pick<
    Task,
    | 'settleBehavior'
    | 'archiveAfterSettledDays'
    | 'title'
    | 'pinned'
    | 'archived'
    | 'snoozedUntil'
    | 'agentId'
    | 'agentOverrides'
    | 'harness'
  >
>

/** Patch only the requested fields, with their original values as conflict guards. */
export function taskRowPatch(task: Task, updates: TaskRowChanges) {
  const before = decode(Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)), task)
  const after = decode(Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)), updates)
  const changes: Record<
    string,
    {
      before: unknown
      after: unknown
    }
  > = {}
  for (const [field, value] of Object.entries(after))
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(value ?? null))
      changes[field] = {
        before: before[field] ?? null,
        after: value ?? null,
      }
  return {
    collection: 'tasks' as const,
    id: task.id,
    changes,
  }
}
type Store = Pick<
  WorkspaceContextValue,
  | 'activeRuntimeId'
  | 'connection'
  | 'previewTask'
  | 'runtimeRegistry'
  | 'request'
  | 'readRuntime'
  | 'refreshRuntime'
  | 'refreshRuntimes'
>
type TaskActionStore = Store & Pick<WorkspaceContextValue, 'setWorkspace'>
const taskActionStore = ({
  activeRuntimeId,
  connection,
  previewTask,
  runtimeRegistry,
  request,
  readRuntime,
  refreshRuntime,
  refreshRuntimes,
  setWorkspace,
}: WorkspaceContextValue): TaskActionStore => ({
  activeRuntimeId,
  connection,
  previewTask,
  runtimeRegistry,
  request,
  readRuntime,
  refreshRuntime,
  refreshRuntimes,
  setWorkspace,
})
/** Row actions do not change while a snapshot streams, so rows need not re-render with it. */
export function useTaskActionStore() {
  return useWorkspaceSelector(taskActionStore, sameWorkspaceFields)
}
type TaskActionOwner = Pick<TaskSource, 'runtimeId' | 'name' | 'online'>

/** Capture the row's owner before starting an action, even if the active device changes. */
export function taskActionClient(store: Store, source: TaskActionOwner) {
  const profile = store.runtimeRegistry.profiles.find((entry) => entry.id === source.runtimeId)
  const active = source.runtimeId === store.activeRuntimeId
  const request: Store['request'] = (path, input, schema, method) => {
    if (!source.online) return Promise.reject(new Error(`${source.name} is offline.`))
    if (active) return store.request(path, input, schema, method)
    if (!profile) return Promise.reject(new Error('This task’s computer is no longer connected.'))
    return store.readRuntime(profile, path, input, schema, method)
  }
  const refresh = () => (profile ? store.refreshRuntime(profile) : store.refreshRuntimes())
  return {
    profile,
    request,
    refresh,
    patch: async (task: Task, updates: TaskRowChanges) => {
      const input = taskRowPatch(task, updates)
      if (!Object.keys(input.changes).length) return
      const apply = async () => {
        const result = await request('/api/workspace', input, workspacePatchResultSchema, 'PATCH')
        try {
          await refresh()
        } catch {
          // The write committed. refreshRuntime already exposes the connection error;
          // do not report this as a rejected edit or invite a duplicate mutation.
        }
        return result
      }
      const connection = profile?.connection ?? (active ? store.connection : null)
      if (connection) await store.previewTask(connection, task.id, updates, apply)
      else await apply()
    },
  }
}
export function taskRowValues(task: Task, repositories: readonly Repository[]) {
  const repository = repositories.find((entry) => entry.id === task.repositoryId)
  return {
    repository,
    branch:
      task.checkoutBranch ??
      (task.execution === 'worktree' ? task.turns?.at(-1)?.branch : repository?.branch) ??
      '',
    titlePrompt: task.messages.find((message) => message.role === 'user')?.text.trim() ?? '',
  }
}
