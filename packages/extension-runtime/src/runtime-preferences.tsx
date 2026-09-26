import { useEffect } from 'react'
import { Effect } from 'effect'
import { normalizeBranchPrefix, runtimePreferencesSchema } from '@dovo/protocol'
import { clientTaskScope, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { ChoicePicker, cn, Input } from '@dovo/studio-ui'

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

/** Preferences stored on the computer itself, shared by every device that manages it. */
export function RuntimePreferences() {
  const { value, save, error, disabled } = useRuntimePreferences()
  return (
    <section className="divide-y rounded-lg border">
      <label className="flex items-start gap-3 p-4 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value?.autoContinueAfterRestart ?? false}
          disabled={disabled}
          onChange={(event) => save({ autoContinueAfterRestart: event.target.checked })}
        />
        <span>
          Auto-continue tasks after runtime restart
          <span className="mt-1 block text-xs text-muted-foreground">
            Interrupted tasks and unpaused message queues resume one at a time on this computer.
            Explicitly paused or stopped tasks stay paused. Automations still require Retry.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm">Auto-archive inactive tasks</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Archives tasks with no activity for the chosen time. Tasks that are running, waiting for
            you, pinned or have an open terminal are never archived. Restore them from Archived
            tasks.
          </p>
        </div>
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
      </div>
      <label className="flex items-start gap-3 p-4 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value?.preventSleepWhileRunning ?? false}
          disabled={disabled}
          onChange={(event) => save({ preventSleepWhileRunning: event.target.checked })}
        />
        <span>
          Keep this computer awake while tasks run
          <span className="mt-1 block text-xs text-muted-foreground">
            macOS only. Prevents idle sleep only while a task is working, so long tasks keep going
            while you follow them from your phone. The display can still sleep.
          </span>
        </span>
      </label>
      <WorktreeCleanup
        checked={value?.removeArchivedWorktrees ?? false}
        disabled={disabled}
        onChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
      />
      <BranchPrefix
        value={value?.branchPrefix}
        disabled={disabled}
        onSave={(branchPrefix) => save({ branchPrefix })}
      />
      {error && (
        <p role="alert" className="p-4 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

/** Settings → Computers → Activity: how long this computer keeps its history. */
export function ActivityRetention() {
  const { value, save, error, disabled } = useRuntimePreferences()
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm">Keep activity history</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Older requests, tool details and message history are deleted from this computer in the
          background. Task conversations themselves are kept.
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <ChoicePicker
        aria-label="Keep activity history"
        className="h-8 min-w-36 rounded-md px-2 text-xs"
        disabled={disabled}
        value={String(value?.activityRetentionDays ?? 0)}
        onValueChange={(days) =>
          save({ activityRetentionDays: Number(days) as Preferences['activityRetentionDays'] })
        }
      >
        <option value="0">Forever</option>
        <option value="365">For 1 year</option>
        <option value="90">For 90 days</option>
        <option value="30">For 30 days</option>
      </ChoicePicker>
    </section>
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
  const commit = () => {
    if (draft === null || !valid || normalized === value) return setDraft(null)
    onSave(normalized)
    setDraft(null)
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm">Branch prefix</p>
        <p className="mt-1 text-xs text-muted-foreground">
          New task branches start with this, e.g.{' '}
          <code className="font-mono">{normalized || ''}fix-login-1a2b3c4d</code>. Leave empty for
          none. Existing branches keep their names.
        </p>
        {!valid && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Use letters, numbers, dots, dashes or underscores, separated by /.
          </p>
        )}
      </div>
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
    </div>
  )
}

function WorktreeCleanup({
  checked,
  disabled,
  onChange,
  className,
}: {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  return (
    <label className={cn('flex items-start gap-3 p-4 text-sm', className)}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        Remove worktrees of archived tasks
        <span className="mt-1 block text-xs text-muted-foreground">
          Frees disk space in the background. Worktrees with uncommitted changes are kept, and the
          branch always stays, so restoring the task checks it out again.
        </span>
      </span>
    </label>
  )
}

/** Settings → Coding → Worktrees: the same per-computer cleanup switch as Task defaults. */
export function ArchivedWorktreeCleanup() {
  const { value, save, error, disabled } = useRuntimePreferences()
  return (
    <div>
      <WorktreeCleanup
        className="rounded-lg border"
        checked={value?.removeArchivedWorktrees ?? false}
        disabled={disabled}
        onChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
