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
            {section === 'index' ? 'Settings' : 'Runtime connection'}
          </Text>
          <Text style={styles.muted}>
            {section === 'index' ? 'This device · local preview' : 'Edit a local example address.'}
          </Text>
        </View>

        {section === 'index' ? (
          <>
            <SettingsGroup title="Workspace" description="Computer and project connections">
              <SettingsRow
                title="Runtime address"
                subtitle="LAN and VPN connections support HTTP. HTTPS is optional."
                value={savedAddress || 'Not configured'}
                icon="device"
                onPress={() => {
                  setAddress(savedAddress)
                  setState('idle')
                  setSection('connection')
                }}
              />
              <SettingsRow
                title="Connection security"
                subtitle="Pairing codes and device tokens stay required."
                value="Pairing enabled"
                icon="web"
                disabled
                onPress={() => undefined}
                last
              />
            </SettingsGroup>
            <SettingsGroup
              title="Device preferences"
              footer="These switches update local story state only."
            >
              <SettingsSwitchRow
                first
                label="Show connection notifications"
                value={!offline}
                onValueChange={(value) => setOffline(!value)}
              />
            </SettingsGroup>
          </>
        ) : (
          <>
            <SettingsGroup
              title="Connection"
              description="Choose where this address is saved and update the local preview."
              footer="HTTP remains supported on LAN and VPN addresses. The preview does not connect to this address."
            >
              <Choice
                label="Save location"
                value={scope}
                disabled={offline || state === 'saving'}
                items={[
                  { id: 'device', name: 'This device' },
                  { id: 'workspace', name: 'Workspace default' },
                ]}
                onChange={setScope}
              />
              <Field
                label="Runtime address"
                value={address}
                onChangeText={(value) => {
                  setAddress(value)
                  setState('idle')
                }}
                autoCapitalize="none"
                autoCorrect={false}
                hint="Example: http://studio.local:51464"
                editable={!offline && state !== 'saving'}
                accessibilityHint="LAN and VPN runtime addresses may use HTTP."
              />
              <SettingsSwitchRow
                first
                label="Allow local preview save"
                value={!offline}
                onValueChange={(value) => {
                  setOffline(!value)
                  setState(value ? 'idle' : 'error')
                }}
              />
            </SettingsGroup>

            {state === 'error' && (
              <Text accessibilityRole="alert" style={styles.error}>
                The local preview could not save this setting. Your draft is still here.
              </Text>
            )}
            {state === 'saving' && (
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                Saving this setting in the local preview…
              </Text>
            )}
            {state === 'saved' && (
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                Saved in this local preview for{' '}
                {scope === 'device' ? 'this device' : 'the workspace'}.
              </Text>
            )}
            {offline && (
              <Text accessibilityRole="alert" style={styles.error}>
                Local saving is unavailable. Re-enable it before retrying.
              </Text>
            )}
            <View style={{ gap: 8 }}>
              <Action
                wide
                label={
                  state === 'saving'
                    ? 'Complete local save'
                    : state === 'error'
                      ? 'Retry save'
                      : 'Save changes'
                }
                disabled={offline || !address.trim()}
                onPress={save}
              />
              <View style={styles.row}>
                <Action
                  secondary
                  label="Cancel"
                  onPress={() => {
                    setAddress(savedAddress)
                    setState('idle')
                    setSection('index')
                  }}
                />
                <Action
                  secondary
                  label="Forget saved connection"
                  onPress={() => setConfirmation(true)}
                />
              </View>
              <Action
                secondary
                label={state === 'saving' ? 'Cancel simulated loading' : 'Simulate loading'}
                onPress={() => setState((current) => (current === 'saving' ? 'idle' : 'saving'))}
              />
              <Action
                secondary
                label={failNextSave ? 'Allow next save' : 'Make next save fail'}
                onPress={() => setFailNextSave((current) => !current)}
              />
              <Action secondary label="Back to settings" onPress={() => setSection('index')} />
            </View>
          </>
        )}
      </ScrollView>
      {confirmation && (
        <SettingsSheet
          title="Forget saved connection?"
          presentation="dialog"
          onClose={() => setConfirmation(false)}
        >
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>
              This clears the address from this local preview. It does not affect a connected
              computer.
            </Text>
            <Action
              wide
              label="Forget saved connection"
              onPress={() => {
                setAddress('')
                setSavedAddress('')
                setState('saved')
                setConfirmation(false)
              }}
            />
            <Action secondary label="Cancel" onPress={() => setConfirmation(false)} />
          </View>
        </SettingsSheet>
      )}
    </SettingsPage>
  )
}
