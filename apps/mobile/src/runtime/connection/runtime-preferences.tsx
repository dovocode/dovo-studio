import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { SettingsGroup, SettingsSwitchRow } from '../../screens/settings-group'
import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import {
  normalizeBranchPrefix,
  runtimePreferencesSchema,
  memorySettingsSchema,
  memoryProjectsSchema,
  type MemoryScope,
  artifactRetentionChoices,
  artifactRetentionSchema,
  decode,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { useRuntime } from './provider'
import { useAction } from '../../ui/controls/use-action'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

type Preferences = typeof runtimePreferencesSchema.Type

/** Preferences stored on the computer itself, shared by every device that manages it. Grouped
 * like the desktop pages: Running tasks, Pull requests & pipelines, Artifacts, memory, worktrees and history. */
export function RuntimePreferences() {
  const { styles } = useTheme()

  const { connected, readEffect, callEffect } = useRuntime()
  const [value, setValue] = useApplicationState<Preferences | null>(null)
  const [memoryProjects, setMemoryProjects] = useApplicationState<
    typeof memoryProjectsSchema.Type.projects
  >([])
  const [loadError, setLoadError] = useApplicationState('')
  const [memoryError, setMemoryError] = useApplicationState('')
  const [memoryLoading, setMemoryLoading] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  const [saved, setSaved] = useApplicationState(false)
  const { act, busy, error } = useAction()
  useEffect(() => {
    setValue(null)
    setSaved(false)
    setLoadError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      readEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings))),
        Effect.asVoid,
        Effect.catch((error) => Effect.sync(() => setLoadError(error.message))),
      ),
    )
    return () => {
      void scope.stop()
    }
  }, [connected, readEffect, retry])
  useEffect(() => {
    let active = true
    setMemoryProjects([])
    setMemoryError('')
    setMemoryLoading(connected)
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      readEffect('/api/memory/projects/read', {}, memoryProjectsSchema).pipe(
        Effect.tap((library) => Effect.sync(() => setMemoryProjects(library.projects))),
        Effect.asVoid,
        Effect.catch((error) => Effect.sync(() => setMemoryError(error.message))),
        Effect.ensuring(
          Effect.sync(() => {
            if (active) setMemoryLoading(false)
          }),
        ),
      ),
    )
    return () => {
      active = false
      void scope.stop()
    }
  }, [connected, readEffect, setMemoryProjects, setMemoryError, retry])
  // Saves only the changed field; the runtime merges it into the rest.
  const save = (changes: Partial<Preferences>) => {
    setSaved(false)
    act(() =>
      callEffect('/api/runtime/preferences/save', changes, runtimePreferencesSchema).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            setValue(settings)
            setSaved(true)
          }),
        ),
      ),
    )
  }
  const configureMemory = (scope: MemoryScope, enabled: boolean, repositoryId?: string) => {
    setSaved(false)
    act(() =>
      callEffect(
        '/api/memory/settings/save',
        { scope, enabled, repositoryId },
        memorySettingsSchema,
      ).pipe(
        Effect.tap((memory) =>
          Effect.sync(() => {
            setValue((current) => (current ? { ...current, memory } : current))
            setSaved(true)
          }),
        ),
      ),
    )
  }
  const disabled = !connected || busy || value === null
  const [prefixDraft, setPrefixDraft] = useApplicationState<string | null>(null)
  const branchPrefix = normalizeBranchPrefix(prefixDraft ?? value?.branchPrefix ?? '')
  useEffect(() => {
    if (prefixDraft !== null && branchPrefix.prefix === value?.branchPrefix) setPrefixDraft(null)
  }, [prefixDraft, branchPrefix.prefix, value?.branchPrefix, setPrefixDraft])
  const commitPrefix = () => {
    if (prefixDraft !== null && branchPrefix.valid && branchPrefix.prefix !== value?.branchPrefix)
      save({ branchPrefix: branchPrefix.prefix })
    if (branchPrefix.valid && branchPrefix.prefix === value?.branchPrefix) setPrefixDraft(null)
  }
  return (
    <View style={{ gap: 28 }}>
      <Text style={styles.muted}>
        Saved on this computer and shared with its paired devices. Switches and choices save
        automatically.
      </Text>
      {!connected ? (
        <Text accessibilityRole="alert" style={styles.muted}>
          This computer is offline. Reconnect to load and change its preferences.
        </Text>
      ) : !value && !loadError ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Loading computer preferences…
        </Text>
      ) : null}
      {!!loadError && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <Action
            wide
            secondary
            label="Retry computer preferences"
            disabled={!connected || busy}
            onPress={() => setRetry(retry + 1)}
          />
        </View>
      )}
      {busy && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Saving computer preferences…
        </Text>
      )}
      {saved && !busy && !error && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Computer preferences saved.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {value && (
        <>
          <Section title="Running tasks">
            <ChildAgentLimit
              value={value?.maxActiveChildAgents}
              disabled={disabled}
              onSave={(maxActiveChildAgents) => save({ maxActiveChildAgents })}
            />
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Continue interrupted turns after runtime restart"
                value={value?.autoContinueAfterRestart ?? false}
                disabled={disabled}
                onValueChange={(autoContinueAfterRestart) => save({ autoContinueAfterRestart })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Interrupted turns can resume automatically. Queued messages stay paused until you
                resume them. Stopped tasks and automations still require Retry.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <Choice
                label="Auto-archive inactive tasks"
                value={String(value?.autoArchiveDays ?? 0)}
                disabled={disabled}
                items={[
                  { id: '0', name: 'Never' },
                  { id: '7', name: 'After 7 days' },
                  { id: '14', name: 'After 14 days' },
                  { id: '30', name: 'After 30 days' },
                ]}
                onChange={(days) =>
                  save({
                    autoArchiveDays: decode(
                      runtimePreferencesSchema.fields.autoArchiveDays,
                      Number(days),
                    ),
                  })
                }
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Running, waiting, pinned tasks and tasks with an open terminal are never archived.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Keep this computer awake while tasks run"
                value={value?.preventSleepWhileRunning ?? false}
                disabled={disabled}
                onValueChange={(preventSleepWhileRunning) => save({ preventSleepWhileRunning })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                macOS only. Prevents idle sleep while a task is working, so it keeps going while you
                follow it here.
              </Text>
            </View>
          </Section>
          <Section title="Pull requests & pipelines">
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Smart PR linking"
                value={value?.autoLinkPullRequests ?? true}
                disabled={disabled}
                onValueChange={(autoLinkPullRequests) => save({ autoLinkPullRequests })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Links branch matches and verified PR URLs mentioned in messages.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Settle when the PR closes"
                value={value?.settleOnPullClose ?? false}
                disabled={disabled}
                onValueChange={(settleOnPullClose) => save({ settleOnPullClose })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Moves the thread to Settled when its main PR is merged or closed. Pinned threads and
                active or queued work stay put.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Archive tasks when their PR closes"
                value={value?.archiveOnPullMerge ?? false}
                disabled={disabled}
                onValueChange={(archiveOnPullMerge) => save({ archiveOnPullMerge })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Archives a task once its pull request is merged or closed. Pinned and busy tasks
                stay.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Enable experimental PR feedback watcher"
                value={value?.enablePullRequestWatching ?? false}
                disabled={disabled}
                onValueChange={(enablePullRequestWatching) => save({ enablePullRequestWatching })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Let agents hand PR monitoring to this computer. New comments, reviews and failing
                checks wake the thread. Finished watched threads move to Waiting. Paused queues stay
                paused; settling or archiving cancels watches.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Enable experimental pipeline watcher"
                value={value?.enablePipelineWatching ?? false}
                disabled={disabled}
                onValueChange={(enablePipelineWatching) => save({ enablePipelineWatching })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Let agents hand pipeline monitoring to this computer. Failed runs wake the thread;
                successful runs finish silently. Finished watched threads move to Waiting. Paused
                queues stay paused; settling or archiving cancels watches.
              </Text>
            </View>
          </Section>
          <Section title="Artifacts">
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Enable Dovo Artifacts"
                value={value?.enableArtifacts ?? false}
                disabled={disabled}
                onValueChange={(enableArtifacts) => save({ enableArtifacts })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Let agents create documents, diagrams, code and interactive previews inside threads.
                Shared by desktop and mobile for this computer.
              </Text>
            </View>
            {(['settledArtifactRetention', 'archivedArtifactRetention'] as const).map((key) => (
              <Choice
                key={key}
                label={
                  key === 'settledArtifactRetention'
                    ? 'Artifacts when settled'
                    : 'Artifacts when archived'
                }
                disabled={disabled}
                value={value?.[key] ?? 'forever'}
                items={artifactRetentionChoices.map((choice) => ({
                  id: choice.value,
                  name: choice.label,
                }))}
                onChange={(policy) => save({ [key]: decode(artifactRetentionSchema, policy) })}
              />
            ))}
            <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
              Applies to existing artifacts and all versions, even when disabled. Deletion is
              permanent. The archived rule takes priority; reopening or restoring resets the state’s
              timer.
            </Text>
          </Section>
          <Section title="Memory">
            <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
              Optional notes stored locally on this computer and shared across its threads. Each
              scope starts off. Disabling a scope keeps its notes and stops agent access. Manage
              saved notes in desktop Settings → Tasks & projects → Memory.
            </Text>
            {(
              [
                {
                  scope: 'system',
                  label: 'System-wide memory',
                  enabled: value?.memory.systemEnabled ?? false,
                },
                {
                  scope: 'projectless',
                  label: 'Memory for threads without a project',
                  enabled: value?.memory.projectlessEnabled ?? false,
                },
              ] as const
            ).map((item) => (
              <SettingsSwitchRow
                key={item.scope}
                first
                label={item.label}
                value={item.enabled}
                disabled={disabled}
                onValueChange={(enabled) => configureMemory(item.scope, enabled)}
              />
            ))}
            {!!memoryError && (
              <View style={{ gap: 8 }}>
                <Text accessibilityRole="alert" style={styles.error}>
                  Project memory settings could not be loaded: {memoryError}
                </Text>
                <Action
                  wide
                  secondary
                  label="Retry project memory settings"
                  disabled={disabled}
                  onPress={() => setRetry(retry + 1)}
                />
              </View>
            )}
            {memoryLoading && (
              <Text accessibilityLiveRegion="polite" style={[styles.muted, { padding: 16 }]}>
                Loading project memory settings…
              </Text>
            )}
            {!memoryLoading && !memoryError && !memoryProjects.length && (
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                No project memory scopes available. Add a project on this computer to configure its
                memory.
              </Text>
            )}
            {memoryProjects.map((project) => (
              <SettingsSwitchRow
                key={project.id}
                first
                label={`Memory for ${project.name}${!project.registered ? ' · Project removed' : ''}`}
                value={value?.memory.projectRepositoryIds.includes(project.id) ?? false}
                disabled={
                  disabled ||
                  (!project.registered && !value?.memory.projectRepositoryIds.includes(project.id))
                }
                onValueChange={(enabled) => configureMemory('project', enabled, project.id)}
              />
            ))}
          </Section>
          <Section title="Worktrees">
            <Field
              label="Branch prefix"
              placeholder="none"
              autoCorrect={false}
              autoCapitalize="none"
              editable={!disabled}
              value={prefixDraft ?? value?.branchPrefix ?? ''}
              onChangeText={(prefix) => {
                setPrefixDraft(prefix)
                setSaved(false)
              }}
              returnKeyType="done"
              hint={`New task branches look like ${branchPrefix.prefix}fix-login-1a2b3c4d. Leave empty for none.`}
              error={
                branchPrefix.valid
                  ? undefined
                  : 'Use letters, numbers, dots, dashes or underscores.'
              }
            />
            {prefixDraft !== null && prefixDraft !== value.branchPrefix && (
              <Action
                wide
                label="Save branch prefix"
                disabled={disabled || !branchPrefix.valid}
                onPress={commitPrefix}
              />
            )}
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Remove worktrees of archived tasks"
                value={value?.removeArchivedWorktrees ?? false}
                disabled={disabled}
                onValueChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Worktrees with uncommitted changes are kept. The branch stays, so restoring a task
                checks it out again. Ignored local files are deleted with the checkout.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <SettingsSwitchRow
                first
                label="Remove worktrees when deleting their last thread"
                value={value?.removeWorktreesOnThreadDelete ?? false}
                disabled={disabled}
                onValueChange={(removeWorktreesOnThreadDelete) =>
                  save({ removeWorktreesOnThreadDelete })
                }
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Only clean Dovo-created checkouts with no remaining threads are removed. Branches
                and uncommitted changes are kept. Ignored local files are deleted with the checkout.
              </Text>
            </View>
          </Section>
          <Section title="Activity">
            <View style={{ gap: 6 }}>
              <Choice
                label="Keep activity history"
                value={String(value?.activityRetentionDays ?? 90)}
                disabled={disabled}
                items={[
                  { id: '0', name: 'Forever' },
                  { id: '365', name: 'For 1 year' },
                  { id: '90', name: 'For 90 days' },
                  { id: '30', name: 'For 30 days' },
                ]}
                onChange={(days) =>
                  save({
                    activityRetentionDays: decode(
                      runtimePreferencesSchema.fields.activityRetentionDays,
                      Number(days),
                    ),
                  })
                }
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                Older requests and tool details are deleted from this computer. Task conversations
                are kept.
              </Text>
            </View>
          </Section>
        </>
      )}
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <SettingsGroup title={title}>{children}</SettingsGroup>
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
  const limit = Number(draft ?? value ?? 4)
  const valid = Number.isSafeInteger(limit) && limit >= 1
  useEffect(() => setDraft(null), [value, setDraft])
  const commit = () => {
    if (draft !== null && valid && limit !== value) onSave(limit)
  }
  return (
    <View style={{ gap: 8 }}>
      <Field
        label="Maximum concurrent child agents"
        keyboardType="number-pad"
        value={draft ?? String(value ?? 4)}
        editable={!disabled}
        onChangeText={setDraft}
        returnKeyType="done"
        hint="Per parent thread on this computer. Extra launches are refused until a child finishes; existing children keep running when the limit is lowered. Default: 4."
        error={valid ? undefined : 'Enter a whole number of at least 1.'}
      />
      {draft !== null && limit !== value && (
        <Action
          wide
          label="Save child agent limit"
          disabled={disabled || !valid}
          onPress={commit}
        />
      )}
    </View>
  )
}
