import { usePushNotifications } from '../notifications/provider'
import { openAppLink } from '../ui/content/open-link'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/state/application-state'
import { fetchRuntimeReleases, type RuntimeRelease } from '@dovo/protocol'
import { Platform, ScrollView, View } from 'react-native'
import { Switch } from '../ui/controls/switch'
import Constants from 'expo-constants'
import { Effect } from 'effect'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { useTheme } from '../ui/theme'
import { SettingsGroup } from './settings-group'
import { useLiveActivities } from '../live-activities/provider'
export default function AppUpdates() {
  const { styles } = useTheme()

  const activity = useLiveActivities()
  const notifications = usePushNotifications()
  const [release, setRelease] = useApplicationState<RuntimeRelease | null>(null)
  const [busy, setBusy] = useApplicationState(false),
    [message, setMessage] = useApplicationState('')
  const check = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        setBusy(true)
        setMessage('')
        return yield* mobileWorkflow(function* () {
          const releases = yield* nativeEffect(fetchRuntimeReleases)
          const next = releases.stable
          if (!next) {
            setRelease(null)
            setMessage(
              'No published stable release yet. Local builds can use the latest GitHub source.',
            )
            return
          }
          setRelease(next)
        }).pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              setMessage(error instanceof Error ? error.message : String(error))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader title="App & updates" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          Dovo Studio {Constants.expoConfig?.version ?? 'development'}
        </Text>
        <Text style={styles.muted}>
          Installed from a local iPhone build. Updates keep your paired computers and saved
          settings.
        </Text>
        <Action
          label={busy ? 'Checking…' : 'Check releases'}
          disabled={busy}
          onPress={() => void check()}
        />
        {!!message && (
          <Text accessibilityRole="alert" style={styles.muted}>
            {message}
          </Text>
        )}
        {release && (
          <Action
            secondary
            label={`View release ${release.version}`}
            onPress={() =>
              void runClientEffect(
                nativeEffect(() => openAppLink(release.url)).pipe(
                  Effect.catch(() =>
                    nativeEffect(() => setMessage('Could not open release notes.')),
                  ),
                ),
              )
            }
          />
        )}
        <SettingsGroup
          title="Update from your Mac"
          footer="Connect and unlock your iPhone. Run this in your Dovo checkout; the script builds, signs and installs the new app without uninstalling it."
        >
          <Text
            selectable
            style={[
              styles.text,
              {
                padding: 14,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              },
            ]}
          >
            git pull --ff-only{'\n'}pnpm install --frozen-lockfile{'\n'}pnpm mobile:update --
            --device YOUR_DEVICE_UDID
          </Text>
        </SettingsGroup>
        <SettingsGroup
          title="Push notifications"
          footer="Get task completion, failed checks and input requests when Dovo is in the background. Each paired computer needs the separately deployed Dovo notification relay."
        >
          <View style={[styles.row, { padding: 14, justifyContent: 'space-between' }]}>
            <Text style={styles.text}>Task notifications</Text>
            <Switch
              accessibilityLabel="Enable push notifications"
              disabled={!notifications.supported || notifications.busy}
              value={notifications.enabled}
              onValueChange={notifications.setEnabled}
            />
          </View>
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
          footer="Shows task titles, projects and devices on your Lock Screen and Dynamic Island. Background updates require APNs setup on each host computer."
        >
          <View
            style={[
              styles.row,
              {
                padding: 14,
                justifyContent: 'space-between',
              },
            ]}
          >
            <Text style={styles.text}>Show running tasks</Text>
            <Switch
              accessibilityLabel="Show task Live Activities"
              disabled={!activity.supported}
              value={activity.enabled && activity.supported}
              onValueChange={activity.setEnabled}
            />
          </View>
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
    </View>
  )
}
