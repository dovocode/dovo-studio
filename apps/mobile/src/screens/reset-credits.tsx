import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { runtimeComputerName } from '@dovo/protocol'
import { SettingsChoice as Choice } from './settings-controls'
import { useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { resetCreditsSchema, resetCreditResultSchema, type PlanLimit } from '@dovo/protocol'
import type { Schema } from 'effect'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from './settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
export function ResetCredits({ window }: { window: PlanLimit & { sourceId?: string } }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { overviews, readRuntime, refreshRuntime } = useRuntime()
  const sources = overviews.flatMap((entry) => {
    const limit = entry.snapshot?.workspace.planLimits?.find(
      (limit) =>
        limit.account?.id === window.account?.id && (!!limit.sourceTaskId || !!limit.agentId),
    )
    return limit && entry.connected
      ? [
          {
            profile: entry.profile,
            taskId:
              limit.sourceTaskId &&
              entry.snapshot?.workspace.tasks.some((task) => task.id === limit.sourceTaskId)
                ? limit.sourceTaskId
                : undefined,
            agentId: limit.agentId,
          },
        ]
      : []
  })
  const [runtimeId, setRuntimeId] = useState(window.sourceId ?? '')
  const source = sources.find((source) => source.profile.id === runtimeId) ?? sources[0]
  const profile = source?.profile
  const [credits, setCredits] = useState<Schema.Schema.Type<typeof resetCreditsSchema> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState('')
  const attempt = useRef<string | undefined>(undefined)
  const input = { taskId: source?.taskId, agentId: source?.agentId, accountId: window.account?.id }
  const load = async () => {
    if (!profile) return
    const data = await readRuntime(
      profile,
      '/api/usage/resets/read',
      input,
      resetCreditsSchema,
      'POST',
    )
    if (data.pendingAttemptId) attempt.current = data.pendingAttemptId
    setCredits(data)
    await refreshRuntime(profile)
  }
  const check = async () => {
    setBusy(true)
    setError('')
    try {
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const consume = async () => {
    if (!profile || busy) return
    setBusy(true)
    setError('')
    attempt.current ??= randomUUID()
    try {
      const result = await readRuntime(
        profile,
        '/api/usage/resets/consume',
        { ...input, creditId: credits?.credits[0]?.id, idempotencyKey: attempt.current },
        resetCreditResultSchema,
        'POST',
      )
      setOutcome(`Provider result: ${result.outcome}`)
      attempt.current = undefined
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 6 }}>
      {sources.length > 1 && (
        <Choice
          label={uiText('Server for reset')}
          value={profile?.id ?? ''}
          disabled={busy}
          items={sources.map((source) => ({
            id: source.profile.id,
            name: runtimeComputerName(source),
          }))}
          onChange={(id) => {
            setRuntimeId(id)
            setCredits(null)
            setError('')
          }}
        />
      )}
      <Action
        secondary
        label={busy ? uiText('Contacting provider…') : uiText('Check reset credits')}
        disabled={busy || !profile || !window.account || (!source?.taskId && !source?.agentId)}
        onPress={() => void check()}
      />
      {credits && (
        <>
          <Text style={styles.muted}>
            {credits.supported
              ? uiText('{value0} resets available', { value0: credits.availableCount })
              : credits.reason}
          </Text>
          {credits.availableCount > 0 && !credits.credits.length && (
            <Text style={styles.muted}>
              <InterfaceText>{'Credit expiry details not reported.'}</InterfaceText>
            </Text>
          )}
          {credits.credits.map((credit) => (
            <Text key={credit.id} style={styles.muted}>
              {credit.title} ·{' '}
              {credit.expiresAt
                ? uiText('Expires {value0}', {
                    value0: new Date(credit.expiresAt).toLocaleString(),
                  })
                : uiText('Expiry not reported')}
            </Text>
          ))}
          {credits.supported && credits.availableCount > 0 && (
            <Action
              label={uiText('Use reset')}
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  uiText('Use one reset credit?'),
                  uiText(
                    'Redeem a provider reset for {value0}. This spends one credit; local usage history stays intact.',
                    { value0: window.account?.label },
                  ),
                  [
                    { text: uiText('Cancel'), style: 'cancel' },
                    { text: uiText('Use reset'), onPress: () => void consume() },
                  ],
                )
              }
            />
          )}
        </>
      )}
      {!!outcome && <Text style={styles.muted}>{outcome}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
