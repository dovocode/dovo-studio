import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState, useRef, useEffect } from 'react'
import { View } from 'react-native'
import { Schema } from 'effect'
import { runAuditSchema } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from '../screens/settings-controls'
import { useAction } from '../ui/controls/use-action'
import { Text } from '../ui/content/text'
import { copyText } from '../ui/content/clipboard'
import { useTheme } from '../ui/theme'

export function RunAudit({ runId }: { runId: string }) {
  const uiText = useInterfaceText()

  const { callEffect, profile, connected } = useRuntime()
  const { styles } = useTheme()
  const { act, error, busy } = useAction()
  const [audit, setAudit] = useState<Schema.Schema.Type<typeof runAuditSchema>>()
  const [offset, setOffset] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setAudit(undefined)
  }, [runId, profile?.id])
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const load = (next: number, output = false) =>
    act(async () => {
      const version = ++generation.current
      const result = await runClientEffect(
        callEffect('/api/jobs/audit', { id: runId, offset: next, output }, runAuditSchema),
      )
      if (version === generation.current) {
        setAudit(result)
        setOffset(next)
      }
    })
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            "Run audit includes this run's workers. Output loads only when requested. Cost is an estimate, not a subscription bill."
          }
        </InterfaceText>
      </Text>
      <Action
        label={uiText('Load run audit')}
        secondary
        disabled={!connected || busy}
        onPress={() => load(0)}
      />
      {error ? <Text style={styles.muted}>{error}</Text> : null}
      {audit && (
        <>
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0: audit.tokens,
                value1: audit.estimatedCostUsd.toFixed(4),
                value2: audit.usageIncomplete ? uiText(' · Some usage is unavailable') : '',
              }}
            >
              {'{value0} reported tokens · ${value1} estimated{value2}'}
            </InterfaceText>
          </Text>
          <Action
            label={uiText('Load output for this page')}
            secondary
            disabled={!connected || busy}
            onPress={() => load(offset, true)}
          />
          <Action
            label={uiText('Copy audit page')}
            secondary
            disabled={busy}
            onPress={() => act(() => copyText(JSON.stringify(audit, null, 2)))}
          />
          <Text selectable style={styles.muted}>
            {JSON.stringify(audit, null, 2)}
          </Text>
          {audit.nextOffset !== undefined && (
            <Action
              label={uiText('Next audit page')}
              secondary
              disabled={!connected || busy}
              onPress={() => {
                if (audit.nextOffset !== undefined) load(audit.nextOffset)
              }}
            />
          )}
        </>
      )}
    </View>
  )
}
