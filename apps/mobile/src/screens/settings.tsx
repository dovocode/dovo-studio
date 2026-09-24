import { router } from 'expo-router'
import { View, ScrollView } from 'react-native'
import { SettingsGroup, SettingsRow } from './settings-group'
import { colors, styles } from '../ui/theme'
import { useRuntime } from '../runtime/provider'
import { ScreenHeader } from '../ui/screen-header'

export default function SettingsScreen() {
  const { profiles, overviews } = useRuntime()
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Settings" testID="Settings heading" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <SettingsGroup title="Your computers">
          <SettingsRow
            title={profiles.length ? 'Devices & runtime' : 'Connect a computer'}
            label="Devices & runtime"
            testID="Devices & runtime"
            icon="device"
            tint={overviews.some((entry) => entry.connected) ? colors.accent : colors.muted}
            subtitle={
              profiles.length
                ? `${profiles.length} saved · ${overviews.filter((entry) => entry.connected).length} online`
                : 'Pair your runtime to get started'
            }
            onPress={() => router.push('/settings/devices')}
            last
          />
        </SettingsGroup>
        <SettingsGroup
          title="Across your computers"
          footer={
            !profiles.length
              ? 'Connect a computer to configure its agents and project tools.'
              : undefined
          }
        >
          <SettingsRow
            title="Source control"
            subtitle="GitHub, Bitbucket, Forgejo, Gitea and Azure DevOps"
            icon="changes"
            disabled={!profiles.length}
            onPress={() => router.push('/settings/source-control')}
          />
          <SettingsRow
            title="Agents"
            subtitle="Setup, default models, titles and permissions"
            icon="chat"
            tint="#bb9aff"
            disabled={!profiles.length}
            onPress={() => router.push('/settings/agents')}
          />
          <SettingsRow
            title="MCP & skills"
            subtitle="Project and custom-agent tools"
            icon="jobs"
            tint="#5ac8bd"
            disabled={!profiles.length}
            onPress={() => router.push('/settings/resources')}
            last
          />
        </SettingsGroup>
        <SettingsGroup title="This app">
          <SettingsRow
            title="App & updates"
            subtitle="Local builds and Live Activities"
            icon="settings"
            onPress={() => router.push('/settings/updates')}
            last
          />
        </SettingsGroup>
      </ScrollView>
    </View>
  )
}
