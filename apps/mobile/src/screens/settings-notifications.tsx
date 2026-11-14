import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Linking, View } from 'react-native'
import { responses, diagnosticMessage } from '@dovo/protocol'
import { SettingsAction as Action } from './settings-controls'
import { useAction } from '../ui/controls/use-action'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingsScrollView } from './settings-search'
import { runtimeComputerName } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { usePushNotifications } from '../notifications/provider'
import { useLiveActivities } from '../live-activities/provider'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { SettingsPage, useSettingsTheme } from './settings-theme'
import { SettingsGroup, SettingsSwitchRow } from './settings-group'

export default function NotificationsSettingsScreen() {
  const uiText = useInterfaceText()

  const { styles } = useSettingsTheme()
  const notifications = usePushNotifications()
  const activity = useLiveActivities()
  const { overviews, readRuntime } = useRuntime()
  const { busy, error, act } = useAction()
  const [message, setMessage] = useApplicationState('')
  return (
    <SettingsPage>
      <ScreenHeader title={uiText('Notifications')} />
      <SettingsScrollView contentContainerStyle={styles.content}>
        <Text style={styles.muted}>
          <InterfaceText>
            {'This device only · choose which paired computers can send alerts to this phone'}
          </InterfaceText>
        </Text>
        <SettingsGroup
          title={uiText('Push notifications')}
          footer={uiText(
            'Get task completion, failures and input requests when Dovo is in the background. Sign in on this phone for managed delivery, or use a standalone relay. Choose which paired computers can notify you.',
          )}
        >
          <SettingsSwitchRow
            first
            label={uiText('Task notifications')}
            disabled={!notifications.supported || notifications.busy}
            value={notifications.enabled}
            onValueChange={notifications.setEnabled}
          />
          {overviews.map((entry) => (
            <View key={entry.profile.id}>
              <SettingsSwitchRow
                label={runtimeComputerName(entry)}
                disabled={!notifications.supported || notifications.busy || !notifications.enabled}
                value={notifications.serverEnabled(entry.profile.id)}
                onValueChange={(value) => notifications.setServerEnabled(entry.profile.id, value)}
              />
              <Text style={styles.muted}>
                {!notifications.enabled || !notifications.serverEnabled(entry.profile.id)
                  ? uiText('Disabled')
                  : !entry.connected
                    ? uiText('Computer offline')
                    : notifications.permission === 'denied'
                      ? uiText('Blocked by system settings')
                      : (notifications.registrations[entry.profile.id]?.error ??
                        (notifications.registrations[entry.profile.id]?.registered
                          ? uiText('Registered · delivery can be tested')
                          : uiText('Registering…')))}
              </Text>
              <Action
                secondary
                label={uiText('Test notification from {value0}', {
                  value0: runtimeComputerName(entry),
                })}
                disabled={
                  busy ||
                  !entry.connected ||
                  !notifications.enabled ||
                  !notifications.serverEnabled(entry.profile.id) ||
                  !notifications.registrations[entry.profile.id]?.registered ||
                  notifications.permission !== 'granted'
                }
                onPress={() =>
                  act(async () => {
                    setMessage('')
                    await readRuntime(entry.profile, '/api/notifications/test', {}, responses.ok)
                    setMessage(
                      'Test accepted by the notification service. Confirm it appears on this device. If it does not, check Focus and system notification settings.',
                    )
                  })
                }
              />
            </View>
          ))}
        </SettingsGroup>
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: notifications.permission }}>
            {'System permission: {value0}'}
          </InterfaceText>
        </Text>
        <Action
          secondary
          label={uiText('Open system notification settings')}
          onPress={() => act(() => Linking.openSettings())}
        />
        {!!message && (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {message}
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {diagnosticMessage(error)}
          </Text>
        )}
        {!notifications.supported && (
          <Text style={styles.muted}>
            <InterfaceText>{'Push notifications require a new native app build.'}</InterfaceText>
          </Text>
        )}
        {!!notifications.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {notifications.error}
          </Text>
        )}
        <SettingsGroup
          title={uiText('Live Activities')}
          footer={uiText(
            'Shows task progress on your Lock Screen and Dynamic Island. Activities start when you open Dovo and keep updating in the background through Connect or your computer’s notification relay.',
          )}
        >
          <SettingsSwitchRow
            first
            label={uiText('Show task Live Activities')}
            disabled={!activity.supported}
            value={activity.enabled && activity.supported}
            onValueChange={activity.setEnabled}
          />
        </SettingsGroup>
        {!activity.supported && (
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Live Activities require the new native iOS build, not Expo Go or a JavaScript reload.'
              }
            </InterfaceText>
          </Text>
        )}
        {!!activity.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {activity.error}
          </Text>
        )}
      </SettingsScrollView>
    </SettingsPage>
  )
}
