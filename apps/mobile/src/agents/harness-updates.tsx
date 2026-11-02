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
        Harness updates
      </Text>
      <Action
        label={busy ? 'Checking…' : 'Check for updates'}
        disabled={!connected || busy}
        onPress={() => void check()}
      />
      <Text style={styles.muted}>
        Installed versions on this server. Update CLI tools on the host; bundled SDKs update with
        Dovo.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Choice
        label="Codex diagnostic profile"
        value={networkAgentId}
        disabled={!connected || networkBusy}
        items={[
          { id: '', name: 'Default Codex executable' },
          ...codexAgents.map((agent) => ({ id: agent.id, name: agent.name })),
        ]}
        onChange={(id) => {
          setNetworkAgentId(id)
          setNetwork(undefined)
        }}
      />
      <Action
        label={networkBusy ? 'Testing Codex network…' : 'Test Codex network'}
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
            {network.ok ? 'Network diagnostic completed' : 'Network diagnostic failed'} ·{' '}
            {(network.durationMs / 1000).toFixed(1)}s
          </Text>
          <Text selectable style={styles.muted}>
            {network.output}
          </Text>
        </View>
      )}
      {items.map((item) => (
        <View key={item.id} style={{ gap: 4 }}>
          <Text style={styles.text}>
            {item.name} · {item.installedVersion ?? 'Unavailable'} ·{' '}
            {item.updateStatus === 'update-available'
              ? `Update available: ${item.latestVersion}`
              : item.updateStatus === 'current'
                ? 'Up to date'
                : item.updateStatus === 'ahead'
                  ? 'Ahead of latest release'
                  : 'Version not confirmed'}
          </Text>
          <Text style={styles.muted}>
            {item.detail} {item.guidance}
          </Text>
        </View>
      ))}
    </View>
  )
}
