import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { randomUUID } from 'expo-crypto'
import { IMPLEMENT_PLAN_PROMPT, planAwaitingApproval, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { Glass } from '../../../ui/layout/glass'
import { designTokens } from '@dovo/design'

/** After a plan-mode reply: approve with one tap, or reply with changes. */
export function PlanApproval({ task }: { task: Task }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  if (!planAwaitingApproval(task)) return null
  return (
    <Glass
      style={{
        borderRadius: designTokens.radius.overlay,
        padding: 12,
        marginHorizontal: 16,
        marginBottom: 6,
        borderColor: colors.accent,
        gap: 8,
      }}
    >
      <Text style={styles.text}>
        <InterfaceText>
          {'The agent proposed a plan. Implement it, or reply with changes.'}
        </InterfaceText>
      </Text>
      <Action
        label={uiText('Implement plan')}
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
    </Glass>
  )
}
