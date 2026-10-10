import { useEffect, useState } from 'react'
import {
  runtimePreferencesSchema,
  scopedSettingsResultSchema,
  taskBehaviorOrigin,
  type Repository,
  type ScopedSettingsValue,
  type SettingsScope,
  type TaskBehavior,
} from '@dovo/protocol'
import { useSettingsDraft, useWorkspace } from '@dovo/studio-core'
import { SettingsGroup, SettingRow } from './settings-layout'
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
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof load>> | null>(null)
  const [draft, setDraft] = useState<TaskBehavior>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [legacy, setLegacy] = useState<typeof runtimePreferencesSchema.Type | null>(null)
  const [retry, setRetry] = useState(0)
  const dirty =
    !!loaded && JSON.stringify(draft) !== JSON.stringify(loaded.value.taskBehavior ?? {})
  useSettingsDraft(dirty, busy)
  function load() {
    return request(
      '/api/agents/settings/read',
      { scope, repositoryId: repository?.id },
      scopedSettingsResultSchema,
    )
  }
  useEffect(() => {
    let active = true
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
            setLoaded(value)
            setDraft(value.value.taskBehavior ?? {})
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
  function change(value: TaskBehavior) {
    setDraft(value)
    setSaved(false)
  }
  async function save() {
    if (!loaded) return
    setBusy(true)
    setError('')
    try {
      const latest = await load()
      if (
        JSON.stringify(latest.value.taskBehavior ?? {}) !==
        JSON.stringify(loaded.value.taskBehavior ?? {})
      )
        throw new Error('Lifecycle settings changed on another device. Reload before saving.')
      const after: ScopedSettingsValue = { ...latest.value, taskBehavior: draft }
      const value = await request(
        '/api/agents/settings/save',
        {
          scope,
          repositoryId: repository?.id,
          projectKey: loaded.projectKey,
          before: latest.value,
          after,
        },
        scopedSettingsResultSchema,
      )
      setLoaded(value)
      setDraft(value.value.taskBehavior ?? {})
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
                  }}
                  origin={taskBehaviorOrigin(
                    snapshot?.defaults,
                    repository,
                    scope,
                    draft,
                    key,
                    key === 'continueAfterRestart' ||
                      key === 'settleMerged' ||
                      key === 'settleClosed',
                  )}
                  onReset={() => change({ ...draft, [key]: undefined })}
                />
              }
            >
              <Select
                value={draft[key] === undefined ? 'inherit' : draft[key] ? 'on' : 'off'}
                onValueChange={(value) =>
                  change({ ...draft, [key]: value === 'inherit' ? undefined : value === 'on' })
                }
              >
                <SelectTrigger aria-label={label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit ({fallback(key) ? 'On' : 'Off'})</SelectItem>
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
                }}
                origin={taskBehaviorOrigin(
                  snapshot?.defaults,
                  repository,
                  scope,
                  draft,
                  'inactiveDays',
                )}
                onReset={() => change({ ...draft, inactiveDays: undefined })}
              />
            }
          >
            <Input
              aria-label="Days of inactivity before settling"
              type="number"
              min={1}
              max={365}
              className="w-24"
              placeholder={String(inherited?.inactiveDays ?? 3)}
              value={draft.inactiveDays ?? ''}
              onChange={(event) => {
                const value = event.target.value
                if (!value) change({ ...draft, inactiveDays: undefined })
                else if (
                  Number.isInteger(Number(value)) &&
                  Number(value) >= 1 &&
                  Number(value) <= 365
                )
                  change({ ...draft, inactiveDays: Number(value) })
              }}
            />
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
          <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
            Reload
          </Button>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <p role="status" className="text-xs text-muted-foreground">
          {saved
            ? 'Lifecycle settings saved.'
            : dirty
              ? 'Unsaved lifecycle changes'
              : 'Changes apply to existing tasks too'}
        </p>
        <Button
          disabled={!supported || !loaded || busy || !connected || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save lifecycle settings'}
        </Button>
      </div>
    </div>
  )
}
