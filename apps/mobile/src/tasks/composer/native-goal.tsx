import { useState } from 'react'
import { View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { type Task, responses } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function NativeGoal({ task }: { task: Task }) {
  const { call, connected } = useRuntime()
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const goal = task.nativeGoal
  if (!goal || goal.sessionId !== task.sessionId) return null
  const act = async (action: string) => {
    setBusy(true)
    setError('')
    try {
      await call(
        '/api/tasks/message',
        { id: task.id, messageId: Crypto.randomUUID(), text: `/goal ${action}`, attachmentIds: [] },
        responses.ok,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View
      accessibilityLabel={uiText('Native goal')}
      style={{ gap: 6, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}
    >
      <Text style={styles.muted}>
        {uiText('Goal')} · {uiText(goal.status)} · {goal.rounds}
      </Text>
      <Text selectable>{goal.objective}</Text>
      {goal.reason && <Text style={styles.muted}>{goal.reason}</Text>}
      {task.status === 'running' ? (
        <Text style={styles.muted}>{uiText('Stop the turn to pause this goal.')}</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            ...(goal.status === 'paused' ? ['resume'] : goal.status === 'active' ? ['pause'] : []),
            'clear',
          ].map((action) => (
            <Action
              key={action}
              secondary
              disabled={busy || !connected}
              onPress={() => void act(action)}
              label={uiText(
                action === 'resume'
                  ? 'Resume goal'
                  : action === 'pause'
                    ? 'Pause goal'
                    : 'Clear goal',
              )}
            />
          ))}
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
