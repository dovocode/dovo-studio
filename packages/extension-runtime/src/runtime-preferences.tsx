import { useEffect } from 'react'
import { Effect } from 'effect'
import { normalizeBranchPrefix, runtimePreferencesSchema } from '@dovo/protocol'
import { clientTaskScope, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { ChoicePicker, Input, SettingRow, SettingsGroup, Toggle } from '@dovo/studio-ui'

type Preferences = typeof runtimePreferencesSchema.Type

/** Loads and saves the computer's own preferences; saves send only the changed fields. */
export function useRuntimePreferences() {
  const { requestEffect, connected } = useWorkspace()
  const [value, setValue] = useApplicationState<Preferences | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    setValue(null)
    setError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      requestEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings))),
        Effect.asVoid,
        Effect.catchAll((error) => Effect.sync(() => setError(error.message))),
      ),
    )
    return () => {
      void scope.stop()
    }
  }, [requestEffect, connected])
  const save = (changes: Partial<Preferences>) => {
    setBusy(true)
    setError('')
    void Effect.runPromise(
      requestEffect('/api/runtime/preferences/save', changes, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings))),
        Effect.catchAll((error) => Effect.sync(() => setError(error.message))),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      ),
    )
  }
  return { value, save, error, disabled: !connected || busy || value === null }
}

/** Settings → Computers → Running tasks: what this computer does with tasks on its own. Stored
 * on the computer, so every device that manages it sees the same choices. */
export function RunningTaskPreferences() {
  const { value, save, error, disabled } = useRuntimePreferences()
  return (
    <>
      <SettingsGroup title="After a restart">
        <SettingRow
          label="Continue interrupted tasks"
          description="Interrupted tasks and unpaused message queues resume one at a time. Paused or stopped tasks stay paused. Automations still require Retry."
        >
          <Toggle
            label="Continue interrupted tasks after a runtime restart"
            checked={value?.autoContinueAfterRestart ?? false}
            disabled={disabled}
            onChange={(autoContinueAfterRestart) => save({ autoContinueAfterRestart })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="While tasks run">
        <SettingRow
          label="Keep this computer awake"
          description="macOS only. Prevents idle sleep only while a task is working, so long tasks keep going while you follow them from your phone. The display can still sleep."
        >
          <Toggle
            label="Keep this computer awake while tasks run"
            checked={value?.preventSleepWhileRunning ?? false}
            disabled={disabled}
            onChange={(preventSleepWhileRunning) => save({ preventSleepWhileRunning })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Tidying up">
        <SettingRow
          label="Auto-archive inactive tasks"
          description="Tasks that are running, waiting for you, pinned or have an open terminal are never archived. Restore them from Archived tasks."
        >
          <ChoicePicker
            aria-label="Auto-archive inactive tasks"
            className="h-8 min-w-36 rounded-md px-2 text-xs"
            disabled={disabled}
            value={String(value?.autoArchiveDays ?? 0)}
            onValueChange={(days) =>
              save({ autoArchiveDays: Number(days) as Preferences['autoArchiveDays'] })
            }
          >
            <option value="0">Never</option>
            <option value="7">After 7 days</option>
            <option value="14">After 14 days</option>
            <option value="30">After 30 days</option>
          </ChoicePicker>
        </SettingRow>
        <SettingRow
          label="Archive when the pull request merges"
          description="Archives a task once its pull request is merged or closed. Pinned tasks and tasks that are busy stay put."
        >
          <Toggle
            label="Archive tasks when their pull request merges"
            checked={value?.archiveOnPullMerge ?? false}
            disabled={disabled}
            onChange={(archiveOnPullMerge) => save({ archiveOnPullMerge })}
          />
        </SettingRow>
      </SettingsGroup>
      <Problem error={error} />
    </>
  )
}

/** Settings → Computers → Activity: how long this computer keeps its history. */
export function ActivityRetention() {
  const { value, save, error, disabled } = useRuntimePreferences()
  return (
    <SettingsGroup title="History">
      <SettingRow
        label="Keep activity history"
        description="Older requests, tool details and message history are deleted from this computer in the background. Task conversations themselves are kept."
      >
        <ChoicePicker
          aria-label="Keep activity history"
          className="h-8 min-w-36 rounded-md px-2 text-xs"
          disabled={disabled}
          value={String(value?.activityRetentionDays ?? 90)}
          onValueChange={(days) =>
            save({ activityRetentionDays: Number(days) as Preferences['activityRetentionDays'] })
          }
        >
          <option value="0">Forever</option>
          <option value="365">For 1 year</option>
          <option value="90">For 90 days</option>
          <option value="30">For 30 days</option>
        </ChoicePicker>
      </SettingRow>
      <Problem error={error} />
    </SettingsGroup>
  )
}

/** Settings → Coding → Worktrees: how task branches are named and when checkouts are removed. */
export function WorktreePreferences() {
  const { value, save, error, disabled } = useRuntimePreferences()
  return (
    <SettingsGroup title="Branches and cleanup">
      <BranchPrefix
        value={value?.branchPrefix}
        disabled={disabled}
        onSave={(branchPrefix) => save({ branchPrefix })}
      />
      <SettingRow
        label="Remove worktrees of archived tasks"
        description="Frees disk space in the background. Worktrees with uncommitted changes are kept, and the branch always stays, so restoring the task checks it out again."
      >
        <Toggle
          label="Remove worktrees of archived tasks"
          checked={value?.removeArchivedWorktrees ?? false}
          disabled={disabled}
          onChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
        />
      </SettingRow>
      <Problem error={error} />
    </SettingsGroup>
  )
}

function Problem({ error }: { error: string }) {
  if (!error) return null
  return (
    <p role="alert" className="px-4 py-3 text-xs text-destructive">
      {error}
    </p>
  )
}

/** Branch prefix: edited as text, saved on Enter or blur, and checked like Git would. */
function BranchPrefix({
  value,
  disabled,
  onSave,
}: {
  value: string | undefined
  disabled: boolean
  onSave: (prefix: string) => void
}) {
  const [draft, setDraft] = useApplicationState<string | null>(null)
  const text = draft ?? value ?? ''
  const { prefix: normalized, valid } = normalizeBranchPrefix(text)
  useEffect(() => {
    if (draft !== null && normalized === value) setDraft(null)
  }, [draft, normalized, value, setDraft])
  const commit = () => {
    if (draft === null || !valid || normalized === value) return setDraft(null)
    onSave(normalized)
  }
  return (
    <SettingRow
      label="Branch prefix"
      description={
        <>
          New task branches start with this, e.g.{' '}
          <code className="font-mono">{normalized || ''}fix-login-1a2b3c4d</code>. Leave empty for
          none. Existing branches keep their names.
          {!valid && (
            <span role="alert" className="mt-1 block text-destructive">
              Use letters, numbers, dots, dashes or underscores, separated by /.
            </span>
          )}
        </>
      }
    >
      <Input
        aria-label="Branch prefix"
        className="h-8 w-40 font-mono text-xs"
        placeholder="none"
        value={text}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
    </SettingRow>
  )
}
