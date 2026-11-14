import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

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
      uiText('TURN relay for {value0}', { value0: profile.name }),
      reset
        ? uiText('Restore automatic organization or Dovo relay settings?')
        : uiText(
            'Use this TURN server and share relay credentials with this computer’s paired clients? This replaces the automatic relay policy.',
          ),
      [
        { text: uiText('Cancel'), style: 'cancel' },
        {
          text: uiText('Confirm relay settings'),
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
    <View
      style={{ gap: 8 }}
      accessibilityLabel={uiText('TURN relay for {value0}', { value0: profile.name })}
    >
      <Text style={styles.title}>
        <InterfaceText>{'TURN relay'}</InterfaceText>
      </Text>
      {status?.connectionMode !== undefined && snapshot?.relaySetupSupported && (
        <View style={{ gap: 6 }}>
          <Choice
            label={uiText('Connection mode')}
            value={mode}
            items={RUNTIME_CONNECTION_MODES}
            disabled={!connected || busy}
            onChange={(value) => setModeDraft(decode(runtimeConnectionModeSchema, value))}
          />
          <Text style={styles.muted}>
            <InterfaceText values={{ value0: runtimeConnectionModeDescription(mode) }}>
              {'{value0} Existing connections stay open until they reconnect.'}
            </InterfaceText>
          </Text>
          <Action
            label={busy ? uiText('Saving…') : uiText('Apply connection mode')}
            disabled={!connected || busy || mode === status.connectionMode}
            onPress={saveMode}
          />
        </View>
      )}
      <Text style={styles.muted}>
        {status?.mode === 'organization'
          ? uiText('Supplied by {value0}{value1}.', {
              value0: status.organization,
              value1: status.configured ? '' : ' · Relay unavailable or sign-in expired',
            })
          : status?.mode === 'custom'
            ? uiText('Custom TURN server configured.')
            : uiText(
                'Automatic: use your organization relay when signed in, otherwise Dovo relay when authorized.',
              )}{' '}
        {status?.connectionMode && status.connectionMode !== 'automatic'
          ? uiText('TURN is disabled by the connection mode.')
          : uiText('Direct connections are tried first.')}
      </Text>
      {!!status?.urls.length && <Text style={styles.muted}>{status.urls.join('\n')}</Text>}
      {!snapshot?.relaySetupSupported ? (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Use a separately paired device with an updated runtime to change relay settings.'}
          </InterfaceText>
        </Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Custom TURN server')}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Icon name={expanded ? 'down' : 'next'} size={14} color={colors.muted} />
            <Text style={styles.muted}>
              <InterfaceText>{'Custom TURN server'}</InterfaceText>
            </Text>
          </Pressable>
          {expanded && (
            <>
              <Field
                label={uiText('TURN URLs')}
                value={urls}
                onChangeText={setUrls}
                multiline
                autoCorrect={false}
                editable={!busy}
                placeholder={uiText('turns:relay.example.com:5349?transport=tcp')}
              />
              <Field
                label={uiText('TURN username')}
                value={username}
                onChangeText={setUsername}
                autoCorrect={false}
                editable={!busy}
              />
              <Field
                label={uiText('TURN password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCorrect={false}
                editable={!busy}
              />
              <Action
                label={busy ? uiText('Saving…') : uiText('Use custom TURN')}
                disabled={!connected || busy || !urls.trim() || !username || !password}
                onPress={() => save(false)}
              />
              {status?.mode === 'custom' && (
                <Action
                  label={uiText('Use automatic relay')}
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
