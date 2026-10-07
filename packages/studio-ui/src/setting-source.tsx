import * as Popover from '@radix-ui/react-popover'
import { useWorkspace } from '@dovo/studio-core'
import {
  settingBaseLabel,
  settingLayers,
  settingValueLabel,
  runtimeComputerName,
  type Repository,
  type SettingField,
} from '@dovo/protocol'
import { CornerDownRight, SlidersHorizontal, Undo2, Layers, Check } from 'lucide-react'
import { settingsScopeLabels, type SettingsScope } from '@dovo/protocol'
import { Button } from './components/ui/button'

export type SettingOrigin = {
  source: SettingsScope | 'built-in' | 'computer-default'
  overridden: boolean
}

export function SettingSource({
  origin,
  onReset,
  label,
  disabled = false,
  setting,
}: {
  origin: SettingOrigin
  setting?: { field: SettingField; repository?: Repository; scope: SettingsScope; value: unknown }
  onReset?: () => void
  label: string
  disabled?: boolean
}) {
  const { runtimes, activeRuntimeId, snapshot, connected } = useWorkspace()
  const name =
    origin.source === 'built-in'
      ? 'Dovo default'
      : origin.source === 'computer-default'
        ? 'Computer preference'
        : settingsScopeLabels[origin.source]
  const Icon = origin.overridden ? SlidersHorizontal : CornerDownRight
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
      <span
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${origin.overridden ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        {origin.overridden ? `Set here · ${name}` : `Inherited · ${name}`}
      </span>
      {setting && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              aria-label={`Sources for ${label.toLowerCase()}`}
            >
              <Layers className="size-3" /> Sources
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={6}
              align="start"
              className="z-50 max-h-[min(480px,70vh)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
            >
              <p className="mb-3 text-xs font-semibold">{label} · value sources</p>
              {runtimes.map((entry) => {
                const active = entry.profile.id === activeRuntimeId
                const state = active ? snapshot : entry.snapshot
                const repository = active
                  ? setting.repository
                  : setting.repository?.gitIdentity
                    ? state?.workspace.repositories.find(
                        (repo) =>
                          !repo.kind && repo.gitIdentity === setting.repository?.gitIdentity,
                      )
                    : undefined
                if (setting.repository && !repository && state) return null
                const online = active ? connected : entry.connected
                const rows = settingLayers(
                  state?.defaults,
                  repository,
                  setting.field,
                  active ? { scope: setting.scope, value: setting.value } : undefined,
                )
                return (
                  <section key={entry.profile.id} className="mb-3 last:mb-0">
                    <p className="mb-1 text-xs font-medium">
                      {runtimeComputerName(entry)}
                      {active ? ' · editing' : ''}
                      {!online ? ' · offline, saved snapshot' : ''}
                    </p>
                    {!state ? (
                      <p className="text-xs text-muted-foreground">No snapshot available</p>
                    ) : (
                      <>
                        {rows.map((row) => (
                          <div
                            key={row.scope}
                            className="flex items-start gap-2 rounded px-2 py-1 text-xs"
                          >
                            <span className="mt-0.5 w-3 shrink-0">
                              {row.effective && (
                                <Check
                                  aria-label="Effective value"
                                  className="size-3 text-primary"
                                />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="break-words [overflow-wrap:anywhere]">
                                {settingValueLabel(row.value)}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {settingsScopeLabels[row.scope]}
                                {active && row.scope === setting.scope ? ' · current draft' : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                        <p className="px-2 text-xs text-muted-foreground">
                          {!rows.some((row) => row.effective) ? '✓ ' : ''}
                          {settingBaseLabel(setting.field)}
                        </p>
                      </>
                    )}
                  </section>
                )
              })}
              {origin.overridden && onReset && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={onReset}
                >
                  Reset current override
                </Button>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {origin.overridden && onReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-muted-foreground"
          disabled={disabled}
          aria-label={`Use inherited ${label.toLowerCase()}`}
          onClick={onReset}
        >
          <Undo2 className="size-3" />
          Reset
        </Button>
      )}
    </div>
  )
}
