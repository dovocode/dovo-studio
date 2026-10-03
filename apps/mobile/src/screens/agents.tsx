import { ScrollView, View } from 'react-native'
import { ScopedSettings } from '../runtime/preferences/settings-target'
import { TaskDefaultSettings } from '../runtime/preferences/task-default-settings'
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
            <TaskDefaultSettings scope={scope} repository={repository} inline />
            <ScopedAgents scope={scope} repository={repository} />
            {scope === 'environment' && <EnvironmentTools />}
            {(scope === 'global' || scope === 'project') && (
              <Text style={styles.muted}>
                Choose an environment to manage installations, accounts, titles and dictation.
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
          <Text style={styles.text}>Environment tools</Text>
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
