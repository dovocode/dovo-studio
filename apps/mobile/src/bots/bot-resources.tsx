import { useState } from 'react'
import { View } from 'react-native'
import {
  decode,
  botResourcesSchema,
  botResourceItems,
  type ResourceSettings,
  type BotResources as BotResourceSettings,
} from '@dovo/protocol'
import { ResourceEditor, type ResourceSelection } from '../resources/editor'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'

type Editing =
  | { kind: 'mcp'; value?: Extract<ResourceSelection, { kind: 'mcp' }>['value'] }
  | { kind: 'skill'; value?: Extract<ResourceSelection, { kind: 'skill' }>['value'] }

/** The owner supplies revision-aware storage. ResourceEditor owns credentials and validation. */
export function BotResources({
  value,
  disabled,
  inherited = { mcpServers: [], skills: [] },
  save,
  onClose,
}: {
  value: BotResourceSettings
  inherited?: ResourceSettings
  disabled: boolean
  save: (update: (current: BotResourceSettings) => BotResourceSettings) => Promise<void>
  onClose: () => void
}) {
  const { styles } = useTheme()
  const { act, busy, error } = useAction()
  const [editing, setEditing] = useState<Editing>()
  const blocked = disabled || busy
  const update = (change: (current: BotResourceSettings) => BotResourceSettings) => {
    if (disabled) return Promise.reject(new Error('Reconnect the owning computer before saving.'))
    return save((current) => decode(botResourcesSchema, change(current)))
  }
  return (
    <Sheet title="Bot MCP servers and skills" busy={busy} onClose={onClose}>
      <Text style={styles.muted}>
        These resources apply to this Bot. Changes take effect on its next turn. Saved credential
        values stay hidden.
      </Text>
      <Text style={styles.muted}>
        These controls manage Dovo resources. A harness can also load its native or global tools and
        skills. Full-access agents can read host files.
      </Text>
      {disabled && (
        <Text accessibilityRole="alert" style={styles.muted}>
          Reconnect the owning computer to edit these resources.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Text style={styles.muted}>
        Edits stay in the Bot draft. Select Save Bot to apply them. Shared definitions stay
        unchanged.
      </Text>
      {botResourceItems(inherited, { resources: value }).map((item) => (
        <View key={`${item.kind}:${item.name}`} style={{ gap: 6 }}>
          <Text>
            {item.name} · {item.kind === 'mcp' ? 'MCP server' : 'Skill'} ·{' '}
            {item.source === 'inherited'
              ? 'Inherited'
              : item.source === 'replaces-inherited'
                ? 'Bot override'
                : 'This Bot'}{' '}
            · {item.enabled ? 'Enabled' : 'Disabled'}
          </Text>
          {item.source === 'inherited' && (
            <Action
              label={`${item.disabledForBot ? 'Restore' : 'Disable'} inherited ${item.kind} ${item.name}`}
              disabled={blocked}
              secondary
              onPress={() =>
                act(() =>
                  update((current) => {
                    const key = item.kind === 'mcp' ? 'disabledMcpServers' : 'disabledSkills'
                    return {
                      ...current,
                      [key]: item.disabledForBot
                        ? current[key].filter((name) => name !== item.name)
                        : [...new Set([...current[key], item.name])],
                    }
                  }),
                )
              }
            />
          )}
        </View>
      ))}
      <Text style={styles.title}>MCP servers</Text>
      <Action
        label="Add Bot MCP server"
        disabled={blocked}
        onPress={() => setEditing({ kind: 'mcp' })}
      />
      {!value.mcpServers.length && <Text style={styles.muted}>No Bot MCP servers.</Text>}
      {value.mcpServers.map((server) => (
        <View key={server.name} style={{ gap: 8, paddingVertical: 8 }}>
          <Text>
            {server.name} · {server.enabled ? 'Enabled' : 'Disabled'}
          </Text>
          <Action
            label={`Edit MCP ${server.name}`}
            secondary
            disabled={blocked}
            onPress={() => setEditing({ kind: 'mcp', value: server })}
          />
          <Action
            label={`${server.enabled ? 'Disable' : 'Enable'} MCP ${server.name}`}
            secondary
            disabled={blocked}
            onPress={() =>
              act(() =>
                update((current) => ({
                  ...current,
                  mcpServers: current.mcpServers.map((item) =>
                    item.name === server.name ? { ...item, enabled: !server.enabled } : item,
                  ),
                })),
              )
            }
          />
          <Action
            label={
              inherited.mcpServers.some((item) => item.name === server.name)
                ? `Reset MCP ${server.name} to inherited`
                : `Remove MCP ${server.name}`
            }
            secondary
            disabled={blocked}
            onPress={() =>
              act(() =>
                update((current) => ({
                  ...current,
                  mcpServers: current.mcpServers.filter((item) => item.name !== server.name),
                })),
              )
            }
          />
        </View>
      ))}
      <Text style={styles.title}>Skills</Text>
      <Action
        label="Add Bot skill"
        disabled={blocked}
        onPress={() => setEditing({ kind: 'skill' })}
      />
      {!value.skills.length && <Text style={styles.muted}>No Bot skills.</Text>}
      {value.skills.map((skill) => (
        <View key={skill.name} style={{ gap: 8, paddingVertical: 8 }}>
          <Text>
            {skill.name} · {skill.enabled ? 'Enabled' : 'Disabled'}
          </Text>
          <Text style={styles.muted}>{skill.description}</Text>
          <Action
            label={`Edit skill ${skill.name}`}
            secondary
            disabled={blocked}
            onPress={() => setEditing({ kind: 'skill', value: skill })}
          />
          <Action
            label={`${skill.enabled ? 'Disable' : 'Enable'} skill ${skill.name}`}
            secondary
            disabled={blocked}
            onPress={() =>
              act(() =>
                update((current) => ({
                  ...current,
                  skills: current.skills.map((item) =>
                    item.name === skill.name ? { ...item, enabled: !skill.enabled } : item,
                  ),
                })),
              )
            }
          />
          <Action
            label={
              inherited.skills.some((item) => item.name === skill.name)
                ? `Reset skill ${skill.name} to inherited`
                : `Remove skill ${skill.name}`
            }
            secondary
            disabled={blocked}
            onPress={() =>
              act(() =>
                update((current) => ({
                  ...current,
                  skills: current.skills.filter((item) => item.name !== skill.name),
                })),
              )
            }
          />
        </View>
      ))}
      {editing && (
        <ResourceEditor
          key={`${editing.kind}:${editing.value?.name ?? 'new'}`}
          editing={editing}
          scope="This Bot only"
          onClose={() => setEditing(undefined)}
          onSave={async (result) => {
            await update((current) =>
              result.kind === 'mcp'
                ? {
                    ...current,
                    mcpServers: [
                      ...current.mcpServers.filter((item) => item.name !== editing.value?.name),
                      result.value,
                    ],
                  }
                : {
                    ...current,
                    skills: [
                      ...current.skills.filter((item) => item.name !== editing.value?.name),
                      result.value,
                    ],
                  },
            )
            setEditing(undefined)
          }}
        />
      )}
    </Sheet>
  )
}
