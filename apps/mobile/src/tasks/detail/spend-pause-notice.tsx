import { View } from 'react-native'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { formatSpendUsd, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'

/** New unattended work in this thread waits at the computer's spend limit. */
export function SpendPauseNotice({ task }: { task: Task }) {
  const uiText = useInterfaceText()
  const { connected, callEffect } = useRuntime()
  const { colors, styles } = useTheme()
  const action = useAction()
  const pause = task.spendPause
  if (!pause) return null
  const unpriced =
    pause.unpricedTurns === 1
      ? uiText('1 turn has no price, so the total is unknown.')
      : pause.unpricedTurns
        ? uiText('{value0} turns have no price, so the total is unknown.', {
            value0: pause.unpricedTurns,
          })
        : ''
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 12, gap: 8 }}>
      <Text style={styles.muted}>
        {[
          uiText(
            'Paused: spend limit. {value0} estimated since your last message (limit {value1}).',
            {
              value0: formatSpendUsd(pause.spentUsd),
              value1: formatSpendUsd(pause.limitUsd),
            },
          ),
          unpriced,
          uiText('Costs are estimates. Continue starts the held work.'),
        ]
          .filter(Boolean)
          .join(' ')}
      </Text>
      <Action
        secondary
        label={uiText('Continue')}
        disabled={!connected || action.busy}
        onPress={() =>
          action.act(() =>
            callEffect('/api/tasks/spend-limit/continue', { id: task.id }, responses.ok),
          )
        }
      />
      {!!action.error && <Text style={{ color: colors.error }}>{action.error}</Text>}
    </View>
  )
}
