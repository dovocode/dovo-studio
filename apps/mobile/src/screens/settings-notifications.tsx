import { ScrollView } from 'react-native'
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
  const { overviews } = useRuntime()
  return (
    <SettingsPage>
      <ScreenHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.content}>
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
            <SettingsSwitchRow
              key={entry.profile.id}
              label={runtimeComputerName(entry)}
              disabled={!notifications.supported || notifications.busy || !notifications.enabled}
              value={notifications.serverEnabled(entry.profile.id)}
              onValueChange={(value) => notifications.setServerEnabled(entry.profile.id, value)}
            />
          ))}
        </SettingsGroup>
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
      </ScrollView>
    </SettingsPage>
  )
}
