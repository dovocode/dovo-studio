import { useCallback } from 'react'
import { View } from 'react-native'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting } from '@dovo/studio-core'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function TaskWaitingPanel({ taskId }: { taskId: string }) {
  const { call, connected } = useRuntime()
  const { styles, colors } = useTheme()
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      call('/api/tasks/waiting', input, taskWaitingSchema),
    [call],
  )
  const { data, error, busy, refresh } = useTaskWaiting(taskId, connected, read)
  return (
    <View accessibilityLabel="Waiting for" style={{ padding: 12, gap: 8 }}>
      <Text style={styles.text}>Waiting for</Text>
      <Text style={styles.muted}>Unlink stops monitoring this item for this thread.</Text>
      {!connected && <Text style={styles.muted}>Connect the runtime to manage waiting items.</Text>}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {!data && connected && !error && <Text style={styles.muted}>Loading waiting items…</Text>}
      {data?.dependencies.length === 0 && (
        <Text style={styles.muted}>No active waiting items.</Text>
      )}
      {data?.dependencies.map((item) => (
        <View
          key={JSON.stringify([item.kind, item.repositoryId, item.target])}
          style={{ gap: 4, paddingVertical: 8 }}
        >
          <Text style={styles.text}>
            {item.project} · {item.label}
          </Text>
          <Text style={styles.muted}>{item.status}</Text>
          <Text style={styles.muted}>{item.url}</Text>
          {item.error && <Text style={{ color: colors.error }}>{item.error}</Text>}
          <Action
            secondary
            label={`Unlink ${item.label}`}
            disabled={!connected || busy}
            onPress={() =>
              refresh({ kind: item.kind, repositoryId: item.repositoryId, target: item.target })
            }
          />
        </View>
      ))}
      <Action
        secondary
        label="Refresh waiting items"
        disabled={!connected || busy}
        onPress={() => refresh()}
      />
    </View>
  )
}
