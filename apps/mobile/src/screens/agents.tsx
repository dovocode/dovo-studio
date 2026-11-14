import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
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
import { HarnessInstructions } from '../agents/harness-instructions'
export default function AgentsScreen() {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  return (
    <SettingsPage>
      <ScreenHeader title={uiText('Agents')} />
      <ScopedSettings scrollable>
        {({ scope, repository }) => (
          <>
            <ScopedAgents scope={scope} repository={repository} />
            <View style={[styles.card, { gap: 8 }]}>
              <Text style={styles.text}>
                <InterfaceText>{'Default agent for new tasks'}</InterfaceText>
              </Text>
              <Text style={styles.muted}>
                <InterfaceText>
                  {'Choose a profile and permissions in Task defaults.'}
                </InterfaceText>
              </Text>
              <Action
                secondary
                label={uiText('Open task defaults')}
                onPress={() => router.push('/settings/task-defaults')}
              />
            </View>
            {scope === 'environment' && (
              <>
                <HarnessInstructions />
                <EnvironmentTools />
              </>
            )}
            {(scope === 'global' || scope === 'project') && (
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Choose the Computer level to manage installations, accounts, titles and dictation.'
                  }
                </InterfaceText>
              </Text>
            )}
          </>
        )}
      </ScopedSettings>
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
          <Text style={styles.text}>
            <InterfaceText>{'Installations & text generation · this computer'}</InterfaceText>
          </Text>
          <HarnessUpdates />
          <AcpRegistrySettings />
        </>
      ) : (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Reconnect this computer to manage installations and text generation.'}
          </InterfaceText>
        </Text>
      )}
      <TitleSettings />
      <TitleSettings selection />
    </View>
  )
}
