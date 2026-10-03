import { useEffect } from 'react'
import { View, Alert } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  responses,
  runtimeDefaultsSchema,
  defaultTaskHarness,
  scopedSettingsResultSchema,
  settingsScopeLabels,
  scopedAgentEntries,
  type Agent,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { styles } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { AgentEditor } from './agent-editor'
import { HarnessLabel, ModelLabel } from './model-label'
export function ScopedAgents({
  scope,
  repository,
}: {
  scope: SettingsScope
  repository?: Repository
}) {
  const { snapshot, callEffect, connected } = useRuntime()
  const { busy, error, act } = useAction()
  const [settings, setSettings] = useApplicationState<
    typeof scopedSettingsResultSchema.Type | null
  >(null)
  const [loadError, setLoadError] = useApplicationState('')
  const [diagnostics, setDiagnostics] = useApplicationState('')
  const [editing, setEditing] = useApplicationState<Agent | null>(null)
  useEffect(() => {
    if (!connected || !snapshot?.scopedAgentsSupported) return
    let current = true
    void runClientEffect(
      callEffect(
        '/api/agents/settings/read',
        { scope, repositoryId: repository?.id, includeAgents: true },
        scopedSettingsResultSchema,
      ),
    )
      .then((value) => {
        if (current) {
          setSettings(value)
          setLoadError('')
        }
      })
      .catch((error: unknown) => {
        if (current) setLoadError(String(error))
      })
    return () => {
      current = false
    }
  }, [callEffect, connected, scope, repository?.id, snapshot?.scopedAgentsSupported])
  const save = async (agents: Agent[]) => {
    if (!settings) throw new Error('Reload settings before saving')
    const value = await runClientEffect(
      callEffect(
        '/api/agents/settings/save',
        {
          scope,
          repositoryId: repository?.id,
          projectKey: settings.projectKey,
          includeAgents: true,
          before: settings.value,
          after: { ...settings.value, agents },
        },
        scopedSettingsResultSchema,
      ),
    )
    setSettings(value)
  }
  const own = settings?.value.agents ?? []
  const origins = scopedAgentEntries(
    snapshot?.defaults,
    repository,
    snapshot?.workspace.agents ?? [],
    scope,
  )
  const inherited = settings?.inherited.agents ?? []
  const agents = [...new Map([...inherited, ...own].map((agent) => [agent.id, agent])).values()]
  if (!snapshot?.scopedAgentsSupported)
    return (
      <Text style={styles.muted}>
        Update this environment to configure named agents at all four scopes.
      </Text>
    )
  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Text style={styles.text}>Named configurations</Text>
      <Text style={styles.muted}>
        Override inherited configurations here. Reset to use the earlier level.
      </Text>
      <Action
        label="New configuration"
        disabled={!connected || !settings || busy}
        onPress={() =>
          setEditing({
            ...defaultTaskHarness('codex'),
            permission: 'ask',
            id: randomUUID(),
            name: '',
          })
        }
      />
      {agents.map((agent) => {
        const local = own.some((entry) => entry.id === agent.id)
        const origin = origins.find((entry) => entry.agent.id === agent.id)?.scope
        const reset = inherited.some((entry) => entry.id === agent.id)
        return (
          <View key={agent.id} style={{ gap: 8 }}>
            <Text style={styles.text}>{agent.name}</Text>
            <Text style={styles.muted}>
              {local
                ? settingsScopeLabels[scope]
                : `Inherited · ${origin ? settingsScopeLabels[origin] : 'Earlier scope'}`}{' '}
              · <HarnessLabel agent={agent} /> · <ModelLabel agent={agent} />
            </Text>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Action
                secondary
                icon="settings"
                label={local ? 'Configure' : 'Override'}
                disabled={!connected || busy}
                onPress={() => setEditing(agent)}
              />
              <Action
                secondary
                label="Duplicate"
                disabled={!connected || busy}
                onPress={() =>
                  setEditing({ ...agent, id: randomUUID(), name: `${agent.name} copy` })
                }
              />
              <Action
                secondary
                icon="star"
                label={
                  snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite
                    ? 'Unfavorite'
                    : 'Favorite'
                }
                disabled={!connected || busy}
                onPress={() =>
                  act(() =>
                    runClientEffect(
                      callEffect(
                        '/api/agents/models/preference',
                        {
                          key: `agent:${agent.id}`,
                          favorite:
                            !snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]?.favorite,
                        },
                        runtimeDefaultsSchema,
                      ),
                    ),
                  )
                }
              />
              <Action
                secondary
                icon="info"
                label="Check provider"
                disabled={!connected || busy}
                onPress={() =>
                  act(async () => {
                    const result = await runClientEffect(
                      callEffect(
                        '/api/agents/probe',
                        { id: agent.id, repositoryId: repository?.id, settingsScope: scope },
                        responses.provider,
                      ),
                    )
                    setDiagnostics(
                      `${agent.name}: ${result.available ? 'Available' : 'Unavailable'} · ${result.detail}`,
                    )
                  })
                }
              />
              {local && (
                <Action
                  secondary
                  icon={reset ? 'reopen' : 'trash'}
                  label={reset ? 'Reset' : 'Delete'}
                  disabled={!connected || busy}
                  onPress={() => {
                    const remove = () =>
                      act(() => save(own.filter((entry) => entry.id !== agent.id)))
                    if (reset) remove()
                    else
                      Alert.alert(
                        'Delete configuration?',
                        'Existing threads keep their configuration.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: remove },
                        ],
                      )
                  }}
                />
              )}
            </View>
          </View>
        )
      })}
      {!agents.length && settings && (
        <Text style={styles.muted}>No named configurations at this target.</Text>
      )}
      {!!diagnostics && <Text style={styles.muted}>{diagnostics}</Text>}
      {!!(error || loadError) && <Text style={styles.error}>{error || loadError}</Text>}
      {editing && (
        <AgentEditor
          original={editing}
          creating={!agents.some((agent) => agent.id === editing.id)}
          scopeLabel={settingsScopeLabels[scope]}
          onClose={() => setEditing(null)}
          onSave={(agent) => save([...own.filter((entry) => entry.id !== agent.id), agent])}
        />
      )}
    </View>
  )
}
