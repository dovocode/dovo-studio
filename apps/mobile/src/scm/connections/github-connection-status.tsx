import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

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
              ? uiText(
                  'Connection diagnostics are unavailable. Refresh accounts or update this computer’s runtime.',
                )
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
      accessibilityLabel={uiText('GitHub connection status')}
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
        {status || uiText('Checking GitHub connection…')}
      </Text>
      {result && (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={
            connected && !busy && !error && result.status === 'failed' ? 'alert' : undefined
          }
          style={result.status === 'failed' ? styles.error : styles.muted}
        >
          {uiText('{value0}{value1}{value2}\nChecked {value3}', {
            value0: result.login ? `@${result.login} · ${result.host}\n` : '',
            value1: result.repository ? `${result.repository}\n` : '',
            value2: result.message,
            value3: new Date(result.checkedAt).toLocaleString(),
          })}
        </Text>
      )}
      {lastVerifiedAt && (error || result?.status !== 'verified') && (
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: new Date(lastVerifiedAt).toLocaleString() }}>
            {'Last successful check {value0}'}
          </InterfaceText>
        </Text>
      )}
      {!repositoryId && (
        <Text style={styles.muted}>
          <InterfaceText>{'Account checked in the runtime default context.'}</InterfaceText>
        </Text>
      )}
      <Action
        variant="outline"
        label={repositoryId ? uiText('Test project connection') : uiText('Test connection')}
        disabled={!connected || busy}
        onPress={() => {
          if (pending.current) return
          pending.current = true
          setAttempt((value) => value + 1)
        }}
      />
      {automatic && (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Uses GitHub CLI on this computer. A project checkout can resolve a different account.'
            }
          </InterfaceText>
        </Text>
      )}
    </View>
  )
}
