import { HarnessLabel, ModelLabel } from '../agents/model-label'
import { HarnessUpdates } from '../agents/harness-updates'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { Setup } from '../agents/setup'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { ScreenHeader } from '../ui/layout/screen-header'
import { TitleSettings } from '../agents/title-settings'
import { accessLabel } from '@dovo/protocol'
import { AgentEditor } from '../agents/agent-editor'
import { AcpRegistrySettings } from '../agents/acp-registry'
import { Alert, ScrollView, View } from 'react-native'
import { Text } from '../ui/content/text'
import { randomUUID } from 'expo-crypto'
import { type Agent, responses, defaultTaskHarness, runtimeDefaultsSchema } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { clientScopeKey } from '@dovo/client-runtime'
import { Sheet } from '../ui/layout/sheet'
import { SettingsGroup, SettingsRow } from './settings-group'
import { Action } from '../ui/controls/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
export default function AgentsScreen() {
  const { overviews } = useRuntime()
  const { globalAgentPresets, retiredGlobalAgentPresets } = useMobilePreferences()
  const [globalEditing, setGlobalEditing] = useApplicationState<Agent | null>(null)
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Agents" />
      <Text style={styles.muted}>Agents and model settings across your computers.</Text>
      <SettingsGroup title="Global agent presets">
        <Text style={styles.muted}>
          Defaults for servers connected to this app. Each server can override them.
        </Text>
        <Action
          label="New global preset"
          onPress={() =>
            setGlobalEditing({ ...defaultTaskHarness('codex'), id: randomUUID(), name: '' })
          }
        />
        {globalAgentPresets.map((agent) => (
          <Action
            key={agent.id}
            secondary
            label={agent.name}
            onPress={() => setGlobalEditing(agent)}
          />
        ))}
        {globalAgentPresets.map((agent) => (
          <Action
            key={`remove-${agent.id}`}
            secondary
            label={`Remove preset · ${agent.name}`}
            onPress={() =>
              Alert.alert(
                'Remove global preset?',
                'Existing server configurations stay available.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                      updateMobilePreferences({
                        globalAgentPresets: globalAgentPresets.filter(
                          (item) => item.id !== agent.id,
                        ),
                        retiredGlobalAgentPresets: [...retiredGlobalAgentPresets, agent.id],
                      }),
                  },
                ],
              )
            }
          />
        ))}
      </SettingsGroup>
      {globalEditing && (
        <AgentEditor
          original={globalEditing}
          global
          creating={!globalAgentPresets.some((agent) => agent.id === globalEditing.id)}
          onClose={() => setGlobalEditing(null)}
        />
      )}
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
  const { snapshot, connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const [editing, setEditing] = useApplicationState<{
      agent: Agent
      creating: boolean
    } | null>(null),
    [availability, setAvailability] = useApplicationState('')
  const [titles, setTitles] = useApplicationState(false)
  const [registry, setRegistry] = useApplicationState(false)
  return (
    <View
      style={{
        gap: 12,
      }}
    >
      <View
        style={[
          styles.row,
          {
            justifyContent: 'space-between',
          },
        ]}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          <Text style={styles.text}>{name}</Text>
          <Text style={styles.muted}>{connected ? 'Online' : 'Offline · Saved agents'}</Text>
        </View>
        <Action
          label="New configuration"
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
      <Setup />
      <Text style={styles.muted}>
        Save multiple configurations for each provider with different models, access and
        instructions.
      </Text>
      {[
        ...(['codex', 'claude', 'opencode'] as const).map((provider) => ({
          id: provider,
          name: provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : 'OpenCode',
          provider,
          installationId: undefined,
        })),
        ...(snapshot?.acpInstallations ?? []).map((installation) => ({
          id: installation.id,
          name: installation.name,
          provider: 'acp' as const,
          installationId: installation.id,
        })),
      ].map((installation) => (
        <View key={installation.id} style={styles.card}>
          <Text style={styles.text}>{installation.name}</Text>
          <Action
            label="Configure"
            disabled={!connected}
            onPress={() =>
              setEditing({
                creating: !snapshot?.workspace.agents.some(
                  (agent) =>
                    agent.provider === installation.provider &&
                    agent.acpInstallationId === installation.installationId,
                ),
                agent: snapshot?.workspace.agents.find(
                  (agent) =>
                    agent.provider === installation.provider &&
                    agent.acpInstallationId === installation.installationId,
                ) ?? {
                  ...defaultTaskHarness(installation.provider),
                  id: randomUUID(),
                  name: installation.name,
                  acpInstallationId: installation.installationId,
                },
              })
            }
          />
        </View>
      ))}
      {snapshot?.workspace.agents
        .slice()
        .sort(
          (a, b) =>
            Number(snapshot.defaults?.modelPreferences?.[`agent:${b.id}`]?.favorite ?? false) -
            Number(snapshot.defaults?.modelPreferences?.[`agent:${a.id}`]?.favorite ?? false),
        )
        .map((agent) => (
          <View key={agent.id} style={styles.card}>
            <Text style={styles.text}>{agent.name}</Text>
            <Text style={styles.muted}>
              {agent.globalPreset
                ? agent.serverOverride
                  ? 'Server override'
                  : 'Global preset'
                : 'This server'}
            </Text>
            <Text style={styles.muted}>
              <HarnessLabel agent={agent} /> · <ModelLabel agent={agent} />
              {agent.reasoning ? ` · ${agent.reasoning}` : ''} · {accessLabel(agent.permission)}
            </Text>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Action
                secondary
                label={
                  snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite
                    ? '★ Favorite'
                    : '☆ Favorite'
                }
                disabled={!connected || busy}
                onPress={() =>
                  act(() =>
                    mobileWorkflow(function* () {
                      yield* callEffect(
                        '/api/agents/models/preference',
                        {
                          key: `agent:${agent.id}`,
                          favorite:
                            !snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite,
                        },
                        runtimeDefaultsSchema,
                      )
                    }),
                  )
                }
              />
              <Action
                secondary
                label="Duplicate"
                disabled={!connected}
                onPress={() =>
                  setEditing({
                    creating: true,
                    agent: {
                      ...agent,
                      globalPreset: undefined,
                      serverOverride: undefined,
                      id: randomUUID(),
                      name: `${agent.name} copy`,
                    },
                  })
                }
              />
              <Action
                secondary
                label={agent.globalPreset ? 'Global preset' : 'Delete'}
                disabled={!connected || busy || !!agent.globalPreset}
                onPress={() =>
                  Alert.alert(
                    'Delete configuration?',
                    `Delete ${agent.name}? Existing threads keep their settings.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () =>
                          act(() =>
                            mobileWorkflow(function* () {
                              yield* callEffect(
                                '/api/agents/remove',
                                { id: agent.id },
                                responses.ok,
                              )
                            }),
                          ),
                      },
                    ],
                  )
                }
              />
              <Action
                secondary
                disabled={!connected}
                label={`Edit ${agent.name}`}
                onPress={() =>
                  setEditing({
                    agent,
                    creating: false,
                  })
                }
              />
              <Action
                secondary
                label="Check provider"
                disabled={!connected || busy}
                onPress={() =>
                  act(() =>
                    mobileWorkflow(function* () {
                      const result = yield* callEffect(
                        '/api/agents/probe',
                        {
                          id: agent.id,
                        },
                        responses.provider,
                      )
                      setAvailability(
                        `${agent.name}: ${result.available ? 'Available' : 'Unavailable'} · ${result.detail}`,
                      )
                    }),
                  )
                }
              />
            </View>
          </View>
        ))}
      <SettingsGroup>
        <SettingsRow
          title="ACP registry"
          subtitle="Install and manage ACP agents"
          icon="agents"
          disabled={!connected}
          onPress={() => setRegistry(true)}
        />
        <SettingsRow
          title="Titles & dictation"
          subtitle={name}
          icon="chat"
          disabled={!connected}
          last
          onPress={() => setTitles(true)}
        />
      </SettingsGroup>
      {registry && (
        <Sheet title={`ACP registry · ${name}`} onClose={() => setRegistry(false)}>
          <HarnessUpdates />
          <AcpRegistrySettings />
        </Sheet>
      )}
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
