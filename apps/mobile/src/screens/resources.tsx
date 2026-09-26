import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { ScreenHeader } from '../ui/screen-header'
import { ScrollView, View } from 'react-native'
import { Switch } from '../ui/switch'
import { Text } from '../ui/text'
import { Schema, Effect } from 'effect'
import {
  resourceSettingsSchema,
  type McpServer,
  type ManagedSkill,
  type ResourceSettings,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { clientScopeKey, runClientEffect } from '@dovo/client-runtime'
import { Sheet } from '../ui/sheet'
import { SettingsGroup, SettingsRow } from './settings-group'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { ResourceEditor } from '../resources/editor'
import { CatalogPicker } from '../resources/catalog-picker'
export default function ResourcesScreen() {
  const { overviews } = useRuntime()
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="MCP servers & skills" />
      <Text style={styles.muted}>Project and agent resources across your computers.</Text>
      {!overviews.length && (
        <Text style={styles.muted}>Connect a computer to manage resources.</Text>
      )}
      {overviews.map((entry) => (
        <RuntimeScope key={clientScopeKey(entry.profile.connection)} runtimeId={entry.profile.id}>
          <ComputerResources name={entry.profile.name} />
        </RuntimeScope>
      ))}
    </ScrollView>
  )
}
function ComputerResources({ name }: { name: string }) {
  const { snapshot, connected } = useRuntime()
  const [selected, setSelected] = useApplicationState('')
  const scopes = [
    ...(snapshot?.workspace.repositories ?? []).map((item) => ({
      item,
      id: `project:${item.id}`,
      label: 'Project',
    })),
    ...(snapshot?.workspace.agents ?? []).map((item) => ({
      item,
      id: `agent:${item.id}`,
      label: 'Agent',
    })),
  ]
  const current = scopes.find((scope) => scope.id === selected)
  return (
    <View
      style={{
        gap: 12,
      }}
    >
      <SettingsGroup title={`${name}${connected ? '' : ' · Offline'}`}>
        {scopes.map((scope, index) => {
          const resources = decode(resourceSettingsSchema, scope.item.resources ?? {})
          const names = [...resources.mcpServers, ...resources.skills].map((entry) => entry.name)
          return (
            <SettingsRow
              key={scope.id}
              title={scope.item.name}
              subtitle={`${scope.label} · ${resources.mcpServers.length} MCP · ${resources.skills.length} skills${names.length ? ` · ${names.join(', ')}` : ''}`}
              icon={scope.label === 'Project' ? 'folder' : 'chat'}
              last={index === scopes.length - 1}
              onPress={() => setSelected(scope.id)}
            />
          )
        })}
      </SettingsGroup>
      {!scopes.length && (
        <Text style={styles.muted}>Add a project or custom agent to manage its resources.</Text>
      )}
      {current && (
        <Sheet
          title={`${current.item.name} · ${name}`}
          scrollable={false}
          onClose={() => setSelected('')}
        >
          <ResourceScopeScreen scopeId={selected} />
        </Sheet>
      )}
    </View>
  )
}
function ResourceScopeScreen({ scopeId }: { scopeId: string }) {
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
  const scopes = [
    ...(snapshot?.workspace.repositories ?? []).map((item) => ({
      id: `project:${item.id}`,
      name: `Project · ${item.name}`,
      item,
      collection: 'repositories' as const,
    })),
    ...(snapshot?.workspace.agents ?? []).map((item) => ({
      id: `agent:${item.id}`,
      name: `Agent · ${item.name}`,
      item,
      collection: 'agents' as const,
    })),
  ]
  const scope = scopes.find((item) => item.id === scopeId)
  const resources = decode(resourceSettingsSchema, scope?.item.resources ?? {})
  const save = (update: (value: ResourceSettings) => ResourceSettings) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (!scope) return yield* Effect.fail(new Error('Choose a project or custom agent'))
        const next = decode(resourceSettingsSchema, update(resources))
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
            revision: Schema.Number.pipe(Schema.finite()),
          }),
          'PATCH',
        )
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
        Project resources apply to its tasks. Custom-agent entries override matching project names,
        including disabled entries. Changes apply on the next turn.
      </Text>
      {!scope ? (
        <Text style={styles.muted}>Add a project or custom agent first.</Text>
      ) : (
        <>
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
                    label={`Remove MCP ${server.name}`}
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
                    label={`Remove skill ${skill.name}`}
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
          scope={scope?.name ?? ''}
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
          scope={scope?.name ?? ''}
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
