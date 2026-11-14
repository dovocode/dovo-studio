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
        Run audit includes this run's workers. Output loads only when requested. Cost is an
        estimate, not a subscription bill.
      </Text>
      <Action
        label="Load run audit"
        secondary
        disabled={!connected || busy}
        onPress={() => load(0)}
      />
      {error ? <Text style={styles.muted}>{error}</Text> : null}
      {audit && (
        <>
          <Text style={styles.muted}>
            {audit.tokens} reported tokens · ${audit.estimatedCostUsd.toFixed(4)} estimated
            {audit.usageIncomplete ? ' · Some usage is unavailable' : ''}
          </Text>
          <Action
            label="Load output for this page"
            secondary
            disabled={!connected || busy}
            onPress={() => load(offset, true)}
          />
          <Action
            label="Copy audit page"
            secondary
            disabled={busy}
            onPress={() => act(() => copyText(JSON.stringify(audit, null, 2)))}
          />
          <Text selectable style={styles.muted}>
            {JSON.stringify(audit, null, 2)}
          </Text>
          {audit.nextOffset !== undefined && (
            <Action
              label="Next audit page"
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
