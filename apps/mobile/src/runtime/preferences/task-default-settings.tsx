import { Struct } from 'effect'
import { randomUUID } from 'expo-crypto'
import {
  runtimePreferencesSchema,
  runtimeComputerName,
  scopedSettingsResultSchema,
  taskDefaultOrigins,
  taskBehaviorOrigin,
  providerDisplayName,
  scopedAgentEntries,
  settingsScopes,
  settingsScopeLabels,
  type SettingsScope,
  type TaskBehavior,
  type ScopedSettingsValue,
  type SavedPrompt,
} from '@dovo/protocol'
import { useEffect } from 'react'
import { Alert, View } from 'react-native'
import {
  executionSchema,
  accessLabel,
  selectableAccessModes,
  agentSchema,
  decode,
  defaultTaskHarness,
  projectTaskDefaultsSchema,
  providerSchema,
  runtimeDefaultsSchema,
  defaultWorktreeFromOrigin,
  agentConnectionValue,
  changeAgentConnection,
  taskHarnessSchema,
  type ProjectTaskDefaults,
  type Repository,
  type RuntimeDefaults,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { useRuntime } from '../connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Text } from '../../ui/content/text'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Switch } from '../../ui/controls/switch'
import { useTheme } from '../../ui/theme'
import { ModelSettings } from '../../agents/model-settings'
import { SettingSource } from './setting-source'
import { useSettingsDraft } from './settings-target'
export function TaskDefaultSettings(props: {
  repository?: Repository
  inline?: boolean
  scope?: SettingsScope
}) {
  const [open, setOpen] = useApplicationState(false)
  const [editing, setEditing] = useApplicationState(false)
  const [saving, setSaving] = useApplicationState(false)
  if (props.inline) return <TaskDefaultSettingsForm {...props} />
  return (
    <View style={{ gap: 12 }}>
      <Action
        secondary
        label={open ? 'Hide task defaults' : 'Task defaults'}
        disabled={saving}
        onPress={() => {
          if (!open || !editing) setOpen(!open)
          else
            Alert.alert('Unsaved settings', 'Discard unsaved settings changes?', [
              { text: 'Keep editing', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => setOpen(false) },
            ])
        }}
      />
      {open && (
        <TaskDefaultSettingsForm {...props} onDirtyChange={setEditing} onSavingChange={setSaving} />
      )}
    </View>
  )
}
function TaskDefaultSettingsForm({
  repository,
  scope: selectedScope,
  onDirtyChange,
  onSavingChange,
}: {
  repository?: Repository
  scope?: SettingsScope
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
}) {
  const { styles } = useTheme()

  const { connected, call, snapshot, overviews } = useRuntime()
  const { busy, error, act } = useAction()
  const [setup, setSetup] = useApplicationState<{ defaults: RuntimeDefaults } | null>(null)
  const [localScope, setScope] = useApplicationState<SettingsScope>(
    repository ? 'environment-project' : 'environment',
  )
  const scope = selectedScope ?? localScope
  const [projectKey, setProjectKey] = useApplicationState<string | undefined>(undefined)
  const [inheritedPrompts, setInheritedPrompts] = useApplicationState<SavedPrompt[]>([])
  const [scopeValue, setScopeValue] = useApplicationState<ScopedSettingsValue>({})
  const [prompts, setPrompts] = useApplicationState<SavedPrompt[]>([])
  const [loadedScope, setLoadedScope] = useApplicationState('')

  const [legacyBehavior, setLegacyBehavior] = useApplicationState<TaskBehavior>({})
  const [behavior, setBehavior] = useApplicationState<TaskBehavior>({})
  const [inheritedBehavior, setInheritedBehavior] = useApplicationState<TaskBehavior>({})
  const [draft, setDraft] = useApplicationState<ProjectTaskDefaults>({})
  const [loadError, setLoadError] = useApplicationState('')
  const [showSetupCommand, setShowSetupCommand] = useApplicationState(false)
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    let active = true
    setSetup(null)
    if (!connected) return
    if (snapshot?.taskBehaviorSupported)
      void call('/api/runtime/preferences/read', {}, runtimePreferencesSchema)
        .then((value) => {
          if (active)
            setLegacyBehavior({
              continueAfterRestart: value.autoContinueAfterRestart,
              settleMerged: value.settleOnPullClose,
              settleClosed: value.settleOnPullClose,
            })
        })
        .catch((cause) => {
          if (active) setLoadError(String(cause))
        })
    void call(
      '/api/agents/settings/read',
      { scope, repositoryId: repository?.id },
      scopedSettingsResultSchema,
    )
      .then((value) => {
        if (active) {
          setSetup({ defaults: decode(runtimeDefaultsSchema, value.inherited.taskDefaults ?? {}) })
          setScopeValue(value.value)
          setProjectKey(value.projectKey)
          setInheritedPrompts(value.inherited.prompts ?? [])
          setPrompts(value.value.prompts ?? [])
          setLoadedScope(`${scope}:${repository?.id ?? ''}`)
          setDraft(value.value.taskDefaults ?? {})
          setShowSetupCommand(!!value.value.taskDefaults?.setupCommand)
          setBehavior(value.value.taskBehavior ?? {})
          setInheritedBehavior(value.inherited.taskBehavior ?? {})
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(String(error))
      })
    return () => {
      active = false
    }
  }, [call, connected, repository?.id, scope, retry, snapshot?.taskBehaviorSupported])
  const change = (value: ProjectTaskDefaults) => {
    setDraft(value)
    setSaved(false)
    if (value.setupCommand === undefined) setShowSetupCommand(false)
  }
  const harness = draft.harness
  const disabled =
    !connected || busy || !setup || loadedScope !== `${scope}:${repository?.id ?? ''}`
  const origins = taskDefaultOrigins(snapshot?.defaults, repository, scope, draft)
  const source = (key: keyof ProjectTaskDefaults) => {
    const origin = origins.find((entry) => entry.key === key)
    return (
      origin && (
        <SettingSource
          {...origin}
          setting={{ field: { group: 'taskDefaults', key }, repository, scope, value: draft[key] }}
          label={origin.label}
          disabled={disabled}
          onReset={() => change({ ...draft, [key]: undefined })}
        />
      )
    )
  }
  const projectServers = overviews.filter((entry) =>
    entry.snapshot?.workspace.repositories.some(
      (item) => repository?.gitIdentity && item.gitIdentity === repository.gitIdentity,
    ),
  )
  const configurations = scopedAgentEntries(
    snapshot?.defaults,
    repository,
    snapshot?.workspace.agents ?? [],
    settingsScopes[settingsScopes.indexOf(scope) + 1],
  )
  const dirty =
    !!setup &&
    JSON.stringify({ draft, prompts, behavior }) !==
      JSON.stringify({
        draft: scopeValue.taskDefaults ?? {},
        prompts: scopeValue.prompts ?? [],
        behavior: scopeValue.taskBehavior ?? {},
      })
  useSettingsDraft(dirty, busy)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => onSavingChange?.(busy), [busy, onSavingChange])
  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>New tasks</Text>
      <Text style={styles.muted}>
        Choose the agent and access for new tasks. Source labels show where each value comes from.
        Existing conversations keep their launch settings.
      </Text>
      {!selectedScope && (
        <>
          <Choice
            row
            label="Settings scope"
            value={scope}
            disabled={busy}
            items={settingsScopes
              .filter(
                (value) => repository || (value !== 'project' && value !== 'environment-project'),
              )
              .filter((value) => value !== 'project' || !!repository?.gitIdentity)
              .map((id) => ({ id, name: settingsScopeLabels[id] }))}
            onChange={(value) => {
              const select = () => {
                setSaved(false)
                setLoadError('')
                setScope(settingsScopes.find((scope) => scope === value) ?? 'environment')
              }
              if (!dirty) select()
              else
                Alert.alert('Unsaved settings', 'Discard unsaved settings changes?', [
                  { text: 'Keep editing', style: 'cancel' },
                  { text: 'Discard', style: 'destructive', onPress: select },
                ])
            }}
          />
        </>
      )}
      {repository && scope === 'project' && (
        <>
          <Choice
            row
            label="Default server"
            disabled={disabled}
            value={draft.defaultServerId ?? ''}
            items={[
              { id: '', name: 'Automatic · prefer current server' },
              ...(draft.defaultServerId &&
              !projectServers.some((entry) => entry.profile.id === draft.defaultServerId)
                ? [{ id: draft.defaultServerId, name: 'Unavailable server' }]
                : []),
              ...projectServers.map((entry) => ({
                id: entry.profile.id,
                name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`,
              })),
            ]}
            onChange={(value) => change({ ...draft, defaultServerId: value || undefined })}
          />
          <Text style={styles.muted}>
            If the default is offline, use another online copy. You can change servers in the
            composer.
          </Text>
          {source('defaultServerId')}
        </>
      )}
      <Choice
        row
        label="Agent configuration"
        disabled={disabled}
        value={harness ? 'custom' : 'inherit'}
        items={[
          {
            id: 'inherit',
            name: `Inherit (${providerDisplayName(setup?.defaults.harness.provider ?? 'codex')})`,
          },
          { id: 'custom', name: 'Override at this scope' },
          ...configurations.map(({ agent }) => ({
            id: `agent:${agent.id}`,
            name: `Use ${agent.name}`,
          })),
        ]}
        onChange={(value) => {
          const agent = configurations.find((entry) => `agent:${entry.agent.id}` === value)?.agent
          change({
            ...draft,
            harness:
              value === 'inherit'
                ? undefined
                : agent
                  ? decode(taskHarnessSchema.mapFields(Struct.omit(['resources'])), agent)
                  : (setup?.defaults.harness ?? defaultTaskHarness('codex')),
            ...(agent ? { permission: agent.permission } : {}),
          })
        }}
      />
      {source('harness')}
      <Choice
        row
        label="Default permissions"
        disabled={disabled}
        value={draft.permission ?? 'inherit'}
        items={[
          {
            id: 'inherit',
            name: `Inherit (${accessLabel(setup?.defaults.permission ?? 'full-access')})`,
          },
          ...selectableAccessModes(draft.permission).map((mode) => ({
            id: mode.id,
            name: mode.name,
          })),
        ]}
        onChange={(value) =>
          change({
            ...draft,
            permission:
              value === 'inherit' ? undefined : decode(agentSchema.fields.permission, value),
          })
        }
      />
      {source('permission')}
      <Text style={styles.muted}>
        Applies to new tasks across all harnesses. Existing tasks keep their access setting.
      </Text>
      {harness && (
        <>
          <Choice
            row
            label="Harness"
            disabled={disabled}
            value={harness.provider}
            items={providerSchema.literals.map((id) => ({ id, name: providerDisplayName(id) }))}
            onChange={(value) =>
              change({ ...draft, harness: defaultTaskHarness(decode(providerSchema, value)) })
            }
          />
          <ModelSettings
            disabled={disabled}
            agent={{ ...harness, id: 'defaults', name: 'Task defaults' }}
            onChange={(agent) =>
              change({
                ...draft,
                harness: decode(taskHarnessSchema.mapFields(Struct.omit(['resources'])), agent),
              })
            }
          />
          <Field
            label="Instructions"
            multiline
            editable={!disabled}
            value={harness.instructions}
            onChangeText={(instructions) =>
              change({ ...draft, harness: { ...harness, instructions } })
            }
          />
          <Field
            label={harness.provider === 'opencode' ? 'Server URL' : 'Executable (optional)'}
            editable={!disabled}
            value={agentConnectionValue({ ...harness, id: 'defaults', name: 'Defaults' })}
            onChangeText={(endpoint) =>
              change({
                ...draft,
                harness: changeAgentConnection(
                  { ...harness, id: 'defaults', name: 'Defaults' },
                  endpoint,
                ),
              })
            }
          />
        </>
      )}
      {!repository?.kind && (
        <>
          <Text style={[styles.text, { marginTop: 8, fontWeight: '600' }]}>Workspace & setup</Text>
          <Choice
            row
            label="Working directory"
            disabled={disabled}
            value={draft.execution ?? 'inherit'}
            items={[
              {
                id: 'inherit',
                name: `Inherit (${setup?.defaults.execution === 'worktree' ? 'Worktree' : 'Local checkout'})`,
              },
              { id: 'main', name: 'Local checkout' },
              { id: 'worktree', name: 'New worktree' },
            ]}
            onChange={(value) =>
              change({
                ...draft,
                execution: value === 'inherit' ? undefined : decode(executionSchema, value),
              })
            }
          />
          {source('execution')}
          <View style={{ gap: 4 }}>
            <View style={[styles.row, { flexWrap: 'nowrap', gap: 12 }]}>
              <Text style={[styles.text, { flex: 1 }]}>Start from origin</Text>
              <Switch
                accessibilityLabel="Start from origin"
                disabled={disabled}
                value={
                  draft.worktreeFromOrigin ??
                  setup?.defaults.worktreeFromOrigin ??
                  defaultWorktreeFromOrigin
                }
                onValueChange={(worktreeFromOrigin) => change({ ...draft, worktreeFromOrigin })}
              />
            </View>
            <Text style={styles.muted}>
              Prefers the latest matching origin branch for new worktrees, falling back to origin’s
              default branch. You can still select a local base branch for a task.
            </Text>
            {source('worktreeFromOrigin')}
          </View>
          <Choice
            row
            label="Submodules"
            value={draft.submodules ?? 'inherit'}
            disabled={disabled || !snapshot?.taskBehaviorSupported}
            items={[
              { id: 'inherit', name: 'Inherit' },
              { id: 'none', name: 'None' },
              { id: 'direct', name: 'Direct' },
              { id: 'recursive', name: 'Recursive' },
            ]}
            onChange={(value) =>
              change({
                ...draft,
                submodules:
                  value === 'none' || value === 'direct' || value === 'recursive'
                    ? value
                    : undefined,
              })
            }
          />
          {source('submodules')}
          <Choice
            row
            label="Worktree setup"
            disabled={disabled}
            value={
              draft.setupCommand === undefined
                ? 'inherit'
                : showSetupCommand
                  ? 'custom'
                  : 'disabled'
            }
            items={[
              { id: 'inherit', name: 'Inherit' },
              { id: 'custom', name: 'Custom command' },
              { id: 'disabled', name: 'Disable setup' },
            ]}
            onChange={(value) => {
              setShowSetupCommand(value === 'custom')
              change({
                ...draft,
                setupCommand:
                  value === 'inherit'
                    ? undefined
                    : value === 'disabled'
                      ? ''
                      : (setup?.defaults.setupCommand ?? ''),
              })
            }}
          />
          {source('setupCommand')}
          {draft.setupCommand !== undefined && showSetupCommand && (
            <Field
              label="Setup command"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              editable={!disabled}
              value={draft.setupCommand ?? ''}
              placeholder="pnpm install --frozen-lockfile"
              onChangeText={(setupCommand) => change({ ...draft, setupCommand })}
            />
          )}
          <Text style={styles.muted}>
            Setup runs in each new worktree using this runtime’s shell, before the agent starts.
            Five-minute limit. Failures stop startup; retrying the task retries setup. Use an
            idempotent command.
          </Text>
        </>
      )}
      <Text style={styles.title}>Saved prompts</Text>
      <Text style={styles.muted}>
        Entries at this scope override earlier prompts with the same name. Type #name in the
        composer. Remove an entry to inherit it again.
      </Text>
      {inheritedPrompts
        .filter(
          (prompt) =>
            !prompts.some((item) => item.name.toLowerCase() === prompt.name.toLowerCase()),
        )
        .map((prompt) => (
          <Action
            key={prompt.name}
            secondary
            label={`Override inherited #${prompt.name}`}
            disabled={disabled || prompts.length >= 40}
            onPress={() => {
              setSaved(false)
              setPrompts([...prompts, prompt])
            }}
          />
        ))}
      {prompts.map((prompt, index) => (
        <View key={prompt.id} style={{ gap: 8 }}>
          <Field
            label="Prompt name"
            value={prompt.name}
            editable={!disabled}
            onChangeText={(name) => {
              setSaved(false)
              setPrompts(prompts.map((item, i) => (i === index ? { ...item, name } : item)))
            }}
          />
          <Field
            label="Prompt text"
            value={prompt.text}
            multiline
            editable={!disabled}
            onChangeText={(text) => {
              setSaved(false)
              setPrompts(prompts.map((item, i) => (i === index ? { ...item, text } : item)))
            }}
          />
          <Action
            secondary
            label="Remove prompt override"
            disabled={disabled}
            onPress={() => {
              setSaved(false)
              setPrompts(prompts.filter((_, i) => i !== index))
            }}
          />
        </View>
      ))}
      <Action
        secondary
        label="Add prompt"
        disabled={disabled || prompts.length >= 40}
        onPress={() => {
          setSaved(false)
          setPrompts([...prompts, { id: randomUUID(), name: '', text: '' }])
        }}
      />
      {snapshot?.taskBehaviorSupported && (
        <View style={{ gap: 12 }}>
          <Text style={[styles.text, { fontWeight: '600' }]}>Task lifecycle</Text>
          <Text style={styles.muted}>
            Applies to existing tasks too. Off overrides an inherited On.
          </Text>
          {(
            [
              ['quotaResume', 'Auto-resume limited tasks'],
              ['quotaSnooze', 'Snooze limited tasks'],
              ['settleMerged', 'Auto-settle merged tasks'],
              ['settleClosed', 'Auto-settle closed tasks'],
              ['settleInactive', 'Auto-settle inactive tasks'],
              ['continueAfterRestart', 'Continue after restarts'],
            ] as const
          ).map(([key, label]) => (
            <View key={key} style={{ gap: 4 }}>
              <Choice
                label={label}
                value={behavior[key] === undefined ? 'inherit' : behavior[key] ? 'on' : 'off'}
                disabled={disabled}
                items={[
                  {
                    id: 'inherit',
                    name: `Inherit (${(inheritedBehavior[key] ?? legacyBehavior[key]) ? 'On' : 'Off'})`,
                  },
                  { id: 'on', name: 'On' },
                  { id: 'off', name: 'Off' },
                ]}
                onChange={(value) => {
                  setSaved(false)
                  setBehavior({
                    ...behavior,
                    [key]: value === 'inherit' ? undefined : value === 'on',
                  })
                }}
              />
              <SettingSource
                {...taskBehaviorOrigin(
                  snapshot?.defaults,
                  repository,
                  scope,
                  behavior,
                  key,
                  legacyBehavior[key] !== undefined,
                )}
                label={label}
                setting={{
                  field: { group: 'taskBehavior', key },
                  repository,
                  scope,
                  value: behavior[key],
                }}
                disabled={disabled}
                onReset={() => {
                  setBehavior({ ...behavior, [key]: undefined })
                  setSaved(false)
                }}
              />
            </View>
          ))}
          <Field
            label="Days of inactivity before settling"
            value={behavior.inactiveDays === undefined ? '' : String(behavior.inactiveDays)}
            placeholder={`Inherit (${inheritedBehavior.inactiveDays ?? 3})`}
            editable={!disabled}
            keyboardType="number-pad"
            onChangeText={(value) => {
              if (!value) {
                setBehavior({ ...behavior, inactiveDays: undefined })
                setSaved(false)
              } else if (
                Number.isInteger(Number(value)) &&
                Number(value) >= 1 &&
                Number(value) <= 365
              ) {
                setBehavior({ ...behavior, inactiveDays: Number(value) })
                setSaved(false)
              }
            }}
          />
          <SettingSource
            {...taskBehaviorOrigin(snapshot?.defaults, repository, scope, behavior, 'inactiveDays')}
            setting={{
              field: { group: 'taskBehavior', key: 'inactiveDays' },
              repository,
              scope,
              value: behavior.inactiveDays,
            }}
            label="Days of inactivity before settling"
            disabled={disabled}
            onReset={() => {
              setBehavior({ ...behavior, inactiveDays: undefined })
              setSaved(false)
            }}
          />
        </View>
      )}
      <Action
        label={busy ? 'Saving…' : 'Save defaults'}
        disabled={disabled}
        onPress={() =>
          act(async () => {
            if (!setup) return
            const value = decode(projectTaskDefaultsSchema, draft)
            const result = await call(
              '/api/agents/settings/save',
              {
                scope,
                repositoryId: repository?.id,
                before: scopeValue,
                projectKey,
                after: {
                  ...scopeValue,
                  taskDefaults: value,
                  ...(snapshot?.taskBehaviorSupported ? { taskBehavior: behavior } : {}),
                  prompts: prompts.map((prompt) => ({
                    ...prompt,
                    name: prompt.name.trim().replace(/\s+/g, '-'),
                    text: prompt.text.trim(),
                  })),
                },
              },
              scopedSettingsResultSchema,
            )
            setScopeValue(result.value)
            setDraft(result.value.taskDefaults ?? {})
            setBehavior(result.value.taskBehavior ?? {})
            setPrompts(result.value.prompts ?? [])
            setSaved(true)
          })
        }
      />
      <Action
        secondary
        label="Reset task defaults to inherited settings"
        disabled={disabled}
        onPress={() => change({})}
      />
      {saved && <Text style={styles.muted}>Defaults saved for new tasks.</Text>}
      {!!(error || loadError) && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error || loadError}
          </Text>
          <Action
            secondary
            label="Reload settings"
            onPress={() => {
              setLoadError('')
              setRetry(retry + 1)
            }}
          />
        </>
      )}
    </View>
  )
}
