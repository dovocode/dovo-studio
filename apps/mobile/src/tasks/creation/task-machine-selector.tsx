import { Schema } from 'effect'
import { View } from 'react-native'
import {
  canChangeTaskCheckout,
  taskMachineDraft,
  taskSchema,
  type Task,
  type Repository,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { FolderPicker } from './folder-picker'
import { saveRuntimeDraft } from '../draft/use-draft'

export function TaskMachineSelector({
  task,
  text,
  disabled,
  onMoving,
  onProjectChange,
  onSelectRemote,
}: {
  task: Task
  text: string
  disabled: boolean
  onMoving: (moving: boolean) => void
  onProjectChange: (repository: Repository) => Promise<void>
  onSelectRemote?: (runtimeId: string, repository: Repository, text: string) => Promise<void>
}) {
  const runtime = useRuntime()
  const { navigate } = useNavigation()
  const repository = runtime.snapshot?.workspace.repositories.find(
    (repo) => repo.id === task.repositoryId,
  )
  return (
    <View style={{ gap: 4 }}>
      <FolderPicker
        stacked
        value={task.repositoryId}
        repositories={runtime.snapshot?.workspace.repositories ?? []}
        disabled={
          disabled ||
          !canChangeTaskCheckout(task) ||
          !!task.archivedAt ||
          !!task.draftAttachments?.length ||
          !!task.pullRequest ||
          !!task.workItem
        }
        onMoving={onMoving}
        onChange={async (_id, target, runtimeId) => {
          if (runtimeId === runtime.activeId) {
            await onProjectChange(target)
            return
          }
          if (onSelectRemote) {
            await onSelectRemote(runtimeId, target, text)
            return
          }
          const destination = runtime.overviews.find((entry) => entry.profile.id === runtimeId)
          const origin = runtime.profile
          if (!destination?.connected || !origin || !repository)
            throw new Error('This machine or project is unavailable.')
          const next = taskMachineDraft(
            { ...task, draft: text },
            target,
            destination.snapshot?.defaults,
          )
          await runtime.readRuntime(
            destination.profile,
            '/api/tasks/draft-receive',
            { task: next, gitIdentity: target.gitIdentity ?? '', projectKind: target.kind },
            taskSchema,
          )
          await saveRuntimeDraft(runtimeId, task.id, text)
          await runtime.readRuntime(
            origin,
            '/api/tasks/draft-moved',
            {
              id: task.id,
              repositoryId: task.repositoryId,
              draft: task.draft,
              gitIdentity: repository.gitIdentity ?? '',
              projectKind: repository.kind,
            },
            Schema.Struct({ ok: Schema.Boolean }),
          )
          await runtime.refreshRuntime(destination.profile)
          navigate('tasks', task.id, runtimeId)
          void runtime.refreshRuntime(origin).catch((error: unknown) => {
            console.error('Could not refresh the source server after moving the draft', error)
          })
        }}
      />
    </View>
  )
}
