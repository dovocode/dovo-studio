import { router } from 'expo-router'
import { useOpenAppLink } from '../ui/content/open-link'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/state/application-state'
import { fetchRuntimeReleases, type RuntimeRelease } from '@dovo/protocol'
import { Platform, ScrollView } from 'react-native'
import Constants from 'expo-constants'
import { Effect } from 'effect'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { SettingsAction as Action } from './settings-controls'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { SettingsGroup, SettingsRow } from './settings-group'
export default function AppUpdates() {
  const openLink = useOpenAppLink(undefined)
  const { styles } = useTheme()

  const [release, setRelease] = useApplicationState<RuntimeRelease | null>(null)
  const [busy, setBusy] = useApplicationState(false),
    [message, setMessage] = useApplicationState('')
  const check = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        setBusy(true)
        setMessage('')
        return yield* mobileWorkflow(function* () {
          const releases = yield* nativeEffect(() => fetchRuntimeReleases())
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
    <SettingsPage>
      <ScreenHeader title="App & updates" />
      <ScrollView contentContainerStyle={[styles.content, { gap: 24 }]}>
        <Text style={styles.muted}>This app · version and updates</Text>
        <Text style={styles.title}>
          Dovo Studio {Constants.expoConfig?.version ?? 'development'}
        </Text>
        <Text style={styles.muted}>
          Native app updates come from TestFlight, Google Play testing, or a local build. Updates
          keep your paired computers and saved settings.
        </Text>
        <Action
          wide
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
                nativeEffect(() => openLink(release.url)).pipe(
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
        <SettingsGroup title="Related settings">
          <SettingsRow
            title="Notifications"
            subtitle="Task alerts and Live Activities on this device"
            icon="settings"
            onPress={() => router.push('/settings/notifications')}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  )
}
