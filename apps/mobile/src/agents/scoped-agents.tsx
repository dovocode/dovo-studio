import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  builtInAgentDefinition,
  type Agent,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingsAction as Action } from '../screens/settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, callEffect, connected } = useRuntime()
  const { busy, error, act } = useAction()
  const [settings, setSettings] = useApplicationState<
    typeof scopedSettingsResultSchema.Type | null
  >(null)
  const [loadError, setLoadError] = useApplicationState('')
  const [diagnostics, setDiagnostics] = useApplicationState('')
  const [editing, setEditing] = useApplicationState<Agent | null>(null)
  const [expandedId, setExpandedId] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    setSettings(null)
    setLoadError('')
    setSaved(false)
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
  }, [callEffect, connected, scope, repository?.id, snapshot?.scopedAgentsSupported, retry])
  const save = async (agents: Agent[]) => {
    setSaved(false)
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
    setSaved(true)
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
        <InterfaceText>
          {'Update this environment to configure named agents at all four scopes.'}
        </InterfaceText>
      </Text>
    )
  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>
        <InterfaceText>{'Agent profiles'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Built-in providers use your computer’s installation and login. Save an override here, or reset to the earlier level.'
          }
        </InterfaceText>
      </Text>
      {!settings && !loadError && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {connected
            ? uiText('Loading agent profiles…')
            : uiText('This computer is offline. Reconnect to load agent profiles.')}
        </Text>
      )}
      <Action
        label={uiText('New configuration')}
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
                ? uiText('Set here · {value0}', { value0: settingsScopeLabels[scope] })
                : origin === 'built-in'
                  ? uiText('Built-in · provider defaults')
                  : uiText('Inherited · {value0}', {
                      value0: origin ? settingsScopeLabels[origin] : 'Earlier scope',
                    })}{' '}
              · <HarnessLabel agent={agent} /> · <ModelLabel agent={agent} />
            </Text>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Action
                secondary
                icon="settings"
                label={local ? uiText('Configure') : uiText('Override')}
                disabled={!connected || busy}
                onPress={() => setEditing(agent)}
              />
              <Action
                secondary
                icon="more"
                label={uiText('More actions for {value0}', { value0: agent.name })}
                disabled={busy}
                onPress={() => setExpandedId(expandedId === agent.id ? '' : agent.id)}
              />
              {expandedId === agent.id && (
                <>
                  <Action
                    secondary
                    label={uiText('Duplicate')}
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
                        ? uiText('Unfavorite')
                        : uiText('Favorite')
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
                                !snapshot?.defaults?.modelPreferences?.[`agent:${agent.id}`]
                                  ?.favorite,
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
                    label={uiText('Check provider')}
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
                      destructive={reset ? false : true}
                      secondary
                      icon={reset ? 'reopen' : 'trash'}
                      label={reset ? uiText('Reset') : uiText('Delete')}
                      disabled={!connected || busy}
                      onPress={() => {
                        const remove = () =>
                          act(() => save(own.filter((entry) => entry.id !== agent.id)))
                        if (reset) remove()
                        else
                          Alert.alert(
                            uiText('Delete configuration?'),
                            uiText('Existing threads keep their configuration.'),
                            [
                              { text: uiText('Cancel'), style: 'cancel' },
                              { text: uiText('Delete'), style: 'destructive', onPress: remove },
                            ],
                          )
                      }}
                    />
                  )}
                </>
              )}
            </View>
          </View>
        )
      })}
      {!agents.length && settings && (
        <Text style={styles.muted}>
          <InterfaceText>{'No named configurations at this target.'}</InterfaceText>
        </Text>
      )}
      {!!diagnostics && <Text style={styles.muted}>{diagnostics}</Text>}
      {saved && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          <InterfaceText values={{ value0: settingsScopeLabels[scope] }}>
            {'Agent profiles saved at {value0}.'}
          </InterfaceText>
        </Text>
      )}
      {!!(error || loadError) && <Text style={styles.error}>{error || loadError}</Text>}
      {!!loadError && (
        <Action
          secondary
          label={uiText('Retry agent profiles')}
          disabled={!connected || busy}
          onPress={() => setRetry(retry + 1)}
        />
      )}
      {editing && (
        <AgentEditor
          shared={scope === 'global' || scope === 'project'}
          original={editing}
          creating={!agents.some((agent) => agent.id === editing.id)}
          scopeLabel={settingsScopeLabels[scope]}
          fixedProvider={!!builtInAgentDefinition(editing.id)}
          onClose={() => setEditing(null)}
          onSave={(agent) => save([...own.filter((entry) => entry.id !== agent.id), agent])}
        />
      )}
    </View>
  )
}
