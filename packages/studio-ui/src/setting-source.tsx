import * as Popover from '@radix-ui/react-popover'
import { useOptionalSettingsTarget, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  scopedSettingsResultSchema,
  settingBaseLabel,
  settingLayers,
  settingOverrides,
  settingValueLabel,
  runtimeComputerName,
  type Repository,
  type SettingField,
  type SettingOverride,
} from '@dovo/protocol'
import {
  CornerDownRight,
  SlidersHorizontal,
  Undo2,
  Layers,
  Check,
  ArrowUpRight,
} from 'lucide-react'
import { settingsScopeLabels, type SettingsScope } from '@dovo/protocol'
import { Button } from './components/ui/button'

export type SettingOrigin = {
  source: SettingsScope | 'built-in' | 'computer-default'
  overridden: boolean
}
const popoverClassName =
  'z-50 max-h-[min(480px,70vh)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg'
const overrideName = (entry: SettingOverride) =>
  [entry.project, entry.computer].filter(Boolean).join(' on ')

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
  const { runtimes, activeRuntimeId, snapshot, connected, request, readRuntime } = useWorkspace()
  const settingsTarget = useOptionalSettingsTarget()
  const [resetState, setResetState] = useApplicationState<{ busy: boolean; message: string }>({
    busy: false,
    message: '',
  })
  const name =
    origin.source === 'built-in'
      ? 'Dovo default'
      : origin.source === 'computer-default'
        ? 'Computer preference'
        : settingsScopeLabels[origin.source]
  const Icon = origin.overridden ? SlidersHorizontal : CornerDownRight
  // Origin-only badges render outside the settings pages; only field badges read the fleet.
  const sources = setting
    ? runtimes.map((entry) => ({
        profile: entry.profile,
        name: runtimeComputerName(entry),
        connected: entry.profile.id === activeRuntimeId ? connected : entry.connected,
        snapshot: entry.profile.id === activeRuntimeId ? snapshot : entry.snapshot,
      }))
    : []
  const overrides = setting
    ? settingOverrides(sources, setting.field, {
        scope: setting.scope,
        repository: setting.repository,
        environmentId:
          setting.scope === 'environment' || setting.scope === 'environment-project'
            ? (activeRuntimeId ?? undefined)
            : undefined,
      })
    : []
  async function resetOverrides() {
    if (!setting) return
    if (
      !window.confirm(
        `Remove the ${label.toLowerCase()} override at ${overrides.length} later ${overrides.length === 1 ? 'level' : 'levels'}? They inherit the earlier value again.`,
      )
    )
      return
    setResetState({ busy: true, message: '' })
    const failures: string[] = []
    let done = 0
    for (const entry of overrides) {
      const source = sources.find((candidate) => candidate.profile.id === entry.environmentId)
      const where = `${settingsScopeLabels[entry.scope]} · ${overrideName(entry)}`
      if (!source?.connected) {
        failures.push(`${where}: ${source?.name ?? 'computer'} is offline`)
        continue
      }
      const call = (path: string, input: unknown) =>
        source.profile.id === activeRuntimeId
          ? request(path, input, scopedSettingsResultSchema)
          : readRuntime(source.profile, path, input, scopedSettingsResultSchema, 'POST')
      try {
        const scoped = { scope: entry.scope, repositoryId: entry.repositoryId }
        const current = await call('/api/agents/settings/read', scoped)
        const kept = Object.fromEntries(
          Object.entries(current.value[setting.field.group] ?? {}).filter(
            ([key]) => key !== setting.field.key,
          ),
        )
        await call('/api/agents/settings/save', {
          ...scoped,
          projectKey: current.projectKey,
          before: current.value,
          after: { ...current.value, [setting.field.group]: kept },
        })
        done++
      } catch (error) {
        failures.push(`${where}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setResetState({
      busy: false,
      message: [done ? `Reset ${done} ${done === 1 ? 'override' : 'overrides'}.` : '', ...failures]
        .filter(Boolean)
        .join(' '),
    })
  }
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
            <Popover.Content sideOffset={6} align="start" className={popoverClassName}>
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
      {setting && overrides.length > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-amber-600 dark:text-amber-400"
              aria-label={`${label}: overridden at ${overrides.length} later ${overrides.length === 1 ? 'level' : 'levels'}`}
            >
              <Layers className="size-3" /> Overridden by {overrides.length}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content sideOffset={6} align="start" className={popoverClassName}>
              <p className="mb-1 text-xs font-semibold">{label} · later levels</p>
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                These levels keep their own value when {settingsScopeLabels[setting.scope]} changes.
                Open one to edit it, or reset them all to inherit again.
              </p>
              {overrides.map((entry) => (
                <div
                  key={`${entry.scope}:${entry.environmentId}:${entry.repositoryId ?? ''}`}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words [overflow-wrap:anywhere]">
                      {settingValueLabel(entry.value)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {settingsScopeLabels[entry.scope]} · {overrideName(entry)}
                    </p>
                  </div>
                  {settingsTarget && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-1.5 text-[11px]"
                      aria-label={`Open ${settingsScopeLabels[entry.scope]} settings for ${overrideName(entry)}`}
                      onClick={() => settingsTarget.setTarget(entry.target)}
                    >
                      Open <ArrowUpRight className="size-3" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || resetState.busy}
                  aria-label={`Reset all later ${label.toLowerCase()} overrides`}
                  onClick={() => void resetOverrides()}
                >
                  <Undo2 className="size-3" />
                  {resetState.busy ? 'Resetting…' : 'Reset all'}
                </Button>
                {resetState.message && (
                  <p role="status" className="text-[11px] text-muted-foreground">
                    {resetState.message}
                  </p>
                )}
              </div>
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
