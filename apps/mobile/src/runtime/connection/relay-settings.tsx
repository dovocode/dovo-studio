import { useState, useEffect } from 'react'
import { Alert, Pressable, View } from 'react-native'
import {
  customTurnSchema,
  decode,
  responses,
  runtimeConnectionModeSchema,
  RUNTIME_CONNECTION_MODES,
  runtimeConnectionModeDescription,
  type RuntimeConnectionMode,
} from '@dovo/protocol'
import { useRuntime } from './provider'
import { Choice } from '../../ui/controls/choice'
import { Icon } from '../../ui/controls/icon'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function RelaySettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { profile } = useRuntime()
  return <RelaySettingsContent key={profile?.id} onBusyChange={onBusyChange} />
}
function RelaySettingsContent({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { profile, snapshot, connected, call, refresh } = useRuntime()
  const { styles, colors } = useTheme()
  const { busy, error, act } = useAction()
  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])
  const [modeDraft, setModeDraft] = useState<RuntimeConnectionMode>()
  const [expanded, setExpanded] = useState(false)
  const [urls, setUrls] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  if (!profile) return null
  const status = snapshot?.relaySettings
  const mode = modeDraft ?? status?.connectionMode ?? 'automatic'
  const saveMode = () =>
    act(async () => {
      await call('/api/runtime/connection-mode', { consent: true, mode }, responses.relaySettings)
      await refresh()
      setModeDraft(undefined)
    })
  const save = (reset: boolean) =>
    Alert.alert(
      `TURN relay for ${profile.name}`,
      reset
        ? 'Restore automatic organization or Dovo relay settings?'
        : 'Use this TURN server and share relay credentials with this computer’s paired clients? This replaces the automatic relay policy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm relay settings',
          onPress: () =>
            act(async () => {
              const config = reset
                ? null
                : decode(customTurnSchema, {
                    urls: urls
                      .split(/[\n,]+/)
                      .map((url) => url.trim())
                      .filter(Boolean),
                    username,
                    credential: password,
                  })
              await call('/api/runtime/relay', { consent: true, config }, responses.relaySettings)
              setPassword('')
              setUsername('')
              setUrls('')
              await refresh()
            }),
        },
      ],
    )
  return (
    <View style={{ gap: 8 }} accessibilityLabel={`TURN relay for ${profile.name}`}>
      <Text style={styles.title}>TURN relay</Text>
      {status?.connectionMode !== undefined && snapshot?.relaySetupSupported && (
        <View style={{ gap: 6 }}>
          <Choice
            label="Connection mode"
            value={mode}
            items={RUNTIME_CONNECTION_MODES}
            disabled={!connected || busy}
            onChange={(value) => setModeDraft(decode(runtimeConnectionModeSchema, value))}
          />
          <Text style={styles.muted}>
            {runtimeConnectionModeDescription(mode)} Existing connections stay open until they
            reconnect.
          </Text>
          <Action
            label={busy ? 'Saving…' : 'Apply connection mode'}
            disabled={!connected || busy || mode === status.connectionMode}
            onPress={saveMode}
          />
        </View>
      )}
      <Text style={styles.muted}>
        {status?.mode === 'organization'
          ? `Supplied by ${status.organization}${status.configured ? '' : ' · Relay unavailable or sign-in expired'}.`
          : status?.mode === 'custom'
            ? 'Custom TURN server configured.'
            : 'Automatic: use your organization relay when signed in, otherwise Dovo relay when authorized.'}{' '}
        {status?.connectionMode && status.connectionMode !== 'automatic'
          ? 'TURN is disabled by the connection mode.'
          : 'Direct connections are tried first.'}
      </Text>
      {!!status?.urls.length && <Text style={styles.muted}>{status.urls.join('\n')}</Text>}
      {!snapshot?.relaySetupSupported ? (
        <Text style={styles.muted}>
          Use a separately paired device with an updated runtime to change relay settings.
        </Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Custom TURN server"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Icon name={expanded ? 'down' : 'next'} size={14} color={colors.muted} />
            <Text style={styles.muted}>Custom TURN server</Text>
          </Pressable>
          {expanded && (
            <>
              <Field
                label="TURN URLs"
                value={urls}
                onChangeText={setUrls}
                multiline
                autoCorrect={false}
                editable={!busy}
                placeholder="turns:relay.example.com:5349?transport=tcp"
              />
              <Field
                label="TURN username"
                value={username}
                onChangeText={setUsername}
                autoCorrect={false}
                editable={!busy}
              />
              <Field
                label="TURN password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCorrect={false}
                editable={!busy}
              />
              <Action
                label={busy ? 'Saving…' : 'Use custom TURN'}
                disabled={!connected || busy || !urls.trim() || !username || !password}
                onPress={() => save(false)}
              />
              {status?.mode === 'custom' && (
                <Action
                  label="Use automatic relay"
                  disabled={!connected || busy}
                  onPress={() => save(true)}
                />
              )}
            </>
          )}
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
