import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { urlSchema, decode } from '@dovo/protocol'
import { Linking, Platform, ScrollView, Switch, View } from 'react-native'
import Constants from 'expo-constants'
import { Schema, Effect } from 'effect'
import { ScreenHeader } from '../ui/screen-header'
import { Text } from '../ui/text'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { SettingsGroup } from './settings-group'
import { useLiveActivities } from '../live-activities/provider'
const releaseSchema = mutableStruct({
  tag_name: Schema.String,
  html_url: Schema.String.pipe(Schema.compose(urlSchema())),
  published_at: Schema.NullOr(Schema.String),
})
export default function AppUpdates() {
  const activity = useLiveActivities()
  const [release, setRelease] = useApplicationState<Schema.Schema.Type<
    typeof releaseSchema
  > | null>(null)
  const [busy, setBusy] = useApplicationState(false),
    [message, setMessage] = useApplicationState('')
  const check = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        setBusy(true)
        setMessage('')
        return yield* mobileWorkflow(function* () {
          const response = yield* nativeEffect(() =>
            fetch('https://api.github.com/repos/dovocode/dovo-studio/releases/latest', {
              headers: {
                Accept: 'application/vnd.github+json',
              },
              signal: AbortSignal.timeout(15_000),
            }),
          )
          if (response.status === 404) {
            setRelease(null)
            setMessage('No published release yet. Local builds can use the latest GitHub source.')
            return
          }
          if (!response.ok)
            return yield* Effect.fail(
              new Error(`Release check failed (${response.status}). Try again later.`),
            )
          const next = decode(releaseSchema, yield* nativeEffect(() => response.json()))
          if (!next.html_url.startsWith('https://github.com/dovocode/dovo-studio/releases/'))
            return yield* Effect.fail(new Error('Unexpected release address'))
          setRelease(next)
        }).pipe(
          Effect.catchAll((error) =>
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
            label={`View release ${release.tag_name}`}
            onPress={() =>
              void runClientEffect(
                nativeEffect(() => Linking.openURL(release.html_url)).pipe(
                  Effect.catchAll(() =>
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
