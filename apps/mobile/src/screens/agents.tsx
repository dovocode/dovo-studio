import { ScrollView, View } from 'react-native'
import { ScopedSettings } from '../runtime/preferences/settings-target'
import { router } from 'expo-router'
import { SettingsAction as Action } from './settings-controls'
import { useRuntime } from '../runtime/connection/provider'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { ScopedAgents } from '../agents/scoped-agents'
import { HarnessUpdates } from '../agents/harness-updates'
import { AcpRegistrySettings } from '../agents/acp-registry'
import { TitleSettings } from '../agents/title-settings'
export default function AgentsScreen() {
  const { styles } = useTheme()

  return (
    <SettingsPage>
      <ScreenHeader title="Agents" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        <ScopedSettings>
          {({ scope, repository }) => (
            <>
              <ScopedAgents scope={scope} repository={repository} />
              <View style={[styles.card, { gap: 8 }]}>
                <Text style={styles.text}>Default agent for new tasks</Text>
                <Text style={styles.muted}>Choose a profile and permissions in Task defaults.</Text>
                <Action
                  secondary
                  label="Open task defaults"
                  onPress={() => router.push('/settings/task-defaults')}
                />
              </View>
              {scope === 'environment' && <EnvironmentTools />}
              {(scope === 'global' || scope === 'project') && (
                <Text style={styles.muted}>
                  Choose the Computer level to manage installations, accounts, titles and dictation.
                </Text>
              )}
            </>
          )}
        </ScopedSettings>
      </ScrollView>
    </SettingsPage>
  )
}
function EnvironmentTools() {
  const { styles } = useTheme()

  const { connected } = useRuntime()
  return (
    <View style={{ gap: 12 }}>
      {connected ? (
        <>
          <Text style={styles.text}>Installations & text generation · this computer</Text>
          <HarnessUpdates />
          <AcpRegistrySettings />
          <TitleSettings />
        </>
      ) : (
        <Text style={styles.muted}>
          Reconnect this computer to manage installations and text generation.
        </Text>
      )}
    </View>
  )
}
