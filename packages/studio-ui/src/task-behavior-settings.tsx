import { useEffect, useRef, useState } from 'react'
import {
  settingsChangeCount,
  settingsChanges,
  validSettingsDays,
  runtimePreferencesSchema,
  scopedSettingsResultSchema,
  taskBehaviorOrigin,
  type Repository,
  type SettingsScope,
  type TaskBehavior,
} from '@dovo/protocol'
import { useSettingsDraft, useWorkspace } from '@dovo/studio-core'
import { SettingsGroup, SettingRow, SettingsSaveBar } from './settings-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { SettingSource } from './setting-source'

const fields = [
  [
    'quotaResume',
    'Auto-resume limited tasks',
    'Continue at the provider’s reported reset time. Each task can cancel its continuation.',
  ],
  [
    'quotaSnooze',
    'Snooze limited tasks',
    'Hide quota stops until their reported reset time. Combine with auto-resume to continue when they wake.',
  ],
  [
    'settleMerged',
    'Auto-settle merged tasks',
    'Move idle tasks to Settled when their pull request merges.',
  ],
  [
    'settleClosed',
    'Auto-settle closed tasks',
    'Move idle tasks to Settled when their pull request closes.',
  ],
  [
    'settleInactive',
    'Auto-settle inactive tasks',
    'Settle idle tasks after the selected period. Pins, drafts and pending work are protected.',
  ],
  [
    'autoArchiveSettled',
    'Auto-archive settled tasks',
    'Archive tasks after they remain in Settled for the selected period. Reopening resets the clock; pins, drafts and pending work are protected.',
  ],
  [
    'continueAfterRestart',
    'Continue tasks after restarts',
    'Resume interrupted turns after a runtime update, crash or computer restart.',
  ],
] as const

export function TaskBehaviorSettings({
  scope,
  repository,
}: {
  scope: SettingsScope
  repository?: Repository
}) {
  const { request, connected, snapshot } = useWorkspace()
  const [loaded, setLoaded] = useState<typeof scopedSettingsResultSchema.Type | null>(null)
  const [draft, setDraft] = useState<TaskBehavior>({})
  const [error, setError] = useState('')
  const [dayInputs, setDayInputs] = useState<
    Partial<Record<'inactiveDays' | 'archiveAfterSettledDays', string>>
  >({})
  const invalidDays = Object.values(dayInputs).some(
    (value) => value !== undefined && !validSettingsDays(value),
  )
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [legacy, setLegacy] = useState<typeof runtimePreferencesSchema.Type | null>(null)
  const [retry, setRetry] = useState(0)
  const dirty =
    !!loaded &&
    (invalidDays || JSON.stringify(draft) !== JSON.stringify(loaded.value.taskBehavior ?? {}))
  const protectDraft = useRef(false)
  const loadedTarget = useRef('')
  protectDraft.current = dirty
  useSettingsDraft(dirty, busy)
  useEffect(() => {
    let active = true
    const target = `${scope}:${repository?.id ?? ''}`
    if (protectDraft.current && loadedTarget.current === target) return
    setLoaded(null)
    setError('')
    if (connected)
      void request('/api/runtime/preferences/read', {}, runtimePreferencesSchema).then(
        (value) => {
          if (active) setLegacy(value)
        },
        (cause) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
    if (connected)
      void request(
        '/api/agents/settings/read',
        { scope, repositoryId: repository?.id },
        scopedSettingsResultSchema,
      ).then(
        (value) => {
          if (active) {
            loadedTarget.current = target
            setLoaded(value)
            setDraft(value.value.taskBehavior ?? {})
            setDayInputs({})
            setSaved(false)
          }
        },
        (cause) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
    return () => {
      active = false
    }
  }, [request, connected, scope, repository?.id, retry])
  const supported = snapshot?.taskBehaviorSupported === true
  const inherited = loaded?.inherited.taskBehavior
  const fallback = (key: (typeof fields)[number][0]) =>
    inherited?.[key] ??
    (key === 'continueAfterRestart'
      ? legacy?.autoContinueAfterRestart
      : key === 'settleMerged' || key === 'settleClosed'
        ? legacy?.settleOnPullClose
        : false) ??
    false
  const archivePolicy = !legacy
    ? 'Computer policy · loading…'
    : legacy.autoArchiveDays
      ? `Computer policy · ${legacy.autoArchiveDays} days of inactivity`
      : 'Computer policy · Never'
  function change(value: TaskBehavior) {
    setDraft(value)
    setSaved(false)
  }
  async function save() {
    if (!loaded || invalidDays) return
    setBusy(true)
    setError('')
    try {
      const value = await request(
        '/api/agents/settings/save',
        {
          scope,
          repositoryId: repository?.id,
          projectKey: loaded.projectKey,
          before: loaded.value,
          after: { ...loaded.value, taskBehavior: draft },
        },
        scopedSettingsResultSchema,
      )
      setLoaded(value)
      setDraft(value.value.taskBehavior ?? {})
      setDayInputs({})
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      {!supported && (
        <p role="status" className="text-xs text-muted-foreground">
          Update this computer’s runtime to configure scoped lifecycle settings.
        </p>
      )}
      <fieldset disabled={!supported || !connected || !loaded || busy}>
        <SettingsGroup
          title="Task lifecycle"
          description="Applies to existing tasks as well as new ones. Choose Inherit to follow the earlier settings level."
        >
          {fields.map(([key, label, description]) => (
            <SettingRow
              key={key}
              label={label}
              description={description}
              source={
                <SettingSource
                  label={label}
                  setting={{
                    field: { group: 'taskBehavior', key },
                    repository,
                    scope,
                    value: draft[key],
                    inheritedValue:
                      key === 'autoArchiveSettled' && inherited?.[key] === undefined
                        ? archivePolicy
                        : fallback(key),
                  }}
                  origin={taskBehaviorOrigin(
                    snapshot?.defaults,
                    repository,
                    scope,
                    draft,
                    key,
                    key === 'continueAfterRestart' ||
                      key === 'settleMerged' ||
                      key === 'settleClosed' ||
                      key === 'autoArchiveSettled',
                  )}
                  onReset={() => change({ ...draft, [key]: undefined })}
                />
              }
            >
              <Select
                disabled={key === 'autoArchiveSettled' && !snapshot?.threadBehaviorSupported}
                value={draft[key] === undefined ? 'inherit' : draft[key] ? 'on' : 'off'}
                onValueChange={(value) =>
                  change({ ...draft, [key]: value === 'inherit' ? undefined : value === 'on' })
                }
              >
                <SelectTrigger aria-label={label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    Inherit (
                    {key === 'autoArchiveSettled' && inherited?.[key] === undefined
                      ? archivePolicy
                      : fallback(key)
                        ? 'On'
                        : 'Off'}
                    )
                  </SelectItem>
                  <SelectItem value="on">On</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          ))}
          <SettingRow
            label="Days of inactivity before settling"
            description={`Effective: ${draft.inactiveDays ?? inherited?.inactiveDays ?? 3} days. Applies when automatic settling is on.`}
            source={
              <SettingSource
                label="Days of inactivity before settling"
                setting={{
                  field: { group: 'taskBehavior', key: 'inactiveDays' },
                  repository,
                  scope,
                  value: draft.inactiveDays,
                  inheritedValue: inherited?.inactiveDays ?? 3,
                }}
                origin={taskBehaviorOrigin(
                  snapshot?.defaults,
                  repository,
                  scope,
                  draft,
                  'inactiveDays',
                )}
                onReset={() => {
                  change({ ...draft, inactiveDays: undefined })
                  setDayInputs((current) => ({ ...current, inactiveDays: undefined }))
                }}
              />
            }
          >
            <div className="space-y-1">
              <Input
                aria-label="Days of inactivity before settling"
                type="text"
                inputMode="numeric"
                min={1}
                max={365}
                className="w-24"
                placeholder={String(inherited?.inactiveDays ?? 3)}
                value={dayInputs.inactiveDays ?? String(draft.inactiveDays ?? '')}
                aria-invalid={
                  dayInputs.inactiveDays !== undefined && !validSettingsDays(dayInputs.inactiveDays)
                }
                onChange={(event) => {
                  const value = event.target.value
                  setDayInputs((current) => ({ ...current, inactiveDays: value }))
                  setSaved(false)
                  if (validSettingsDays(value))
                    change({ ...draft, inactiveDays: value === '' ? undefined : Number(value) })
                }}
              />
              {dayInputs.inactiveDays !== undefined &&
                !validSettingsDays(dayInputs.inactiveDays) && (
                  <p role="alert" className="text-xs text-destructive">
                    Enter 1–365 days, or leave empty to inherit.
                  </p>
                )}
            </div>
          </SettingRow>
          <SettingRow
            label="Days in Settled before archiving"
            description={`Effective: ${draft.archiveAfterSettledDays ?? inherited?.archiveAfterSettledDays ?? 7} days. Applies when auto-archive is on.`}
            source={
              <SettingSource
                label="Days in Settled before archiving"
                setting={{
                  field: { group: 'taskBehavior', key: 'archiveAfterSettledDays' },
                  repository,
                  scope,
                  value: draft.archiveAfterSettledDays,
                  inheritedValue: inherited?.archiveAfterSettledDays ?? 7,
                }}
                origin={taskBehaviorOrigin(
                  snapshot?.defaults,
                  repository,
                  scope,
                  draft,
                  'archiveAfterSettledDays',
                )}
                onReset={() => {
                  change({ ...draft, archiveAfterSettledDays: undefined })
                  setDayInputs((current) => ({ ...current, archiveAfterSettledDays: undefined }))
                }}
              />
            }
          >
            <div className="space-y-1">
              <Input
                disabled={!snapshot?.threadBehaviorSupported}
                aria-label="Days in Settled before archiving"
                type="text"
                inputMode="numeric"
                min={1}
                max={365}
                className="w-24"
                placeholder={String(inherited?.archiveAfterSettledDays ?? 7)}
                value={
                  dayInputs.archiveAfterSettledDays ?? String(draft.archiveAfterSettledDays ?? '')
                }
                aria-invalid={
                  dayInputs.archiveAfterSettledDays !== undefined &&
                  !validSettingsDays(dayInputs.archiveAfterSettledDays)
                }
                onChange={(event) => {
                  const value = event.target.value
                  setDayInputs((current) => ({ ...current, archiveAfterSettledDays: value }))
                  setSaved(false)
                  if (validSettingsDays(value))
                    change({
                      ...draft,
                      archiveAfterSettledDays: value === '' ? undefined : Number(value),
                    })
                }}
              />
              {dayInputs.archiveAfterSettledDays !== undefined &&
                !validSettingsDays(dayInputs.archiveAfterSettledDays) && (
                  <p role="alert" className="text-xs text-destructive">
                    Enter 1–365 days, or leave empty to inherit.
                  </p>
                )}
            </div>
          </SettingRow>
        </SettingsGroup>
      </fieldset>
      {connected && supported && !loaded && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading lifecycle settings…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}{' '}
          <Button
            variant="ghost"
            disabled={!connected || busy}
            onClick={() => {
              if (
                dirty &&
                !window.confirm('Discard your unsaved edits and load the latest saved settings?')
              )
                return
              protectDraft.current = false
              setLoaded(null)
              setRetry((value) => value + 1)
            }}
          >
            Reload
          </Button>
        </p>
      )}
      <SettingsSaveBar
        changes={settingsChanges(loaded?.value.taskBehavior ?? {}, {
          ...draft,
          ...Object.fromEntries(
            Object.entries(dayInputs).filter(
              ([, value]) => value !== undefined && !validSettingsDays(value),
            ),
          ),
        })}
        saveError={error}
        readLatestChanges={async () =>
          settingsChanges(
            loaded?.value ?? {},
            (
              await request(
                '/api/agents/settings/read',
                { scope, repositoryId: repository?.id },
                scopedSettingsResultSchema,
              )
            ).value,
          )
        }
        dirty={dirty}
        changeCount={settingsChangeCount(loaded?.value.taskBehavior ?? {}, draft)}
        saving={busy}
        disabled={!supported || !loaded || !connected || invalidDays}
        saved={saved}
        description="Changes apply to existing tasks too. Save to apply."
        onSave={() => void save()}
        onDiscard={() => {
          setDraft(loaded?.value.taskBehavior ?? {})
          setDayInputs({})
          setSaved(false)
          setError('')
        }}
      />
    </div>
  )
}
