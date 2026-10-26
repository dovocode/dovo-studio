import type { Task } from '@dovo/protocol'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { View } from 'react-native'

export function FailedTaskRetry({ task }: { task: Task }) {
  const { connected, callEffect, snapshot } = useRuntime()
  const { busy, error, act } = useAction()
  const { styles } = useTheme()
  return (
    <View style={{ gap: 8 }}>
      {!!task.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {task.error}
        </Text>
      )}
      {task.status === 'failed' && !task.archived && !task.archivedAt && !task.restartRecovery && (
        <>
          <Action
            secondary
            label={busy ? 'Retrying…' : 'Retry'}
            disabled={
              !connected ||
              busy ||
              !!task.activeRunId ||
              !!snapshot?.runs.some((run) => run.taskIds.includes(task.id))
            }
            onPress={() =>
              act(() => callEffect('/api/tasks/retry-failed', { id: task.id }, responses.ok))
            }
          />
          <Text style={styles.muted}>
            Continue with the current files. Queued messages stay paused.
          </Text>
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
