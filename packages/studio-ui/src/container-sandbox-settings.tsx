import type { ReactNode } from 'react'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  containerSandboxNetworkWarning as sandboxNetworkWarning,
  defaultContainerSandboxMemoryMb,
  type ContainerSandbox,
  type ContainerSandboxStatus,
} from '@dovo/protocol'
import { Input } from './components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'
import { SettingsGroup, SettingRow } from './settings-layout'

/** Project default for container sandboxes. `undefined` inherits the broader scope. */
export function ContainerSandboxSettings({
  value,
  inherited,
  status,
  source,
  onChange,
}: {
  value: ContainerSandbox | undefined
  inherited: ContainerSandbox | undefined
  status: ContainerSandboxStatus | undefined
  source: ReactNode
  onChange: (value: ContainerSandbox | undefined) => void
}) {
  const uiText = useInterfaceText()
  const effective = value ?? inherited
  const enabled = effective?.mode === 'mise'
  const base: ContainerSandbox = effective ?? { mode: 'off' }
  const number = (text: string) => {
    const parsed = Number(text)
    return text.trim() && Number.isFinite(parsed) ? parsed : undefined
  }
  return (
    <SettingsGroup
      title={uiText('Container sandbox')}
      description={uiText(
        "Runs each new thread's agent, its commands and its terminals in a local Docker or Podman container. Only the checkout and the selected harness login are mounted. Running threads keep their setting.",
      )}
    >
      <SettingRow
        label={uiText('Sandbox')}
        description={uiText('A thread can change it before its first message.')}
        source={source}
      >
        <Select
          value={value ? value.mode : 'inherit'}
          onValueChange={(mode) =>
            onChange(
              mode === 'inherit' ? undefined : { ...base, mode: mode === 'mise' ? 'mise' : 'off' },
            )
          }
        >
          <SelectTrigger aria-label={uiText('Container sandbox')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">
              {uiText('Inherit')} (
              {inherited?.mode === 'mise' ? uiText('Mise sandbox') : uiText('Off')})
            </SelectItem>
            <SelectItem value="off">{uiText('Off')}</SelectItem>
            <SelectItem value="mise">{uiText('Mise sandbox')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {enabled && status && !status.available && status.message && (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {status.message}
        </p>
      )}
      {enabled && (
        <>
          <SettingRow
            label={uiText('Network')}
            description={uiText(
              effective?.network === 'none'
                ? sandboxNetworkWarning
                : 'Full network access. The agent can reach any address the host can.',
            )}
          >
            <Select
              value={effective?.network ?? 'full'}
              onValueChange={(network) =>
                onChange({ ...base, network: network === 'none' ? 'none' : 'full' })
              }
            >
              <SelectTrigger aria-label={uiText('Network')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{uiText('Full network')}</SelectItem>
                <SelectItem value="none">{uiText('No network')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={uiText('CPU limit')} description={uiText('Leave empty for no limit.')}>
            <Input
              aria-label={uiText('CPU limit')}
              inputMode="decimal"
              placeholder={uiText('No limit')}
              value={effective?.cpus ?? ''}
              onChange={(event) => onChange({ ...base, cpus: number(event.target.value) })}
            />
          </SettingRow>
          <SettingRow
            label={uiText('Memory limit (MB)')}
            description={uiText('Leave empty for the default of {value0} MB.', {
              value0: defaultContainerSandboxMemoryMb,
            })}
          >
            <Input
              aria-label={uiText('Memory limit (MB)')}
              inputMode="numeric"
              placeholder={String(defaultContainerSandboxMemoryMb)}
              value={effective?.memoryMb ?? ''}
              onChange={(event) => {
                const memory = number(event.target.value)
                onChange({
                  ...base,
                  memoryMb: memory === undefined ? undefined : Math.round(memory),
                })
              }}
            />
          </SettingRow>
        </>
      )}
    </SettingsGroup>
  )
}
