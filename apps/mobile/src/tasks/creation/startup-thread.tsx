import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  nextThreadDraft,
  defaultTaskProjectSelection,
  resolveTaskDefaults,
  taskMachineDraft,
  type Task,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { TaskDetail } from '../detail/task-detail'
import { saveRuntimeDraft } from '../draft/use-draft'
import { FolderPicker } from './folder-picker'
import { useNavigation } from '../../shell/navigation'
import { TemporaryTaskRuntime } from './temporary-task-runtime'

export function StartupThread({
  onCommit,
  onDraft,
  onBrowse,
  onNewThread,
  taskId,
  runtimeId: initialRuntimeId,
}: {
  onDraft?: (runtimeId: string, taskId: string) => void
  onCommit: (runtimeId: string, taskId: string) => void
  onBrowse: () => void
  onNewThread: () => void
  taskId: string
  runtimeId: string
}) {
  const { styles } = useTheme()

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { focused } = useNavigation()
  const lifecycle = useRef({ focused, generation: 0 })
  if (lifecycle.current.focused !== focused) {
    lifecycle.current = { focused, generation: lifecycle.current.generation + 1 }
  }
  const backgroundTask = useRef<object | null>(null)
  const backgroundDraft = useRef<{ taskId: string; attemptId: string; next: Task } | null>(null)
  const currentTask = useRef(taskId)
  const runtime = useRuntime()
  const [selection, setSelection] = useState<{ runtimeId: string; task: Task } | null>(() => {
    const task = runtime.overviews
      .find((entry) => entry.profile.id === initialRuntimeId)
      ?.snapshot?.workspace.tasks.find((item) => item.id === taskId)
    return task ? { runtimeId: initialRuntimeId, task } : null
  })
  const selected =
    runtime.overviews.find((entry) => entry.profile.id === initialRuntimeId) ??
    runtime.overviews.find((entry) => entry.connected && entry.profile.id === runtime.activeId) ??
    runtime.overviews.find((entry) => entry.connected)
  const runtimeId = selection?.runtimeId ?? selected?.profile.id ?? ''
  const entry = runtime.overviews.find((item) => item.profile.id === runtimeId)
  const repository = entry?.snapshot?.workspace.repositories.find((item) => item.kind === 'scratch')
  const [id] = useState(() => taskId)
  const task: Task | null =
    selection?.task ??
    (repository
      ? {
          ...resolveTaskDefaults(entry?.snapshot?.defaults, repository),
          ...defaultTaskProjectSelection(entry?.snapshot, repository),
          id,
          title: 'New thread',
          repositoryId: repository.id,
          agentId: '',
          status: 'draft',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        }
      : null)
  currentTask.current = task?.id ?? taskId
  if (!entry?.snapshot)
    return (
      <View style={styles.content}>
        <Text style={styles.title}>Connect a computer</Text>
        <Text style={styles.muted}>A computer needs to be online to start a thread.</Text>
        <Action label="Browse tasks" secondary onPress={onBrowse} />
      </View>
    )
  return (
    <RuntimeScope runtimeId={runtimeId}>
      {task ? (
        <TemporaryTaskRuntime
          key={`${runtimeId}:${task.id}`}
          task={task}
          onCommit={(created) => {
            if (backgroundTask.current || !mounted.current || !lifecycle.current.focused)
              return false
            onCommit(runtimeId, created.id)
          }}
        >
          {(draft, temporary) => (
            <TaskDetail
              task={draft}
              onBack={onBrowse}
              startup={{
                temporary,
                onStartInBackground: (configuration, attemptId) => {
                  // A retry may observe an already resolved automatic project/model selection.
                  // Keep the choices captured before the first dispatch of this message.
                  if (
                    backgroundDraft.current?.taskId !== draft.id ||
                    backgroundDraft.current.attemptId !== attemptId
                  )
                    backgroundDraft.current = {
                      taskId: draft.id,
                      attemptId,
                      next: nextThreadDraft(configuration, randomUUID()),
                    }
                  const next = backgroundDraft.current.next
                  const token = {}
                  backgroundTask.current = token
                  const generation = lifecycle.current.generation
                  const active = () =>
                    mounted.current &&
                    lifecycle.current.focused &&
                    lifecycle.current.generation === generation &&
                    currentTask.current === draft.id &&
                    backgroundTask.current === token
                  return {
                    confirmed: () => {
                      if (!active()) return
                      currentTask.current = next.id
                      setSelection({ runtimeId, task: next })
                      onDraft?.(runtimeId, next.id)
                    },
                    settled: () => {
                      if (backgroundTask.current === token) backgroundTask.current = null
                    },
                  }
                },
                onNewThread,
                onSelectRemote: async (
                  targetId,
                  target,
                  text,
                  autoProject,
                  autoProjectExecution,
                ) => {
                  const destination = runtime.overviews.find((item) => item.profile.id === targetId)
                  if (!destination?.connected) throw new Error('This computer is offline.')
                  const next = taskMachineDraft(
                    { ...draft, draft: text, autoProject, autoProjectExecution },
                    target,
                    destination.snapshot?.defaults,
                    entry.snapshot?.workspace.agents,
                  )
                  await saveRuntimeDraft(targetId, next.id, text)
                  setSelection({ runtimeId: targetId, task: next })
                },
              }}
            />
          )}
        </TemporaryTaskRuntime>
      ) : (
        <View style={styles.content}>
          <Text style={styles.title}>Choose a folder</Text>
          <FolderPicker
            repositories={entry.snapshot.workspace.repositories}
            value=""
            disabled={!entry.connected}
            onChange={(_id, target, targetId) => {
              const destination = runtime.overviews.find((item) => item.profile.id === targetId)
              setSelection({
                runtimeId: targetId,
                task: {
                  ...resolveTaskDefaults(destination?.snapshot?.defaults, target),
                  id,
                  title: 'New thread',
                  repositoryId: target.id,
                  agentId: '',
                  status: 'draft',
                  createdAt: new Date().toISOString(),
                  messages: [],
                  files: [],
                  draft: '',
                  example: false,
                },
              })
            }}
          />
          <Action label="Browse tasks" secondary onPress={onBrowse} />
        </View>
      )}
    </RuntimeScope>
  )
}
