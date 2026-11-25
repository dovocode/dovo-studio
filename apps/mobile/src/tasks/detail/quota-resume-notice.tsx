import { View } from 'react-native'
import { quotaRetryTurn, responses, type Task } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'

export function QuotaResumeNotice({ task }: { task: Task }) {
  const uiText = useInterfaceText()
  const { colors, styles } = useTheme()
  const { snapshot, connected, activeId, callEffect } = useRuntime()
  const continuation = task.quotaContinuation
  const offer =
    snapshot?.quotaResumeSupported &&
    !continuation?.resume &&
    !snapshot.workspace?.automations?.some((routine) => routine.id === task.origin)
      ? quotaRetryTurn(task, task.turns?.at(-1), Date.now())
      : undefined
  const turnId = offer?.turnId ?? continuation?.turnId
  const at = continuation?.at ?? offer?.at
  const quota = useAction(JSON.stringify([activeId, task.id, turnId]))
  if (!at) return null
  const time = new Date(at).toLocaleString()
  return (
    <View style={{ padding: 12, gap: 8 }}>
      <Text style={styles.muted}>
        {continuation
          ? uiText('{value0} at {value1}', {
              value0: continuation.resume ? uiText('Scheduled to resume') : uiText('Snoozed'),
              value1: time,
            })
          : uiText('Rate limit resets at {value0}', { value0: time })}
      </Text>
      {offer && (
        <Action
          secondary
          label={uiText('Auto-resume after rate limit')}
          disabled={!connected || quota.busy}
          onPress={() =>
            quota.act(() =>
              callEffect(
                '/api/tasks/quota/schedule',
                { id: task.id, turnId: offer.turnId },
                responses.ok,
              ),
            )
          }
        />
      )}
      {continuation && (
        <Action
          secondary
          label={uiText('Cancel quota continuation')}
          disabled={!connected || quota.busy}
          onPress={() =>
            quota.act(() =>
              callEffect(
                '/api/tasks/quota/cancel',
                { id: task.id, turnId: continuation.turnId },
                responses.ok,
              ),
            )
          }
        />
      )}
      {quota.error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {quota.error}
        </Text>
      )}
    </View>
  )
}
