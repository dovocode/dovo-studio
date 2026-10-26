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
  const { styles } = useSettingsTheme()
  const notifications = usePushNotifications()
  const activity = useLiveActivities()
  const { overviews, readRuntime } = useRuntime()
  const { busy, error, act } = useAction()
  const [message, setMessage] = useApplicationState('')
  return (
    <SettingsPage>
      <ScreenHeader title="Notifications" />
      <SettingsScrollView contentContainerStyle={styles.content}>
        <Text style={styles.muted}>
          This device only · choose which paired computers can send alerts to this phone
        </Text>
        <SettingsGroup
          title="Push notifications"
          footer="Get task completion, failures and input requests when Dovo is in the background. Sign in on this phone for managed delivery, or use a standalone relay. Choose which paired computers can notify you."
        >
          <SettingsSwitchRow
            first
            label="Task notifications"
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
                  ? 'Disabled'
                  : !entry.connected
                    ? 'Computer offline'
                    : notifications.permission === 'denied'
                      ? 'Blocked by system settings'
                      : (notifications.registrations[entry.profile.id]?.error ??
                        (notifications.registrations[entry.profile.id]?.registered
                          ? 'Registered · delivery can be tested'
                          : 'Registering…'))}
              </Text>
              <Action
                secondary
                label={`Test notification from ${runtimeComputerName(entry)}`}
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
        <Text style={styles.muted}>System permission: {notifications.permission}</Text>
        <Action
          secondary
          label="Open system notification settings"
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
          <Text style={styles.muted}>Push notifications require a new native app build.</Text>
        )}
        {!!notifications.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {notifications.error}
          </Text>
        )}
        <SettingsGroup
          title="Live Activities"
          footer="Shows task progress on your Lock Screen and Dynamic Island. Activities start when you open Dovo and keep updating in the background through Connect or your computer’s notification relay."
        >
          <SettingsSwitchRow
            first
            label="Show task Live Activities"
            disabled={!activity.supported}
            value={activity.enabled && activity.supported}
            onValueChange={activity.setEnabled}
          />
        </SettingsGroup>
        {!activity.supported && (
          <Text style={styles.muted}>
            Live Activities require the new native iOS build, not Expo Go or a JavaScript reload.
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
