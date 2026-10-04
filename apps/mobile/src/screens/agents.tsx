import { ScrollView, View } from 'react-native'
import { ScopedSettings } from '../runtime/preferences/settings-target'
import { router } from 'expo-router'
import { Action } from '../ui/controls/action'
import { useRuntime } from '../runtime/connection/provider'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { styles } from '../ui/theme'
import { ScopedAgents } from '../agents/scoped-agents'
import { HarnessUpdates } from '../agents/harness-updates'
import { AcpRegistrySettings } from '../agents/acp-registry'
import { TitleSettings } from '../agents/title-settings'
export default function AgentsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Agents" />
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
                Choose a computer to manage installations, accounts, titles and dictation.
              </Text>
            )}
          </>
        )}
      </ScopedSettings>
    </ScrollView>
  )
}
function EnvironmentTools() {
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
        <Text style={styles.muted}>Reconnect to manage environment tools.</Text>
      )}
    </View>
  )
}
