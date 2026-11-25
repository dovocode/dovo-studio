import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  harnessPluginHarnessNames,
  harnessPluginStateSchema,
  type InstalledHarnessPlugin,
  type ResourceSettings,
} from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { useSettingsTheme as useTheme } from '../screens/settings-theme'

/** Turns installed Claude Code plugins on or off at the selected scope, such as an organization. */
export function PluginActivations({
  resources,
  inherited,
  scopeLabel,
  disabled,
  save,
}: {
  resources: ResourceSettings
  inherited?: ResourceSettings
  scopeLabel: string
  disabled: boolean
  save: (update: (value: ResourceSettings) => ResourceSettings) => Promise<unknown>
}) {
  const { call, connected, snapshot } = useRuntime()
  const { styles } = useTheme()
  const uiText = useInterfaceText()
  const supported = snapshot?.harnessPluginsSupported === true
  const [installed, setInstalled] = useState<InstalledHarnessPlugin[]>()
  useEffect(() => {
    if (!supported || !connected) return
    void call('/api/agents/plugins', { action: 'list' }, harnessPluginStateSchema).then(
      (state) => setInstalled(state.plugins),
      () => {},
    )
  }, [supported, connected, call])
  if (!supported) return null
  const here = new Map((resources.plugins ?? []).map((plugin) => [plugin.name, plugin.enabled]))
  const above = new Map((inherited?.plugins ?? []).map((plugin) => [plugin.name, plugin.enabled]))
  const missing = [...here.keys()].filter(
    (name) => !installed?.some((plugin) => plugin.id === name),
  )
  const choose = (name: string, choice: string) =>
    void save((value) => ({
      ...value,
      // Always send the list, so an empty list removes the last choice at this scope.
      plugins: [
        ...(value.plugins ?? []).filter((plugin) => plugin.name !== name),
        ...(choice === 'inherit' ? [] : [{ name, enabled: choice === 'on' }]),
      ],
    })).catch(() => {})
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
        {uiText('Agent plugins')}
      </Text>
      <Text style={styles.muted}>
        {uiText(
          'Turn Claude Code plugins on or off for {value0}. Install plugins in Studio extensions.',
          { value0: scopeLabel },
        )}
      </Text>
      {installed && !installed.length && !missing.length && (
        <Text style={styles.muted}>{uiText('No plugins installed on this computer.')}</Text>
      )}
      {installed?.map((plugin) => {
        const own = here.get(plugin.id)
        const effective = own ?? above.get(plugin.id) ?? plugin.enabled
        return plugin.harness === 'claude' ? (
          <Choice
            key={plugin.id}
            label={uiText('{value0} · {value1} · now {value2}', {
              value0: plugin.name,
              value1: harnessPluginHarnessNames.claude,
              value2: effective ? uiText('on') : uiText('off'),
            })}
            value={own === undefined ? 'inherit' : own ? 'on' : 'off'}
            disabled={disabled}
            items={[
              { id: 'inherit', name: uiText('Inherit') },
              { id: 'on', name: uiText('On') },
              { id: 'off', name: uiText('Off') },
            ]}
            onChange={(choice) => choose(plugin.id, choice)}
          />
        ) : (
          <Text key={plugin.id} style={styles.muted}>
            {uiText('{value0} · Codex · {value1} for the whole computer.', {
              value0: plugin.name,
              value1: plugin.enabled ? uiText('on') : uiText('off'),
            })}
          </Text>
        )
      })}
      {missing.map((name) => (
        <View key={name} style={{ gap: 4 }}>
          <Text>
            {uiText('{value0} has a saved group choice and is unavailable on this computer.', {
              value0: name.split('@')[0],
            })}
          </Text>
          <Action
            secondary
            label={uiText('Remove choice for {value0}', { value0: name.split('@')[0] })}
            disabled={disabled}
            onPress={() => choose(name, 'inherit')}
          />
        </View>
      ))}
    </View>
  )
}
