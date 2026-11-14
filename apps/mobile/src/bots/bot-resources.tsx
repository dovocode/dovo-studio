import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import type { ReactNode } from 'react'
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
import { CatalogPicker } from '../resources/catalog-picker'
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
  children,
  disabled,
  inherited = { mcpServers: [], skills: [] },
  save,
  onClose,
  kind,
}: {
  children?: ReactNode
  kind?: 'mcp' | 'skill'
  value: BotResourceSettings
  inherited?: ResourceSettings
  disabled: boolean
  save: (update: (current: BotResourceSettings) => BotResourceSettings) => Promise<void>
  onClose: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { act, busy, error } = useAction()
  const [editing, setEditing] = useState<Editing>()
  const [catalog, setCatalog] = useState<'mcp' | 'skill'>()
  const blocked = disabled || busy
  const update = (change: (current: BotResourceSettings) => BotResourceSettings) => {
    if (disabled) return Promise.reject(new Error('Reconnect the owning computer before saving.'))
    return save((current) => decode(botResourcesSchema, change(current)))
  }
  return (
    <Sheet
      title={
        kind === 'mcp'
          ? uiText('MCP servers')
          : kind === 'skill'
            ? uiText('Skills')
            : uiText('MCP servers and skills')
      }
      busy={busy}
      onClose={onClose}
    >
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'These resources apply to this Bot. Changes take effect on its next turn. Saved credential values stay hidden.'
          }
        </InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'These controls manage Dovo resources. A harness can also load its native or global tools and skills. Full-access agents can read host files.'
          }
        </InterfaceText>
      </Text>
      {children}
      {disabled && (
        <Text accessibilityRole="alert" style={styles.muted}>
          <InterfaceText>{'Reconnect the owning computer to edit these resources.'}</InterfaceText>
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Edits stay in the Bot draft. Select Save Bot to apply them. Shared definitions stay unchanged.'
          }
        </InterfaceText>
      </Text>
      {botResourceItems(inherited, { resources: value })
        .filter((item) => !kind || item.kind === kind)
        .map((item) => (
          <View key={`${item.kind}:${item.name}`} style={{ gap: 6 }}>
            <Text>
              {item.name} · {item.kind === 'mcp' ? uiText('MCP server') : uiText('Skill')} ·{' '}
              {item.source === 'inherited'
                ? uiText('Inherited')
                : item.source === 'replaces-inherited'
                  ? uiText('Bot override')
                  : uiText('This Bot')}{' '}
              · {item.enabled ? uiText('Enabled') : uiText('Disabled')}
            </Text>
            {item.source === 'inherited' && (
              <Action
                label={uiText('{value0} inherited {value1} {value2}', {
                  value0: item.disabledForBot ? 'Restore' : 'Disable',
                  value1: item.kind,
                  value2: item.name,
                })}
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
      {kind !== 'skill' && (
        <>
          <Text style={styles.title}>{uiText('MCP servers')}</Text>
          <Action
            label={uiText('Browse MCP Registry')}
            secondary
            disabled={blocked}
            onPress={() => setCatalog('mcp')}
          />
          <Action
            label={uiText('Add MCP server')}
            disabled={blocked}
            onPress={() => setEditing({ kind: 'mcp' })}
          />
          {!value.mcpServers.length && (
            <Text style={styles.muted}>
              <InterfaceText>{'No MCP servers.'}</InterfaceText>
            </Text>
          )}
          {value.mcpServers.map((server) => (
            <View key={server.name} style={{ gap: 8, paddingVertical: 8 }}>
              <Text>
                {server.name} · {server.enabled ? uiText('Enabled') : uiText('Disabled')}
              </Text>
              <Action
                label={uiText('Edit MCP {value0}', { value0: server.name })}
                secondary
                disabled={blocked}
                onPress={() => setEditing({ kind: 'mcp', value: server })}
              />
              <Action
                label={uiText('{value0} MCP {value1}', {
                  value0: server.enabled ? 'Disable' : 'Enable',
                  value1: server.name,
                })}
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
                destructive={
                  inherited.mcpServers.some((item) => item.name === server.name) ? false : true
                }
                label={
                  inherited.mcpServers.some((item) => item.name === server.name)
                    ? uiText('Reset MCP {value0} to inherited', { value0: server.name })
                    : uiText('Remove MCP {value0}', { value0: server.name })
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
        </>
      )}
      {kind !== 'mcp' && (
        <>
          <Text style={styles.title}>{uiText('Skills')}</Text>
          <Action
            label={uiText('Browse skills.sh')}
            secondary
            disabled={blocked}
            onPress={() => setCatalog('skill')}
          />
          <Action
            label={uiText('Add skill')}
            disabled={blocked}
            onPress={() => setEditing({ kind: 'skill' })}
          />
          {!value.skills.length && (
            <Text style={styles.muted}>
              <InterfaceText>{'No skills.'}</InterfaceText>
            </Text>
          )}
          {value.skills.map((skill) => (
            <View key={skill.name} style={{ gap: 8, paddingVertical: 8 }}>
              <Text>
                {skill.name} · {skill.enabled ? uiText('Enabled') : uiText('Disabled')}
              </Text>
              <Text style={styles.muted}>{skill.description}</Text>
              <Action
                label={uiText('Edit skill {value0}', { value0: skill.name })}
                secondary
                disabled={blocked}
                onPress={() => setEditing({ kind: 'skill', value: skill })}
              />
              <Action
                label={uiText('{value0} skill {value1}', {
                  value0: skill.enabled ? 'Disable' : 'Enable',
                  value1: skill.name,
                })}
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
                destructive={
                  inherited.skills.some((item) => item.name === skill.name) ? false : true
                }
                label={
                  inherited.skills.some((item) => item.name === skill.name)
                    ? uiText('Reset skill {value0} to inherited', { value0: skill.name })
                    : uiText('Remove skill {value0}', { value0: skill.name })
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
        </>
      )}
      {catalog && (
        <CatalogPicker
          kind={catalog}
          scope="This Bot only"
          onClose={() => setCatalog(undefined)}
          onSelect={(entry) => {
            setCatalog(undefined)
            setEditing(entry)
          }}
          onSkills={async (skills) => {
            await update((current) => {
              const duplicate = skills.find((skill) =>
                current.skills.some((item) => item.name === skill.name),
              )
              if (duplicate)
                throw Error(
                  `A skill named ${duplicate.name} already exists for this Bot. Edit or remove it before importing.`,
                )
              return { ...current, skills: [...current.skills, ...skills] }
            })
            setCatalog(undefined)
          }}
        />
      )}
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
