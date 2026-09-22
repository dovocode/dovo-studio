import { ScreenHeader } from '../ui/screen-header'
import { TitleSettings } from '../agents/title-settings'
import { accessLabel } from '@dovo/protocol'
import { AgentEditor } from '../agents/agent-editor'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { randomUUID } from 'expo-crypto'
import { type Agent, responses } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { clientScopeKey } from '@dovo/client-runtime'
import { Sheet } from '../ui/sheet'
import { SettingsGroup, SettingsRow } from './settings-group'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
export default function AgentsScreen() {
  const { overviews } = useRuntime()
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Agents" />
      <Text style={styles.muted}>Agents and model settings across your computers.</Text>
      {!overviews.length && (
        <Text style={styles.muted}>Connect a computer to configure agents.</Text>
      )}
      {overviews.map((entry) => (
        <RuntimeScope key={clientScopeKey(entry.profile.connection)} runtimeId={entry.profile.id}>
          <ComputerAgents name={entry.profile.name} />
        </RuntimeScope>
      ))}
    </ScrollView>
  )
}
function ComputerAgents({ name }: { name: string }) {
  const { snapshot, connected, call } = useRuntime(),
    { busy, error, act } = useAction()
  const [editing, setEditing] = useState<{ agent: Agent; creating: boolean } | null>(null),
    [availability, setAvailability] = useState('')
  const [titles, setTitles] = useState(false)
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.text}>{name}</Text>
          <Text style={styles.muted}>{connected ? 'Online' : 'Offline · Saved agents'}</Text>
        </View>
        <Action
          label="New agent"
          disabled={!connected}
          onPress={() =>
            setEditing({
              creating: true,
              agent: {
                id: randomUUID(),
                name: '',
                provider: 'codex',
                model: '',
                endpoint: '',
                instructions: '',
                permission: 'ask',
              },
            })
          }
        />
      </View>
      {snapshot?.workspace.agents.map((agent) => (
        <View key={agent.id} style={styles.card}>
          <Text style={styles.text}>{agent.name}</Text>
          <Text style={styles.muted}>
            {agent.provider} · {agent.model || 'Provider default'}
            {agent.reasoning ? ` · ${agent.reasoning}` : ''} · {accessLabel(agent.permission)}
          </Text>
          <View style={styles.row}>
            <Action
              secondary
              disabled={!connected}
              label={`Edit ${agent.name}`}
              onPress={() => setEditing({ agent, creating: false })}
            />
            <Action
              secondary
              label="Check provider"
              disabled={!connected || busy}
              onPress={() =>
                act(async () => {
                  const result = await call(
                    '/api/agents/probe',
                    { id: agent.id },
                    responses.provider,
                  )
                  setAvailability(
                    `${agent.name}: ${result.available ? 'Available' : 'Unavailable'} · ${result.detail}`,
                  )
                })
              }
            />
          </View>
        </View>
      ))}
      <SettingsGroup>
        <SettingsRow
          title="Titles & dictation"
          subtitle={name}
          icon="chat"
          disabled={!connected}
          last
          onPress={() => setTitles(true)}
        />
      </SettingsGroup>
      {titles && (
        <Sheet title={`Titles & dictation · ${name}`} onClose={() => setTitles(false)}>
          <TitleSettings />
        </Sheet>
      )}
      {editing && (
        <AgentEditor
          key={editing.agent.id}
          original={editing.agent}
          creating={editing.creating}
          onClose={() => setEditing(null)}
        />
      )}
      {!!availability && <Text style={styles.muted}>{availability}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
