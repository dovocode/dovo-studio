import { ScopedSettings } from '../runtime/preferences/settings-target'
import {
  resolveScopedSettings,
  sharedProjectKey,
  resourceScopeChoices,
  scopeEditorValue,
  scopeEditorDefaults,
  scopedSettingsResultSchema,
  resourceOrigin,
  type SettingsScope,
} from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { ScreenHeader } from '../ui/layout/screen-header'
import { ScrollView, View } from 'react-native'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { Schema, Effect } from 'effect'
import {
  resourceSettingsSchema,
  type McpServer,
  type ManagedSkill,
  type ResourceSettings,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { runClientEffect } from '@dovo/client-runtime'
import { Sheet } from '../ui/layout/sheet'
import { SettingsGroup, SettingsRow } from './settings-group'
import { Action } from '../ui/controls/action'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { ResourceEditor } from '../resources/editor'
import { CatalogPicker } from '../resources/catalog-picker'
import { SettingSource } from '../runtime/preferences/setting-source'
export default function ResourcesScreen() {
  const { styles } = useTheme()

  return (
    <View style={styles.screen}>
      <ScreenHeader title="MCP servers & skills" />
      <ScopedSettings>
        {({ scope, repository }) => (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ComputerResources selectedScope={scope} repositoryId={repository?.id} />
          </ScrollView>
        )}
      </ScopedSettings>
    </View>
  )
}
function ComputerResources({
  selectedScope,
  repositoryId,
}: {
  selectedScope: SettingsScope
  repositoryId?: string
}) {
  const { styles } = useTheme()

  const { snapshot, connected } = useRuntime()
  const [selected, setSelected] = useApplicationState('')
  const scopes = resourceScopeChoices(
    snapshot?.defaults,
    snapshot?.workspace ?? { repositories: [], agents: [] },
  )
  const visibleScopes = scopes.filter(
    (entry) =>
      (entry.scope === selectedScope && entry.repository?.id === repositoryId) ||
      (!entry.scope &&
        (selectedScope === 'environment' || selectedScope === 'environment-project')),
  )
  const current = scopes.find((scope) => scope.id === selected)
  return (
    <View
      style={{
        gap: 12,
      }}
    >
      <SettingsGroup title={connected ? 'Tools at this scope' : 'Saved tools · Offline'}>
        {visibleScopes.map((scope, index) => {
          const resources = decode(resourceSettingsSchema, scope.item.resources ?? {})
          const names = [...resources.mcpServers, ...resources.skills].map((entry) => entry.name)
          return (
            <SettingsRow
              key={scope.id}
              title={scope.item.name}
              subtitle={`${scope.label} · ${resources.mcpServers.length} MCP · ${resources.skills.length} skills${names.length ? ` · ${names.join(', ')}` : ''}`}
              icon={scope.repository ? 'folder' : 'chat'}
              last={index === visibleScopes.length - 1}
              onPress={() => setSelected(scope.id)}
            />
          )
        })}
      </SettingsGroup>
      {!scopes.length && (
        <Text style={styles.muted}>Add a project or custom agent to manage its resources.</Text>
      )}
      {current && (
        <Sheet title={current.item.name} scrollable={false} onClose={() => setSelected('')}>
          <ResourceScopeScreen scopeId={selected} />
        </Sheet>
      )}
    </View>
  )
}
function ResourceScopeScreen({ scopeId }: { scopeId: string }) {
  const { styles } = useTheme()

  const { snapshot, connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const [catalog, setCatalog] = useApplicationState<'mcp' | 'skill' | null>(null)
  const [editing, setEditing] = useApplicationState<
    | {
        kind: 'mcp'
        value?: McpServer
        replaceName?: string
        notes?: string[]
      }
    | {
        kind: 'skill'
        value?: ManagedSkill
        replaceName?: string
      }
    | null
  >(null)
  const scopes = resourceScopeChoices(
    snapshot?.defaults,
    snapshot?.workspace ?? { repositories: [], agents: [] },
  )
  const scope = scopes.find((item) => item.id === scopeId)
  const resources = decode(resourceSettingsSchema, scope?.item.resources ?? {})
  const inherited = scope?.scope
    ? resolveScopedSettings(scopeEditorDefaults(snapshot?.defaults), scope.repository, scope.scope)
        .resources
    : undefined
  const save = (update: (value: ResourceSettings) => ResourceSettings) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (!scope) return yield* Effect.fail(new Error('Choose a project or custom agent'))
        const next = decode(resourceSettingsSchema, update(resources))
        if (scope.scope) {
          const value = scopeEditorValue(snapshot?.defaults, scope.repository, scope.scope)
          yield* callEffect(
            '/api/agents/settings/save',
            {
              scope: scope.scope,
              repositoryId: scope.repository?.id,
              includeAgents: !!scope.namedAgentId,
              projectKey: sharedProjectKey(scope.repository),
              before: value,
              after: scope.namedAgentId
                ? {
                    ...value,
                    agents: value.agents?.map((agent) =>
                      agent.id === scope.namedAgentId ? { ...agent, resources: next } : agent,
                    ),
                  }
                : { ...value, resources: next },
            },
            scopedSettingsResultSchema,
          )
        } else {
          yield* callEffect(
            '/api/workspace',
            {
              collection: scope.collection,
              id: scope.item.id,
              changes: {
                resources: {
                  before: scope.item.resources ?? null,
                  after: next,
                },
              },
            },
            mutableStruct({
              revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
            }),
            'PATCH',
          )
        }
      }),
    )
  }
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <ScreenHeader title="MCP servers & skills" />
      <Text style={styles.muted}>
        Global → Computer → Project → Project on computer. Matching names override earlier scopes;
        agent entries apply last. Shared credentials must reference host environment variables.
        Changes apply on the next turn.
      </Text>
      {!scope ? (
        <Text style={styles.muted}>Add a project or custom agent first.</Text>
      ) : (
        <>
          {inherited && (
            <View style={{ gap: 8 }}>
              <Text style={styles.title}>Inherited tools</Text>
              {inherited.mcpServers
                .filter((server) => !resources.mcpServers.some((item) => item.name === server.name))
                .map((server) => (
                  <View key={`mcp:${server.name}`} style={{ gap: 4 }}>
                    <SettingSource
                      label={server.name}
                      source={resourceOrigin(
                        snapshot?.defaults,
                        scope.repository,
                        scope.scope ?? 'environment',
                        'mcpServers',
                        server.name,
                      )}
                      overridden={false}
                    />
                    <Action
                      secondary
                      label={`Override MCP · ${server.name}${server.enabled ? '' : ' · Disabled'}`}
                      disabled={!connected || busy}
                      onPress={() =>
                        setEditing({ kind: 'mcp', value: server, replaceName: server.name })
                      }
                    />
                  </View>
                ))}
              {inherited.skills
                .filter((skill) => !resources.skills.some((item) => item.name === skill.name))
                .map((skill) => (
                  <View key={`skill:${skill.name}`} style={{ gap: 4 }}>
                    <SettingSource
                      label={skill.name}
                      source={resourceOrigin(
                        snapshot?.defaults,
                        scope.repository,
                        scope.scope ?? 'environment',
                        'skills',
                        skill.name,
                      )}
                      overridden={false}
                    />
                    <Action
                      secondary
                      label={`Override skill · ${skill.name}${skill.enabled ? '' : ' · Disabled'}`}
                      disabled={!connected || busy}
                      onPress={() =>
                        act(() => save((value) => ({ ...value, skills: [...value.skills, skill] })))
                      }
                    />
                  </View>
                ))}
            </View>
          )}
          <View style={styles.card}>
            <Text style={styles.title}>MCP servers</Text>
            <View style={styles.row}>
              <Action
                label="Add MCP server"
                disabled={!connected || busy}
                onPress={() =>
                  setEditing({
                    kind: 'mcp',
                  })
                }
              />
              <Action
                secondary
                label="Browse MCP Registry"
                disabled={!connected || busy}
                onPress={() => setCatalog('mcp')}
              />
            </View>
            {resources.mcpServers.map((server) => (
              <View
                key={server.name}
                style={{
                  gap: 8,
                }}
              >
                <View style={styles.row}>
                  <Text
                    style={[
                      styles.text,
                      {
                        flex: 1,
                      },
                    ]}
                  >
                    {server.name}
                  </Text>
                  <Switch
                    accessibilityLabel={`Enable MCP ${server.name}`}
                    value={server.enabled}
                    disabled={!connected || busy}
                    onValueChange={(enabled) =>
                      act(() =>
                        save((value) => ({
                          ...value,
                          mcpServers: value.mcpServers.map((item) =>
                            item.name === server.name
                              ? {
                                  ...item,
                                  enabled,
                                }
                              : item,
                          ),
                        })),
                      )
                    }
                  />
                </View>
                <Text style={styles.muted}>
                  {server.transport === 'stdio' ? server.command : server.url}
                </Text>
                {scope.scope && (
                  <SettingSource label={server.name} source={scope.scope} overridden />
                )}
                <View style={styles.row}>
                  <Action
                    label={`Edit MCP ${server.name}`}
                    secondary
                    disabled={!connected || busy}
                    onPress={() =>
                      setEditing({
                        kind: 'mcp',
                        value: server,
                        replaceName: server.name,
                      })
                    }
                  />
                  <Action
                    label={`${inherited?.mcpServers.some((entry) => entry.name === server.name) ? 'Reset' : 'Remove'} MCP ${server.name}`}
                    secondary
                    disabled={!connected || busy}
                    onPress={() =>
                      act(() =>
                        save((value) => ({
                          ...value,
                          mcpServers: value.mcpServers.filter((item) => item.name !== server.name),
                        })),
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Skills</Text>
            <View style={styles.row}>
              <Action
                label="Add skill"
                disabled={!connected || busy}
                onPress={() =>
                  setEditing({
                    kind: 'skill',
                  })
                }
              />
              <Action
                secondary
                label="Browse skills.sh"
                disabled={!connected || busy}
                onPress={() => setCatalog('skill')}
              />
            </View>
            {resources.skills.map((skill) => (
              <View
                key={skill.name}
                style={{
                  gap: 8,
                }}
              >
                <View style={styles.row}>
                  <Text
                    style={[
                      styles.text,
                      {
                        flex: 1,
                      },
                    ]}
                  >
                    {skill.name}
                  </Text>
                  <Switch
                    accessibilityLabel={`Enable skill ${skill.name}`}
                    value={skill.enabled}
                    disabled={!connected || busy}
                    onValueChange={(enabled) =>
                      act(() =>
                        save((value) => ({
                          ...value,
                          skills: value.skills.map((item) =>
                            item.name === skill.name
                              ? {
                                  ...item,
                                  enabled,
                                }
                              : item,
                          ),
                        })),
                      )
                    }
                  />
                </View>
                <Text style={styles.muted}>{skill.description}</Text>
                {scope.scope && (
                  <SettingSource label={skill.name} source={scope.scope} overridden />
                )}
                <View style={styles.row}>
                  <Action
                    label={`Edit skill ${skill.name}`}
                    secondary
                    disabled={!connected || busy}
                    onPress={() =>
                      setEditing({
                        kind: 'skill',
                        value: skill,
                        replaceName: skill.name,
                      })
                    }
                  />
                  <Action
                    label={`${inherited?.skills.some((entry) => entry.name === skill.name) ? 'Reset' : 'Remove'} skill ${skill.name}`}
                    secondary
                    disabled={!connected || busy}
                    onPress={() =>
                      act(() =>
                        save((value) => ({
                          ...value,
                          skills: value.skills.filter((item) => item.name !== skill.name),
                        })),
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </View>
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {editing && (
        <ResourceEditor
          key={`${editing.kind}:${editing.value?.name ?? ''}`}
          editing={editing}
          scope={scope ? `${scope.label} · ${scope.item.name}` : ''}
          onClose={() => setEditing(null)}
          onSave={(result) => {
            return runClientEffect(
              mobileWorkflow(function* () {
                yield* nativeEffect(() =>
                  save((value) =>
                    result.kind === 'mcp'
                      ? {
                          ...value,
                          mcpServers: [
                            ...value.mcpServers.filter((item) => item.name !== editing.replaceName),
                            result.value,
                          ],
                        }
                      : {
                          ...value,
                          skills: [
                            ...value.skills.filter((item) => item.name !== editing.replaceName),
                            result.value,
                          ],
                        },
                  ),
                )
                setEditing(null)
              }),
            )
          }}
        />
      )}
      {catalog && (
        <CatalogPicker
          kind={catalog}
          scope={scope ? `${scope.label} · ${scope.item.name}` : ''}
          onClose={() => setCatalog(null)}
          onSelect={(entry) => {
            setCatalog(null)
            setEditing(entry)
          }}
        />
      )}
    </ScrollView>
  )
}
