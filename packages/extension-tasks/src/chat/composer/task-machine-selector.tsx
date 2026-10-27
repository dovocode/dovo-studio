import { Schema } from 'effect'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'
import { taskMachineDraft, taskMachineDraftState, taskSchema, type Task } from '@dovo/protocol'
import { taskSources } from '../../list/task-collection'

export async function moveTaskDraft(
  store: ReturnType<typeof useWorkspace>,
  host: ReturnType<typeof useStudioHost>,
  task: Task,
  source: ReturnType<typeof taskSources>[number],
  target: import('@dovo/protocol').Repository,
) {
  const profile = store.runtimeRegistry.profiles.find((item) => item.id === source.runtimeId)
  const origin = store.runtimeRegistry.profiles.find((item) => item.id === store.activeRuntimeId)
  const repository = store.workspace.repositories.find((item) => item.id === task.repositoryId)
  if (!profile || !repository) throw new Error('This machine or project is no longer available.')
  if (!source.online) throw new Error('This machine is offline.')
  if (
    store.snapshot?.checkedDraftMoveSupported !== true ||
    source.snapshot?.checkedDraftMoveSupported !== true
  )
    throw new Error(
      'Update Dovo on both computers before moving drafts. The source draft has been preserved.',
    )
  await store.flush()
  await store.readRuntime(
    profile,
    '/api/tasks/draft-receive',
    {
      task: taskMachineDraft(task, target, source.snapshot?.defaults, store.workspace.agents),
      gitIdentity: target.gitIdentity ?? '',
      projectKind: target.kind,
    },
    taskSchema,
  )
  const request: typeof store.request = origin
    ? (path, input, schema, method) => store.readRuntime(origin, path, input, schema, method)
    : store.request
  await request(
    '/api/tasks/draft-moved',
    {
      id: task.id,
      repositoryId: task.repositoryId,
      draft: task.draft,
      expected: taskMachineDraftState(task),
      gitIdentity: repository.gitIdentity ?? '',
      projectKind: repository.kind,
    },
    Schema.Struct({ ok: Schema.Boolean }),
  )
  // Read the received draft before opening it, without waiting for unrelated servers or PRs.
  await store.refreshRuntime(profile)
  await store.switchRuntime(profile.id)
  host.navigate({ viewId: 'tasks', entityId: task.id })
  if (origin)
    void store.refreshRuntime(origin).catch((error: unknown) => {
      console.error('Could not refresh the source server after moving the draft', error)
    })
}
