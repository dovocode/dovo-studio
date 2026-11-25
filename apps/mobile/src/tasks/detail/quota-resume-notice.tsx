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
  return (
    <View style={{ padding: 12, gap: 8 }}>
      <Text style={styles.muted}>
        {uiText(
          continuation
            ? continuation.resume
              ? 'Scheduled to resume at {value0}'
              : 'Snoozed until {value0}'
            : 'Rate limit resets at {value0}',
          { value0: new Date(at).toLocaleString() },
        )}
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
