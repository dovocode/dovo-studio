import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { z } from 'zod'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { BranchPicker } from '../scm/branch-picker'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { HarnessSettings } from './harness-settings'
import { LifecycleActions } from './lifecycle-actions'
import { TaskSource } from './task-source'
export function TaskSettings({
  task,
  onBack,
  onBusyChange,
}: {
  task: Task
  onBack: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { call, connected } = useRuntime(),
    { act, busy, error } = useAction()
  const [title, setTitle] = useState(task.title),
    [harness, setHarness] = useState(false),
    [harnessBusy, setHarnessBusy] = useState(false)
  useEffect(() => {
    onBusyChange(busy || harnessBusy)
    return () => onBusyChange(false)
  }, [busy, harnessBusy, onBusyChange])
  if (harness)
    return (
      <View style={{ gap: 12 }}>
        <View style={styles.row}>
          <Action
            secondary
            label="Back"
            disabled={harnessBusy}
            onPress={() => {
              if (!harnessBusy) setHarness(false)
            }}
          />
          <Text accessibilityRole="header" style={styles.text}>
            Agent & model
          </Text>
        </View>
        <HarnessSettings
          inline
          task={task}
          onClose={() => setHarness(false)}
          onBusyChange={setHarnessBusy}
        />
      </View>
    )
  return (
    <View style={{ gap: 16 }}>
      <TaskSource task={task} onNavigate={onBack} />
      <Field label="Task title" value={title} editable={!busy} onChangeText={setTitle} />
      <Action
        label="Save task settings"
        disabled={!connected || busy || !title.trim()}
        onPress={() =>
          act(async () => {
            await call(
              '/api/workspace',
              {
                collection: 'tasks',
                id: task.id,
                changes: { title: { before: task.title, after: title.trim() } },
              },
              z.object({ revision: z.number() }),
              'PATCH',
            )
            onBack()
          })
        }
      />
      <Action
        secondary
        label="Agent & model"
        disabled={task.status === 'running' || busy || !connected}
        onPress={() => setHarness(true)}
      />
      <BranchPicker repositoryId={task.repositoryId} taskId={task.id} />
      <LifecycleActions task={task} />
      {task.sessionId && (
        <Action
          secondary
          label="New session"
          disabled={!connected || busy || task.status === 'running'}
          onPress={() => act(() => call('/api/tasks/new-session', { id: task.id }, responses.ok))}
        />
      )}
      {task.status === 'running' && (
        <Text style={styles.muted}>
          Stop the active turn to change models or start a new session.
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
