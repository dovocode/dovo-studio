import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { IMPLEMENT_PLAN_PROMPT, planAwaitingApproval, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { colors, styles } from '../../../ui/theme'

/** After a plan-mode reply: approve with one tap, or reply with changes. */
export function PlanApproval({ task }: { task: Task }) {
  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  if (!planAwaitingApproval(task)) return null
  return (
    <View
      style={[
        styles.card,
        { marginHorizontal: 16, marginBottom: 6, borderColor: colors.accent, gap: 8 },
      ]}
    >
      <Text style={styles.text}>
        The agent proposed a plan. Implement it, or reply with changes.
      </Text>
      <Action
        label="Implement plan"
        disabled={!connected || busy}
        onPress={() =>
          act(() =>
            callEffect(
              '/api/tasks/message',
              { id: task.id, messageId: randomUUID(), text: IMPLEMENT_PLAN_PROMPT },
              responses.ok,
            ),
          )
        }
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
