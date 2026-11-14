import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import { botMemoryStatusSchema } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { useAction } from '../ui/controls/use-action'
import { useTheme } from '../ui/theme'

type Status = typeof botMemoryStatusSchema.Type
export function BotMemoryLearning({
  taskId,
  onChanged,
}: {
  taskId: string
  onChanged: () => void
}) {
  const uiText = useInterfaceText()

  const { connected, snapshot, callEffect } = useRuntime()
  const { styles } = useTheme()
  const [status, setStatus] = useState<Status>()
  const [confirmClear, setConfirmClear] = useState(false)
  const { act, busy, error } = useAction()
  const mounted = useRef(true)
  const supported = snapshot?.botMemoryReviewSupported === true
  useEffect(() => {
    mounted.current = true
    if (connected && supported)
      act(async () => {
        const value = await runClientEffect(
          callEffect('/api/memory/bot-review/read', { botId: taskId }, botMemoryStatusSchema),
        )
        if (mounted.current) setStatus(value)
      })
    return () => {
      mounted.current = false
    }
  }, [connected, supported, taskId])
  const run = (action: 'save' | 'run' | 'clear') =>
    act(async () => {
      if (!status) return
      try {
        const next = await runClientEffect(
          callEffect(
            `/api/memory/bot-review/${action}`,
            {
              botId: taskId,
              ...(action === 'run' ? {} : { expectedRevision: status.revision }),
              ...(action === 'save' ? { enabled: !status.enabled } : {}),
            },
            botMemoryStatusSchema,
          ),
        )
        if (mounted.current) {
          setStatus(next)
          setConfirmClear(false)
          onChanged()
        }
      } catch (cause) {
        try {
          const next = await runClientEffect(
            callEffect('/api/memory/bot-review/read', { botId: taskId }, botMemoryStatusSchema),
          )
          if (mounted.current) setStatus(next)
        } catch {
          /* Retain saved settings while offline. */
        }
        throw cause
      }
    })
  if (!supported) return null
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <Text style={styles.title}>
        <InterfaceText>{'Background learning'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Reviews your messages after 20 completed turns, or after 15 idle minutes with 3 new turns. Uses the utility model in Settings → Agents with tools off. Your edits take priority. Reset keeps memory.'
          }
        </InterfaceText>
      </Text>
      <Text>
        {status?.running
          ? uiText('Review in progress')
          : status?.lastReviewedAt
            ? uiText('Last reviewed {value0}', {
                value0: new Date(status.lastReviewedAt).toLocaleString(),
              })
            : uiText('No reviews yet')}
      </Text>
      <Action
        secondary
        label={status?.enabled ? uiText('Pause learning') : uiText('Enable learning')}
        disabled={!connected || !status || busy}
        onPress={() => run('save')}
      />
      <Action
        secondary
        label={uiText('Review now')}
        disabled={!connected || !status?.enabled || busy || status.running}
        onPress={() => run('run')}
      />
      {confirmClear && (
        <Text>
          <InterfaceText>
            {
              'Delete all saved notes? Earlier messages will not be reviewed again. The conversation, files and actions stay.'
            }
          </InterfaceText>
        </Text>
      )}
      <Action
        secondary
        label={confirmClear ? uiText('Confirm clear memory') : uiText('Clear memory')}
        disabled={!connected || !status || busy}
        onPress={() => {
          if (!confirmClear) {
            setConfirmClear(true)
            return
          }
          run('clear')
        }}
      />
      {confirmClear && (
        <Action secondary label={uiText('Cancel clear')} onPress={() => setConfirmClear(false)} />
      )}
      {!!(error || status?.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || status?.error}
        </Text>
      )}
    </View>
  )
}
