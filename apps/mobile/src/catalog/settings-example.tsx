import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from '../screens/settings-controls'
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from '../screens/settings-group'
import { SettingsPage, SettingsSheet, useSettingsTheme } from '../screens/settings-theme'
import { Text } from '../ui/content/text'

export type SettingsExampleState = 'idle' | 'saving' | 'error' | 'saved'

/** Local-only reusable settings navigation/editor example for web and native catalogs. */
export function SettingsExample({
  initialState = 'idle',
}: {
  initialState?: SettingsExampleState
}) {
  const uiText = useInterfaceText()

  const { styles } = useSettingsTheme()
  const [section, setSection] = useState<'index' | 'connection'>(
    initialState === 'idle' ? 'index' : 'connection',
  )
  const [address, setAddress] = useState('http://studio.local:51464')
  const [savedAddress, setSavedAddress] = useState('http://studio.local:51464')
  const [state, setState] = useState<SettingsExampleState>(initialState)
  const [confirmation, setConfirmation] = useState(false)
  const [failNextSave, setFailNextSave] = useState(false)
  const [offline, setOffline] = useState(false)
  const [scope, setScope] = useState('device')

  const save = () => {
    if (offline) {
      setState('error')
      return
    }
    if (state === 'saving') {
      setSavedAddress(address)
      setState('saved')
      return
    }
    if (failNextSave) {
      setFailNextSave(false)
      setState('error')
      return
    }
    setSavedAddress(address)
    setState('saved')
  }

  return (
    <SettingsPage>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 28, gap: 20 }}>
        <View style={{ gap: 4, paddingHorizontal: 12 }}>
          <Text style={styles.title}>
            {section === 'index' ? uiText('Settings') : uiText('Runtime connection')}
          </Text>
          <Text style={styles.muted}>
            {section === 'index'
              ? uiText('This device · local preview')
              : uiText('Edit a local example address.')}
          </Text>
        </View>

        {section === 'index' ? (
          <>
            <SettingsGroup
              title={uiText('Workspace')}
              description={uiText('Computer and project connections')}
            >
              <SettingsRow
                title={uiText('Runtime address')}
                subtitle={uiText('LAN and VPN connections support HTTP. HTTPS is optional.')}
                value={savedAddress || 'Not configured'}
                icon="device"
                onPress={() => {
                  setAddress(savedAddress)
                  setState('idle')
                  setSection('connection')
                }}
              />
              <SettingsRow
                title={uiText('Connection security')}
                subtitle={uiText('Pairing codes and device tokens stay required.')}
                value="Pairing enabled"
                icon="web"
                disabled
                onPress={() => undefined}
                last
              />
            </SettingsGroup>
            <SettingsGroup
              title={uiText('Device preferences')}
              footer={uiText('These switches update local story state only.')}
            >
              <SettingsSwitchRow
                first
                label={uiText('Show connection notifications')}
                value={!offline}
                onValueChange={(value) => setOffline(!value)}
              />
            </SettingsGroup>
          </>
        ) : (
          <>
            <SettingsGroup
              title={uiText('Connection')}
              description={uiText(
                'Choose where this address is saved and update the local preview.',
              )}
              footer={uiText(
                'HTTP remains supported on LAN and VPN addresses. The preview does not connect to this address.',
              )}
            >
              <Choice
                label={uiText('Save location')}
                value={scope}
                disabled={offline || state === 'saving'}
                items={[
                  { id: 'device', name: uiText('This device') },
                  { id: 'workspace', name: uiText('Workspace default') },
                ]}
                onChange={setScope}
              />
              <Field
                label={uiText('Runtime address')}
                value={address}
                onChangeText={(value) => {
                  setAddress(value)
                  setState('idle')
                }}
                autoCapitalize="none"
                autoCorrect={false}
                hint={uiText('Example: http://studio.local:51464')}
                editable={!offline && state !== 'saving'}
                accessibilityHint={uiText('LAN and VPN runtime addresses may use HTTP.')}
              />
              <SettingsSwitchRow
                first
                label={uiText('Allow local preview save')}
                value={!offline}
                onValueChange={(value) => {
                  setOffline(!value)
                  setState(value ? 'idle' : 'error')
                }}
              />
            </SettingsGroup>

            {state === 'error' && (
              <Text accessibilityRole="alert" style={styles.error}>
                <InterfaceText>
                  {'The local preview could not save this setting. Your draft is still here.'}
                </InterfaceText>
              </Text>
            )}
            {state === 'saving' && (
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                <InterfaceText>{'Saving this setting in the local preview…'}</InterfaceText>
              </Text>
            )}
            {state === 'saved' && (
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                <InterfaceText
                  values={{
                    value0: scope === 'device' ? uiText('this device') : uiText('the workspace'),
                  }}
                >
                  {'Saved in this local preview for {value0}.'}
                </InterfaceText>
              </Text>
            )}
            {offline && (
              <Text accessibilityRole="alert" style={styles.error}>
                <InterfaceText>
                  {'Local saving is unavailable. Re-enable it before retrying.'}
                </InterfaceText>
              </Text>
            )}
            <View style={{ gap: 8 }}>
              <Action
                wide
                label={
                  state === 'saving'
                    ? uiText('Complete local save')
                    : state === 'error'
                      ? uiText('Retry save')
                      : uiText('Save changes')
                }
                disabled={offline || !address.trim()}
                onPress={save}
              />
              <View style={styles.row}>
                <Action
                  secondary
                  label={uiText('Cancel')}
                  onPress={() => {
                    setAddress(savedAddress)
                    setState('idle')
                    setSection('index')
                  }}
                />
                <Action
                  destructive
                  secondary
                  label={uiText('Forget saved connection')}
                  onPress={() => setConfirmation(true)}
                />
              </View>
              <Action
                secondary
                label={
                  state === 'saving'
                    ? uiText('Cancel simulated loading')
                    : uiText('Simulate loading')
                }
                onPress={() => setState((current) => (current === 'saving' ? 'idle' : 'saving'))}
              />
              <Action
                secondary
                label={failNextSave ? uiText('Allow next save') : uiText('Make next save fail')}
                onPress={() => setFailNextSave((current) => !current)}
              />
              <Action
                secondary
                label={uiText('Back to settings')}
                onPress={() => setSection('index')}
              />
            </View>
          </>
        )}
      </ScrollView>
      {confirmation && (
        <SettingsSheet
          title={uiText('Forget saved connection?')}
          presentation="dialog"
          onClose={() => setConfirmation(false)}
        >
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'This clears the address from this local preview. It does not affect a connected computer.'
                }
              </InterfaceText>
            </Text>
            <Action
              destructive
              wide
              label={uiText('Forget saved connection')}
              onPress={() => {
                setAddress('')
                setSavedAddress('')
                setState('saved')
                setConfirmation(false)
              }}
            />
            <Action secondary label={uiText('Cancel')} onPress={() => setConfirmation(false)} />
          </View>
        </SettingsSheet>
      )}
    </SettingsPage>
  )
}
