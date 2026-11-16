import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  containerSandboxNetworkWarning as sandboxNetworkWarning,
  defaultContainerSandboxMemoryMb,
  type ContainerSandbox,
  type ContainerSandboxStatus,
} from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsGroup } from '../../screens/settings-group'

/** Project default for container sandboxes. `undefined` inherits the broader scope. */
export function ContainerSandboxSettings({
  value,
  inherited,
  status,
  source,
  disabled,
  onChange,
}: {
  value: ContainerSandbox | undefined
  inherited: ContainerSandbox | undefined
  status: ContainerSandboxStatus | undefined
  source: ReactNode
  disabled: boolean
  onChange: (value: ContainerSandbox | undefined) => void
}) {
  const uiText = useInterfaceText()
  const { colors } = useTheme()
  const effective = value ?? inherited
  const enabled = effective?.mode === 'mise'
  const base: ContainerSandbox = effective ?? { mode: 'off' }
  const muted = { color: colors.muted, fontSize: 13 }
  const number = (text: string) => {
    const parsed = Number(text)
    return text.trim() && Number.isFinite(parsed) ? parsed : undefined
  }
  return (
    <SettingsGroup title={uiText('Container sandbox')}>
      <View style={{ padding: 16, gap: 12 }}>
        <Choice
          row
          label={uiText('Sandbox')}
          value={value ? value.mode : 'inherit'}
          disabled={disabled}
          items={[
            {
              id: 'inherit',
              name: `${uiText('Inherit')} (${inherited?.mode === 'mise' ? uiText('Mise sandbox') : uiText('Off')})`,
            },
            { id: 'off', name: uiText('Off') },
            { id: 'mise', name: uiText('Mise sandbox') },
          ]}
          onChange={(mode) =>
            onChange(
              mode === 'inherit' ? undefined : { ...base, mode: mode === 'mise' ? 'mise' : 'off' },
            )
          }
        />
        {source}
        <Text style={muted}>
          {uiText(
            "Runs each new thread's agent, its commands and its terminals in a local Docker or Podman container. Only the checkout and the selected harness login are mounted. Running threads keep their setting.",
          )}
        </Text>
        {enabled && status && !status.available && status.message && (
          <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13 }}>
            {status.message}
          </Text>
        )}
        {enabled && (
          <>
            <Choice
              row
              label={uiText('Network')}
              value={effective?.network ?? 'full'}
              disabled={disabled}
              items={[
                { id: 'full', name: uiText('Full network') },
                { id: 'none', name: uiText('No network') },
              ]}
              onChange={(network) =>
                onChange({ ...base, network: network === 'none' ? 'none' : 'full' })
              }
            />
            {effective?.network === 'none' && (
              <Text style={muted}>{uiText(sandboxNetworkWarning)}</Text>
            )}
            <Field
              label={uiText('CPU limit')}
              keyboardType="decimal-pad"
              editable={!disabled}
              placeholder={uiText('No limit')}
              value={effective?.cpus === undefined ? '' : String(effective.cpus)}
              onChangeText={(text) => onChange({ ...base, cpus: number(text) })}
            />
            <Field
              label={uiText('Memory limit (MB)')}
              keyboardType="number-pad"
              editable={!disabled}
              placeholder={String(defaultContainerSandboxMemoryMb)}
              value={effective?.memoryMb === undefined ? '' : String(effective.memoryMb)}
              onChangeText={(text) => {
                const memory = number(text)
                onChange({
                  ...base,
                  memoryMb: memory === undefined ? undefined : Math.round(memory),
                })
              }}
            />
          </>
        )}
      </View>
    </SettingsGroup>
  )
}
