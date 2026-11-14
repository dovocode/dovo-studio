import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { router } from 'expo-router'
import { useOpenAppLink } from '../ui/content/open-link'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/state/application-state'
import { fetchRuntimeReleases, type RuntimeRelease } from '@dovo/protocol'
import { Linking, Platform, ScrollView } from 'react-native'
import Constants from 'expo-constants'
import { Effect } from 'effect'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { SettingsAction as Action, SettingsChoice as Choice } from './settings-controls'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { SettingsGroup, SettingsRow } from './settings-group'
export default function AppUpdates() {
  const uiText = useInterfaceText()

  const openLink = useOpenAppLink(undefined)
  const { styles } = useTheme()

  const installedChannel = Constants.expoConfig?.extra?.releaseChannel
  const [channel, setChannel] = useApplicationState(
    installedChannel === 'stable' ? 'stable' : 'nightly',
  )
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode
  const commit: unknown = Constants.expoConfig?.extra?.sourceCommit
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
          const next = channel === 'nightly' ? releases.nightly : releases.stable
          if (!next) {
            setRelease(null)
            setMessage(`No published ${channel} release notes yet.`)
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
      <ScreenHeader title={uiText('App & updates')} />
      <ScrollView contentContainerStyle={[styles.content, { gap: 24 }]}>
        <Text style={styles.muted}>
          <InterfaceText>{'This app · version and updates'}</InterfaceText>
        </Text>
        <Text style={styles.title}>
          <InterfaceText
            values={{
              value0: Constants.expoConfig?.version ?? uiText('development'),
              value1: build ? ` (${build})` : '',
            }}
          >
            {'Dovo Studio {value0}{value1}'}
          </InterfaceText>
        </Text>
        <Text selectable style={styles.muted}>
          {installedChannel ?? uiText('development')}
          {typeof commit === 'string' ? ` · ${commit.slice(0, 12)}` : ''}
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Native app updates come from TestFlight, Google Play testing, or a local build. Updates keep your paired computers and saved settings.'
            }
          </InterfaceText>
        </Text>
        <Action
          wide
          label={Platform.OS === 'ios' ? uiText('Open TestFlight') : uiText('Open Google Play')}
          onPress={() =>
            void Linking.openURL(
              Platform.OS === 'ios'
                ? 'itms-beta://'
                : 'https://play.google.com/store/apps/details?id=com.dovo.studio',
            ).catch(() =>
              setMessage(
                Platform.OS === 'ios'
                  ? 'Install TestFlight and accept your Dovo testing invitation.'
                  : 'Open Google Play using your invited testing account.',
              ),
            )
          }
        />
        <Choice
          label={uiText('Release notes channel')}
          disabled={busy}
          value={channel}
          items={[
            { id: 'nightly', name: uiText('Nightly') },
            { id: 'stable', name: uiText('Stable') },
          ]}
          onChange={(value) => {
            setChannel(value)
            setRelease(null)
            setMessage('')
          }}
        />
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Desktop release notes are shown below. Mobile builds become available separately in TestFlight or Google Play testing.'
            }
          </InterfaceText>
        </Text>
        <Action
          wide
          label={busy ? uiText('Checking…') : uiText('Check release notes')}
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
            label={uiText('Desktop release notes {value0}', { value0: release.version })}
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
        {Platform.OS === 'ios' && (
          <SettingsGroup
            title={uiText('Update from your Mac')}
            footer={uiText(
              'Connect and unlock your iPhone. Run this in your Dovo checkout; the script builds, signs and installs the new app without uninstalling it.',
            )}
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
              {uiText(
                'git pull --ff-only\npnpm install --frozen-lockfile\npnpm mobile:update -- --device YOUR_DEVICE_UDID',
              )}
            </Text>
          </SettingsGroup>
        )}
        <SettingsGroup title={uiText('Related settings')}>
          <SettingsRow
            title={uiText('Notifications')}
            subtitle={uiText('Task alerts and Live Activities on this device')}
            icon="settings"
            onPress={() => router.push('/settings/notifications')}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  )
}
