import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { Schema } from 'effect'
import {
  harnessPluginCatalogSchema,
  harnessPluginHarnesses,
  harnessPluginHarnessNames,
  harnessPluginPreviewSchema,
  harnessPluginStateSchema,
  runtimeComputerName,
  type HarnessPluginCatalog,
  type HarnessPluginCommand,
  type HarnessPluginHarness,
  type HarnessPluginPreview,
  type HarnessPluginState,
} from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const
const short = (revision: string) => revision.slice(0, 7)

/** GitHub plugin marketplaces for Claude Code and Codex on the selected computer. */
export function AgentPlugins() {
  const { call, connected, snapshot, overviews, activeId } = useRuntime()
  const { colors } = useTheme()
  const uiText = useInterfaceText()
  const computer = runtimeComputerName(
    overviews.find((entry) => entry.profile.id === activeId) ?? { snapshot },
  )
  const [state, setState] = useState<HarnessPluginState>()
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('')
  const [catalog, setCatalog] = useState<HarnessPluginCatalog>()
  const [preview, setPreview] = useState<HarnessPluginPreview>()
  const [harness, setHarness] = useState<HarnessPluginHarness>('claude')
  const [everywhere, setEverywhere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = <T extends Schema.Codec<unknown, unknown>>(
    command: HarnessPluginCommand,
    schema: T,
  ) => call('/api/agents/plugins', command, schema)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const change = (command: HarnessPluginCommand) =>
    run(async () => setState(await send(command, harnessPluginStateSchema)))
  useEffect(() => {
    if (connected) void change({ action: 'list' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])
  const card = { backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 8 } as const

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
        {uiText('Agent plugins')}
      </Text>
      <Text>
        {uiText('Add a GitHub marketplace for Claude Code or Codex on {value0}.', {
          value0: computer,
        })}
      </Text>
      {!!error && <Text style={{ color: colors.error }}>{error}</Text>}
      <Field
        label={uiText('GitHub repository')}
        placeholder={uiText('owner/repo')}
        value={repository}
        onChangeText={setRepository}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label={uiText('Branch or tag (optional)')}
        value={ref}
        onChangeText={setRef}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Action
        label={uiText('Add marketplace')}
        disabled={!connected || busy || !repository.trim()}
        onPress={() =>
          void change({
            action: 'add-marketplace',
            repository,
            ...(ref.trim() ? { ref: ref.trim() } : {}),
          }).then((added) => {
            if (!added) return
            setRepository('')
            setRef('')
          })
        }
      />
      {state?.marketplaces.map((marketplace) => (
        <View key={marketplace.id} style={card}>
          <Text style={{ fontWeight: '600' }}>{marketplace.name}</Text>
          <Text>
            {uiText('{value0} · revision {value1}', {
              value0: marketplace.ref
                ? `${marketplace.repository} @ ${marketplace.ref}`
                : marketplace.repository,
              value1: short(marketplace.revision),
            })}
          </Text>
          <View style={row}>
            <Action
              secondary
              label={
                catalog?.marketplace.id === marketplace.id
                  ? uiText('Hide plugins')
                  : uiText('Browse plugins')
              }
              disabled={busy || !connected}
              onPress={() =>
                catalog?.marketplace.id === marketplace.id
                  ? setCatalog(undefined)
                  : void run(async () => {
                      setPreview(undefined)
                      setCatalog(
                        await send(
                          { action: 'catalog', marketplaceId: marketplace.id },
                          harnessPluginCatalogSchema,
                        ),
                      )
                    })
              }
            />
            <Action
              secondary
              label={uiText('Check for updates')}
              disabled={busy || !connected}
              onPress={() =>
                void change({ action: 'refresh-marketplace', marketplaceId: marketplace.id }).then(
                  () => {
                    setCatalog(undefined)
                    setPreview(undefined)
                  },
                )
              }
            />
            <Action
              secondary
              label={uiText('Remove marketplace')}
              disabled={busy || !connected}
              onPress={() =>
                void change({ action: 'remove-marketplace', marketplaceId: marketplace.id })
              }
            />
          </View>
          {catalog?.marketplace.id === marketplace.id &&
            catalog.plugins.map((plugin) => (
              <View key={plugin.name} style={{ gap: 4 }}>
                <Text style={{ fontWeight: '600' }}>
                  {plugin.name}
                  {plugin.version ? ` ${plugin.version}` : ''}
                </Text>
                {!!plugin.description && <Text>{plugin.description}</Text>}
                {plugin.unsupported ? (
                  <Text>{uiText('Unavailable: {value0}', { value0: plugin.unsupported })}</Text>
                ) : (
                  <Action
                    secondary
                    label={uiText('Review {value0}', { value0: plugin.name })}
                    disabled={busy || !connected}
                    onPress={() =>
                      void run(async () =>
                        setPreview(
                          await send(
                            {
                              action: 'preview',
                              marketplaceId: marketplace.id,
                              plugin: plugin.name,
                            },
                            harnessPluginPreviewSchema,
                          ),
                        ),
                      )
                    }
                  />
                )}
              </View>
            ))}
        </View>
      ))}
      {preview && (
        <View style={{ ...card, borderWidth: 1, borderColor: colors.accent }}>
          <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
            {uiText('Review {value0}', { value0: preview.plugin.name })}
            {preview.plugin.version ? ` ${preview.plugin.version}` : ''}
          </Text>
          <Text>
            {uiText('{value0} · revision {value1} · {value2} files · {value3} KB', {
              value0: preview.repository,
              value1: short(preview.revision),
              value2: preview.files,
              value3: Math.ceil(preview.bytes / 1024),
            })}
          </Text>
          <Text>
            {uiText('Skills: {value0}', {
              value0: preview.components.skills.join(', ') || uiText('none'),
            })}
          </Text>
          <Text>
            {uiText('Commands: {value0}', {
              value0: preview.components.commands.join(', ') || uiText('none'),
            })}
          </Text>
          <Text>
            {uiText('Agents: {value0}', {
              value0: preview.components.agents.join(', ') || uiText('none'),
            })}
          </Text>
          <Text>
            {preview.components.hooks
              ? uiText('Hooks: yes. Hooks run shell commands during agent work.')
              : uiText('Hooks: none')}
          </Text>
          <Text>
            {preview.components.mcpServers.length
              ? uiText('MCP servers: {value0}. These start processes or connect to services.', {
                  value0: preview.components.mcpServers.join(', '),
                })
              : uiText('MCP servers: none')}
          </Text>
          <Choice
            label={uiText('Install for, on {value0}', { value0: computer })}
            value={harness}
            items={harnessPluginHarnesses.map((id) => ({
              id,
              name: harnessPluginHarnessNames[id],
            }))}
            onChange={(id) => setHarness(id === 'codex' ? 'codex' : 'claude')}
          />
          <Text>
            {harness === 'claude'
              ? uiText('Claude Code threads load the plugin according to their project settings.')
              : uiText('Codex plugin activation also applies to the Codex CLI on this computer.')}
          </Text>
          <Choice
            label={uiText('Turn on for')}
            value={everywhere ? 'all' : 'none'}
            items={[
              {
                id: 'none',
                name:
                  harness === 'claude'
                    ? uiText('Only projects or organizations that turn it on')
                    : uiText('Install without turning it on'),
              },
              { id: 'all', name: uiText('All projects on this computer') },
            ]}
            onChange={(id) => setEverywhere(id === 'all')}
          />
          <View style={row}>
            <Action
              label={uiText('Install for {value0}', {
                value0: harnessPluginHarnessNames[harness],
              })}
              disabled={busy || !connected}
              onPress={() =>
                void change({
                  action: 'install',
                  marketplaceId: preview.marketplaceId,
                  plugin: preview.plugin.name,
                  revision: preview.revision,
                  harness,
                  enabled: everywhere,
                }).then((installed) => {
                  if (installed) setPreview(undefined)
                })
              }
            />
            <Action
              secondary
              label={uiText('Close review')}
              onPress={() => setPreview(undefined)}
            />
          </View>
        </View>
      )}
      {state?.plugins.map((plugin) => (
        <View key={plugin.id} style={card}>
          <Text style={{ fontWeight: '600' }}>
            {plugin.name}
            {plugin.version ? ` ${plugin.version}` : ''} ·{' '}
            {harnessPluginHarnessNames[plugin.harness]}
            {plugin.enabled
              ? uiText(' · on for all projects')
              : plugin.harness === 'claude'
                ? uiText(' · on only where a project or organization turns it on')
                : uiText(' · off')}
          </Text>
          <Text>
            {uiText('{value0} · revision {value1}', {
              value0: plugin.repository,
              value1: short(plugin.revision),
            })}
          </Text>
          <View style={row}>
            <Action
              secondary
              label={
                plugin.enabled
                  ? uiText('Turn off {value0} for all projects', { value0: plugin.name })
                  : uiText('Turn on {value0} for all projects', { value0: plugin.name })
              }
              disabled={busy || !connected}
              onPress={() =>
                void change({ action: 'set-enabled', id: plugin.id, enabled: !plugin.enabled })
              }
            />
            <Action
              secondary
              label={uiText('Remove {value0}', { value0: plugin.name })}
              disabled={busy || !connected}
              onPress={() => void change({ action: 'remove', id: plugin.id })}
            />
          </View>
        </View>
      ))}
      <Text>{uiText('Changes apply to new agent sessions.')}</Text>
    </View>
  )
}
