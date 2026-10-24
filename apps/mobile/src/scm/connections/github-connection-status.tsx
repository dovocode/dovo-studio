import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import {
  githubConnectionCheckSchema,
  RuntimeRequestError,
  type GithubConnectionCheck,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function GithubConnectionStatus({
  connectionId,
  repositoryId,
  automatic = false,
}: {
  connectionId?: string
  repositoryId?: string
  automatic?: boolean
}) {
  const { read, connected } = useRuntime()
  const { styles } = useTheme()
  const [result, setResult] = useState<GithubConnectionCheck | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null)
  const pending = useRef(false)
  useEffect(() => {
    setResult(null)
    setLastVerifiedAt(null)
  }, [read, connectionId, repositoryId])
  useEffect(() => {
    let current = true
    setError('')
    setBusy(false)
    pending.current = false
    // Opening settings checks identity; repository and Actions permissions are explicit.
    if (!connected || (repositoryId && !attempt)) return
    pending.current = true
    setBusy(true)
    void read(
      '/api/scm/connections/github/read',
      { connectionId, repositoryId, refresh: attempt > 0 },
      githubConnectionCheckSchema,
    )
      .then((value) => {
        if (!current) return
        setResult(value)
        if (value.status === 'verified') setLastVerifiedAt(value.checkedAt)
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof RuntimeRequestError && [404, 405].includes(cause.status ?? 0)
              ? 'Connection diagnostics are unavailable. Refresh accounts or update this computer’s runtime.'
              : cause instanceof Error
                ? cause.message
                : String(cause),
          )
      })
      .finally(() => {
        if (current) {
          pending.current = false
          setBusy(false)
        }
      })
    return () => {
      current = false
    }
  }, [read, connected, connectionId, repositoryId, attempt])
  const status = !connected
    ? 'Computer offline · Reconnect to verify this connection.'
    : busy
      ? 'Checking GitHub connection…'
      : error ||
        (!result
          ? repositoryId
            ? 'Repository and Actions access have not been tested.'
            : 'Account has not been verified.'
          : '')
  return (
    <View
      accessibilityLabel="GitHub connection status"
      accessibilityState={{ busy }}
      style={{ gap: 8, padding: 16 }}
    >
      <Text
        accessibilityRole={error ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={!status}
        importantForAccessibility={status ? 'auto' : 'no-hide-descendants'}
        style={[error ? styles.error : styles.muted, { minHeight: 16, opacity: status ? 1 : 0 }]}
      >
        {status || 'Checking GitHub connection…'}
      </Text>
      {result && (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={
            connected && !busy && !error && result.status === 'failed' ? 'alert' : undefined
          }
          style={result.status === 'failed' ? styles.error : styles.muted}
        >
          {`${result.login ? `@${result.login} · ${result.host}\n` : ''}${result.repository ? `${result.repository}\n` : ''}${result.message}\nChecked ${new Date(result.checkedAt).toLocaleString()}`}
        </Text>
      )}
      {lastVerifiedAt && (error || result?.status !== 'verified') && (
        <Text style={styles.muted}>
          Last successful check {new Date(lastVerifiedAt).toLocaleString()}
        </Text>
      )}
      {!repositoryId && (
        <Text style={styles.muted}>Account checked in the runtime default context.</Text>
      )}
      <Action
        variant="outline"
        label={repositoryId ? 'Test project connection' : 'Test connection'}
        disabled={!connected || busy}
        onPress={() => {
          if (pending.current) return
          pending.current = true
          setAttempt((value) => value + 1)
        }}
      />
      {automatic && (
        <Text style={styles.muted}>
          Uses GitHub CLI on this computer. A project checkout can resolve a different account.
        </Text>
      )}
    </View>
  )
}
