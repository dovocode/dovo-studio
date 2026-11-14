import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import {
  adapterDiagnosticsSchema,
  codexNetworkDiagnosticSchema,
  type CodexNetworkDiagnostic,
  type AdapterDiagnostic,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsAction as Action } from '../screens/settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
export function HarnessUpdates() {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { connected, callEffect, snapshot } = useRuntime()
  const [items, setItems] = useApplicationState<AdapterDiagnostic[]>([])
  const [network, setNetwork] = useApplicationState<CodexNetworkDiagnostic | undefined>(undefined)
  const [networkAgentId, setNetworkAgentId] = useApplicationState('')
  const codexAgents = snapshot?.workspace.agents.filter((agent) => agent.provider === 'codex') ?? []
  const [networkBusy, setNetworkBusy] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  async function check() {
    setBusy(true)
    setError('')
    try {
      setItems(
        await runClientEffect(
          callEffect(
            '/api/agents/updates',
            { checkUpdates: true },
            adapterDiagnosticsSchema,
            'POST',
          ),
        ),
      )
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={styles.text}>
        <InterfaceText>{'Harness updates'}</InterfaceText>
      </Text>
      <Action
        label={busy ? uiText('Checking…') : uiText('Check for updates')}
        disabled={!connected || busy}
        onPress={() => void check()}
      />
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Installed versions on this server. Update CLI tools on the host; bundled SDKs update with Dovo.'
          }
        </InterfaceText>
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Choice
        label={uiText('Codex diagnostic profile')}
        value={networkAgentId}
        disabled={!connected || networkBusy}
        items={[
          { id: '', name: uiText('Default Codex executable') },
          ...codexAgents.map((agent) => ({ id: agent.id, name: agent.name })),
        ]}
        onChange={(id) => {
          setNetworkAgentId(id)
          setNetwork(undefined)
        }}
      />
      <Action
        label={networkBusy ? uiText('Testing Codex network…') : uiText('Test Codex network')}
        disabled={!connected || networkBusy}
        onPress={async () => {
          setNetworkBusy(true)
          setError('')
          try {
            setNetwork(
              await runClientEffect(
                callEffect(
                  '/api/agents/codex/network-diagnostics',
                  networkAgentId ? { agentId: networkAgentId } : {},
                  codexNetworkDiagnosticSchema,
                  'POST',
                ),
              ),
            )
          } catch (error) {
            setError(String(error))
          } finally {
            setNetworkBusy(false)
          }
        }}
      />
      {network && (
        <View style={{ gap: 4 }}>
          <Text style={styles.text}>
            {network.ok
              ? uiText('Network diagnostic completed')
              : uiText('Network diagnostic failed')}{' '}
            · {(network.durationMs / 1000).toFixed(1)}s
          </Text>
          <Text selectable style={styles.muted}>
            {network.output}
          </Text>
        </View>
      )}
      {items.map((item) => (
        <View key={item.id} style={{ gap: 4 }}>
          <Text style={styles.text}>
            {item.name} · {item.installedVersion ?? uiText('Unavailable')} ·{' '}
            {item.updateStatus === 'update-available'
              ? uiText('Update available: {value0}', { value0: item.latestVersion })
              : item.updateStatus === 'current'
                ? uiText('Up to date')
                : item.updateStatus === 'ahead'
                  ? uiText('Ahead of latest release')
                  : uiText('Version not confirmed')}
          </Text>
          <Text style={styles.muted}>
            {item.detail} {item.guidance}
          </Text>
        </View>
      ))}
    </View>
  )
}
