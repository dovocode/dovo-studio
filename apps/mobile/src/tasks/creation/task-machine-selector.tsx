import { Schema } from 'effect'
import { View } from 'react-native'
import {
  canChangeTaskCheckout,
  taskMachineDraft,
  taskMachineDraftState,
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
  onAuto,
  onSelectRemote,
}: {
  task: Task
  text: string
  disabled: boolean
  onMoving: (moving: boolean) => void
  onAuto: () => Promise<void>
  onProjectChange: (repository: Repository, preserveAuto?: boolean) => Promise<void>
  onSelectRemote?: (
    runtimeId: string,
    repository: Repository,
    text: string,
    autoProject?: boolean,
    autoProjectExecution?: Task['autoProjectExecution'],
  ) => Promise<void>
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
        autoProject={task.autoProject}
        onAuto={runtime.snapshot?.autoProjectSelectionEnabled === true ? onAuto : undefined}
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
        onChange={async (_id, target, runtimeId, preserveAuto) => {
          if (runtimeId === runtime.activeId) {
            await onProjectChange(target, preserveAuto)
            return
          }
          if (onSelectRemote) {
            await onSelectRemote(
              runtimeId,
              target,
              text,
              preserveAuto ? task.autoProject : undefined,
              preserveAuto ? task.autoProjectExecution : undefined,
            )
            return
          }
          const destination = runtime.overviews.find((entry) => entry.profile.id === runtimeId)
          const origin = runtime.profile
          if (!destination?.connected || !origin || !repository)
            throw new Error('This machine or project is unavailable.')
          if (
            runtime.snapshot?.checkedDraftMoveSupported !== true ||
            destination.snapshot?.checkedDraftMoveSupported !== true
          )
            throw new Error(
              'Update Dovo on both computers before moving drafts. The source draft has been preserved.',
            )
          const next = taskMachineDraft(
            { ...task, draft: text, autoProject: preserveAuto ? task.autoProject : undefined },
            target,
            destination.snapshot?.defaults,
            runtime.snapshot?.workspace.agents,
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
              expected: taskMachineDraftState(task),
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
