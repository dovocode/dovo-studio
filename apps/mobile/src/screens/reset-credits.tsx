import { Choice } from '../ui/controls/choice'
import { useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { resetCreditsSchema, resetCreditResultSchema, type PlanLimit } from '@dovo/protocol'
import type { Schema } from 'effect'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { styles } from '../ui/theme'
export function ResetCredits({ window }: { window: PlanLimit & { sourceId?: string } }) {
  const { overviews, readRuntime, refreshRuntime } = useRuntime()
  const sources = overviews.flatMap((entry) => {
    const limit = entry.snapshot?.workspace.planLimits?.find(
      (limit) => limit.account?.id === window.account?.id && !!limit.sourceTaskId,
    )
    return limit ? [{ profile: entry.profile, taskId: limit.sourceTaskId }] : []
  })
  const [runtimeId, setRuntimeId] = useState(window.sourceId ?? '')
  const source = sources.find((source) => source.profile.id === runtimeId) ?? sources[0]
  const profile = source?.profile
  const [credits, setCredits] = useState<Schema.Schema.Type<typeof resetCreditsSchema> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState('')
  const attempt = useRef<string | undefined>(undefined)
  const input = { taskId: source?.taskId, accountId: window.account?.id }
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
          label="Server for reset"
          value={profile?.id ?? ''}
          disabled={busy}
          items={sources.map((source) => ({ id: source.profile.id, name: source.profile.name }))}
          onChange={(id) => {
            setRuntimeId(id)
            setCredits(null)
            setError('')
          }}
        />
      )}
      <Action
        secondary
        label={busy ? 'Contacting provider…' : 'Check reset credits'}
        disabled={busy || !profile || !window.account || !source?.taskId}
        onPress={() => void check()}
      />
      {credits && (
        <>
          <Text style={styles.muted}>
            {credits.supported ? `${credits.availableCount} resets available` : credits.reason}
          </Text>
          {credits.availableCount > 0 && !credits.credits.length && (
            <Text style={styles.muted}>Credit expiry details not reported.</Text>
          )}
          {credits.credits.map((credit) => (
            <Text key={credit.id} style={styles.muted}>
              {credit.title} ·{' '}
              {credit.expiresAt
                ? `Expires ${new Date(credit.expiresAt).toLocaleString()}`
                : 'Expiry not reported'}
            </Text>
          ))}
          {credits.supported && credits.availableCount > 0 && (
            <Action
              label="Use reset"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  'Use one reset credit?',
                  `Redeem a provider reset for ${window.account?.label}. This spends one credit; local usage history stays intact.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Use reset', onPress: () => void consume() },
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
