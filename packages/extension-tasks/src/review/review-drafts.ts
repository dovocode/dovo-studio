import { useWorkDraftText } from '@dovo/extension-scm/work-drafts'
import { useWorkspace, type Task } from '@dovo/studio-core'
import { runtimeRecoveryScope } from '@dovo/protocol'

/** Keep unsent Changes text across tray, file and surface unmounts. Never evict dirty text. */
export function useReviewDraftText(task: Task, field: string, initial = '') {
  const { connection, workspace } = useWorkspace()
  const repository = workspace.repositories.find((item) => item.id === task.repositoryId)
  const key = JSON.stringify([
    'task-review',
    runtimeRecoveryScope(connection),
    task.id,
    task.repositoryId,
    repository?.path,
    task.execution,
    task.existingWorktreePath,
    task.checkoutBranch,
  ])
  return useWorkDraftText(key, field, initial)
}
