import { useEffect, useId, useRef } from 'react'
import { Effect } from 'effect'
import {
  normalizeBranchPrefix,
  runtimePreferencesSchema,
  artifactRetentionChoices,
  artifactRetentionSchema,
  decode,
} from '@dovo/protocol'
import { clientTaskScope, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
  SettingsGroup,
  Toggle,
} from '@dovo/studio-ui'

type Preferences = typeof runtimePreferencesSchema.Type

/** Loads and saves the computer's own preferences; saves send only the changed fields. */
function useRuntimePreferences(onSaved?: () => void) {
  const { requestEffect, connected } = useWorkspace()
  const [value, setValue] = useApplicationState<Preferences | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const generation = useRef(0)
  const saving = useRef(false)
  useEffect(() => {
    const version = ++generation.current
    saving.current = false
    setBusy(false)
    setValue(null)
    setError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      requestEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            if (version === generation.current) setValue(settings)
          }),
        ),
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.sync(() => {
            if (version === generation.current) setError(error.message)
          }),
        ),
      ),
    )
    return () => {
      ++generation.current
      void scope.stop()
    }
  }, [requestEffect, connected])
  const save = (changes: Partial<Preferences>) => {
    if (!connected || saving.current) return
    saving.current = true
    const version = generation.current
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    setError('')
    void Effect.runPromise(
      requestEffect('/api/runtime/preferences/save', changes, runtimePreferencesSchema).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            if (version === generation.current) {
              setValue(settings)
              onSaved?.()
            }
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (version === generation.current) setError(error.message)
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (version !== generation.current) return
            saving.current = false
            setBusy(false)
            requestAnimationFrame(() => {
              if (
                version === generation.current &&
                focused?.isConnected &&
                document.activeElement === document.body
              )
                focused.focus()
            })
          }),
        ),
      ),
    )
  }
  return { value, save, error, busy, connected, disabled: !connected || busy || value === null }
}

/** Settings → Computers → Running tasks: what this computer does with tasks on its own. Stored
 * on the computer, so every device that manages it sees the same choices. */
export function RunningTaskPreferences() {
  const { value, save, error, busy, connected, disabled } = useRuntimePreferences()
  return (
    <>
      <SettingsGroup title="After a restart">
        <SettingRow
          label="Continue interrupted tasks"
          description="Computer default for tasks set to Inherit. Resumes interrupted turns; queued messages stay paused. Stopped tasks and automations still need Retry."
        >
          <Toggle
            label="Continue interrupted tasks after a runtime restart"
            checked={value?.autoContinueAfterRestart ?? false}
            disabled={disabled}
            onChange={(autoContinueAfterRestart) => save({ autoContinueAfterRestart })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Child agents">
        <ChildAgentLimit
          value={value?.maxActiveChildAgents}
          disabled={disabled}
          onSave={(maxActiveChildAgents) => save({ maxActiveChildAgents })}
        />
      </SettingsGroup>
      <SettingsGroup title="While tasks run">
        <SettingRow
          label="Keep this computer awake"
          description="macOS only. Prevents idle sleep while a task is working. The display can still sleep."
        >
          <Toggle
            label="Keep this computer awake while tasks run"
            checked={value?.preventSleepWhileRunning ?? false}
            disabled={disabled}
            onChange={(preventSleepWhileRunning) => save({ preventSleepWhileRunning })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Archiving">
        <SettingRow
          label="Auto-archive inactive tasks"
          description="Tasks that are running, waiting for you, pinned or have an open terminal are never archived. Restore them from Archived tasks."
        >
          <Select
            disabled={disabled}
            value={String(value?.autoArchiveDays ?? 0)}
            onValueChange={(days) =>
              save({
                autoArchiveDays: decode(
                  runtimePreferencesSchema.fields.autoArchiveDays,
                  Number(days),
                ),
              })
            }
          >
            <SelectTrigger aria-label="Auto-archive inactive tasks" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Never</SelectItem>
              <SelectItem value="7">After 7 days</SelectItem>
              <SelectItem value="14">After 14 days</SelectItem>
              <SelectItem value="30">After 30 days</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsGroup>
      <PreferencesStatus error={error} loaded={value !== null} busy={busy} connected={connected} />
    </>
  )
}

/** PR lifecycle and explicit monitoring tools, saved per computer. */
export function PullRequestPreferences() {
  const { value, save, error, busy, connected, disabled } = useRuntimePreferences()
  return (
    <>
      <SettingsGroup title="Pull requests">
        <SettingRow
          label="Automatically link pull requests"
          description="Links matching branches and verified PR URLs in messages. Keeps the current checkout."
        >
          <Toggle
            label="Automatically link pull requests"
            checked={value?.autoLinkPullRequests ?? true}
            disabled={disabled}
            onChange={(autoLinkPullRequests) => save({ autoLinkPullRequests })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="When a pull request closes"
        description="Applies when the main pull request is merged or closed. Pinned tasks and tasks with active work stay put."
      >
        <SettingRow
          label="Settle when the PR closes"
          description="Computer default for tasks set to Inherit. Moves the thread to Settled and keeps its history. Archiving below takes priority; queued work stays put."
        >
          <Toggle
            label="Settle when the PR closes"
            checked={value?.settleOnPullClose ?? false}
            disabled={disabled}
            onChange={(settleOnPullClose) => save({ settleOnPullClose })}
          />
        </SettingRow>
        <SettingRow
          label="Archive when the PR closes"
          description="Moves the task out of your list. Restore it later from Archived tasks."
        >
          <Toggle
            label="Archive when the PR closes"
            checked={value?.archiveOnPullMerge ?? false}
            disabled={disabled}
            onChange={(archiveOnPullMerge) => save({ archiveOnPullMerge })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="Monitoring (experimental)"
        description="Agents must explicitly start a watch. Finished watched threads move to Waiting. Paused queues stay paused; settling or archiving cancels watches."
      >
        <SettingRow
          label="PR feedback watcher (experimental)"
          description="New comments, reviews and failing checks wake the thread on this computer."
        >
          <Toggle
            label="PR feedback watcher (experimental)"
            checked={value?.enablePullRequestWatching ?? false}
            disabled={disabled}
            onChange={(enablePullRequestWatching) => save({ enablePullRequestWatching })}
          />
        </SettingRow>
        <SettingRow
          label="Pipeline watcher (experimental)"
          description="Failed runs wake the thread on this computer. Successful runs finish silently."
        >
          <Toggle
            label="Pipeline watcher (experimental)"
            checked={value?.enablePipelineWatching ?? false}
            disabled={disabled}
            onChange={(enablePipelineWatching) => save({ enablePipelineWatching })}
          />
        </SettingRow>
      </SettingsGroup>
      <PreferencesStatus error={error} loaded={value !== null} busy={busy} connected={connected} />
    </>
  )
}

export function ArtifactPreferences() {
  const { value, save, error, busy, connected, disabled } = useRuntimePreferences()
  return (
    <>
      <SettingsGroup title="Artifacts">
        <SettingRow
          label="Enable artifacts"
          description="Let agents create documents, diagrams, code and interactive previews inside threads. Shared by desktop and mobile for this computer."
        >
          <Toggle
            label="Enable artifacts"
            checked={value?.enableArtifacts ?? false}
            disabled={disabled}
            onChange={(enableArtifacts) => save({ enableArtifacts })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="Retention"
        description="Applies to existing artifacts and every saved version, even when artifacts are disabled. Deletion is permanent."
      >
        {(['settledArtifactRetention', 'archivedArtifactRetention'] as const).map((key) => (
          <SettingRow
            key={key}
            label={
              key === 'settledArtifactRetention'
                ? 'Artifacts when settled'
                : 'Artifacts when archived'
            }
            description={
              key === 'settledArtifactRetention'
                ? 'How long to keep artifacts in settled threads.'
                : 'How long to keep artifacts in archived threads.'
            }
          >
            <Select
              disabled={disabled}
              value={value?.[key] ?? 'forever'}
              onValueChange={(policy) => save({ [key]: decode(artifactRetentionSchema, policy) })}
            >
              <SelectTrigger
                aria-label={
                  key === 'settledArtifactRetention'
                    ? 'Artifacts when settled'
                    : 'Artifacts when archived'
                }
                className="min-w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {artifactRetentionChoices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        ))}
      </SettingsGroup>
      <PreferencesStatus error={error} loaded={value !== null} busy={busy} connected={connected} />
    </>
  )
}

/** Settings → Computers → Activity: how long this computer keeps its history. */
export function ActivityRetention() {
  const { value, save, error, busy, connected, disabled } = useRuntimePreferences()
  return (
    <>
      <SettingsGroup title="Retention">
        <SettingRow
          label="Keep activity history"
          description="Older requests, tool details and message history are deleted from this computer in the background. Task conversations themselves are kept."
        >
          <Select
            disabled={disabled}
            value={String(value?.activityRetentionDays ?? 90)}
            onValueChange={(days) =>
              save({
                activityRetentionDays: decode(
                  runtimePreferencesSchema.fields.activityRetentionDays,
                  Number(days),
                ),
              })
            }
          >
            <SelectTrigger aria-label="Keep activity history" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Forever</SelectItem>
              <SelectItem value="365">For 1 year</SelectItem>
              <SelectItem value="90">For 90 days</SelectItem>
              <SelectItem value="30">For 30 days</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsGroup>
      <PreferencesStatus error={error} loaded={value !== null} busy={busy} connected={connected} />
    </>
  )
}

/** Settings → Coding → Worktrees: how task branches are named and when checkouts are removed. */
export function WorktreePreferences({ onSaved }: { onSaved?: () => void } = {}) {
  const { value, save, error, busy, connected, disabled } = useRuntimePreferences(onSaved)
  return (
    <>
      <SettingsGroup title="New worktrees">
        <WorktreeRoot
          value={value?.worktreesRoot}
          disabled={disabled}
          onSave={(worktreesRoot) => save({ worktreesRoot })}
        />
        <BranchPrefix
          value={value?.branchPrefix}
          disabled={disabled}
          onSave={(branchPrefix) => save({ branchPrefix })}
        />
      </SettingsGroup>
      <SettingsGroup title="Cleanup">
        <SettingRow
          label="Remove worktrees of archived tasks"
          description="Removes clean Dovo checkouts in the background, including ignored local files. Keeps branches and uncommitted changes. Restoring a task recreates its checkout."
        >
          <Toggle
            label="Remove worktrees of archived tasks"
            checked={value?.removeArchivedWorktrees ?? false}
            disabled={disabled}
            onChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
          />
        </SettingRow>
        <SettingRow
          label="Remove worktrees when deleting their last thread"
          description="Removes clean Dovo checkouts, including ignored local files. Keeps branches and uncommitted changes. You can override this in each delete confirmation."
        >
          <Toggle
            label="Remove worktrees when deleting their last thread"
            checked={value?.removeWorktreesOnThreadDelete ?? false}
            disabled={disabled}
            onChange={(removeWorktreesOnThreadDelete) => save({ removeWorktreesOnThreadDelete })}
          />
        </SettingRow>
      </SettingsGroup>
      <PreferencesStatus error={error} loaded={value !== null} busy={busy} connected={connected} />
    </>
  )
}

function WorktreeRoot({
  value,
  disabled,
  onSave,
}: {
  value: string | undefined
  disabled: boolean
  onSave: (root: string) => void
}) {
  const [draft, setDraft] = useApplicationState<string | null>(null)
  useEffect(() => {
    setDraft(null)
  }, [value, setDraft])
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onSave(draft.trim())
  }
  return (
    <SettingRow
      label="Worktree folder location"
      description="Absolute folder on this computer for new worktrees. Leave empty to use the default. Existing checkouts stay in their current locations."
    >
      <Input
        aria-label="Worktree folder location"
        value={draft ?? value ?? ''}
        disabled={disabled}
        placeholder="Default worktrees folder"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
    </SettingRow>
  )
}

function PreferencesStatus({
  error,
  loaded,
  busy,
  connected,
}: {
  error: string
  loaded: boolean
  busy: boolean
  connected: boolean
}) {
  if (!error)
    return !connected || !loaded || busy ? (
      <p role="status" className="text-xs text-muted-foreground">
        {!connected
          ? 'Reconnect this computer to change settings.'
          : !loaded
            ? 'Loading settings…'
            : 'Saving…'}
      </p>
    ) : null
  return (
    <p role="alert" className="py-2 text-xs text-destructive">
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
        aria-invalid={!valid}
        className="h-8 w-40 font-mono text-xs"
        placeholder="none"
        value={text}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
    </SettingRow>
  )
}

function ChildAgentLimit({
  value,
  disabled,
  onSave,
}: {
  value: number | undefined
  disabled: boolean
  onSave: (value: number) => void
}) {
  const [draft, setDraft] = useApplicationState<string | null>(null)
  const errorId = useId()
  const limit = Number(draft ?? value ?? 4)
  const valid = Number.isSafeInteger(limit) && limit >= 1
  useEffect(() => setDraft(null), [value, setDraft])
  const commit = () => {
    if (draft !== null && valid && limit !== value) onSave(limit)
  }
  return (
    <SettingRow
      label="Maximum concurrent child agents"
      description="Per parent thread on this computer. Extra launches are refused until a child finishes. Lowering the limit keeps existing children running. Defaults to 4."
    >
      <div className="space-y-2">
        <Input
          aria-label="Maximum concurrent child agents"
          aria-describedby={!valid ? errorId : undefined}
          type="number"
          min={1}
          step={1}
          className="w-24"
          value={draft ?? String(value ?? 4)}
          disabled={disabled}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setDraft(null)
          }}
        />
        {!valid && (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            Enter a whole number of at least 1.
          </p>
        )}
      </div>
    </SettingRow>
  )
}
