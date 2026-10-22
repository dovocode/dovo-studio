import {
  settingsChangeCount,
  settingsChanges,
  selectDefaultPermissionPreset,
  resolveDefaultPermissionPolicy,
  permissionPolicyLabel,
} from '@dovo/protocol'
import { Struct } from 'effect'
import { randomUUID } from 'expo-crypto'
import {
  runtimeComputerName,
  scopedSettingsResultSchema,
  taskDefaultOrigins,
  providerDisplayName,
  scopedAgentEntries,
  settingsScopes,
  settingsScopeLabels,
  type SettingsScope,
  type SavedPrompt,
} from '@dovo/protocol'
import { useEffect, useRef } from 'react'
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
  defaultWorktreeFromOrigin,
  agentConnectionValue,
  changeAgentConnection,
  changeAgentProvider,
  taskHarnessSchema,
  type ProjectTaskDefaults,
  type Repository,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { useRuntime } from '../connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Text } from '../../ui/content/text'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { Switch } from '../../ui/controls/switch'
import { useTheme } from '../../ui/theme'
import { SettingsGroup } from '../../screens/settings-group'
import { ModelSettings } from '../../agents/model-settings'
import {
  PermissionPolicyControls,
  permissionPolicyUIIssue,
} from '../../agents/permission-policy-controls'
import { SettingSource } from './setting-source'
import { useSettingsDraft } from './settings-target'
import { SettingsSaveBar } from '../../screens/settings-save-bar'
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
  const [settings, setSettings] = useApplicationState<
    typeof scopedSettingsResultSchema.Type | null
  >(null)
  const [localScope, setScope] = useApplicationState<SettingsScope>(
    repository ? 'environment-project' : 'environment',
  )
  const scope = selectedScope ?? localScope
  const [prompts, setPrompts] = useApplicationState<SavedPrompt[]>([])
  const [loadedScope, setLoadedScope] = useApplicationState('')

  const [draft, setDraft] = useApplicationState<ProjectTaskDefaults>({})
  const [loadError, setLoadError] = useApplicationState('')
  const [showSetupCommand, setShowSetupCommand] = useApplicationState(false)
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  const protectDraft = useRef(false)
  useEffect(() => {
    if (protectDraft.current && loadedScope === `${scope}:${repository?.id ?? ''}`) return
    let active = true
    setSettings(null)
    setLoadError('')
    setSaved(false)
    if (!connected) return
    void call(
      '/api/agents/settings/read',
      { scope, repositoryId: repository?.id },
      scopedSettingsResultSchema,
    )
      .then((value) => {
        if (active) {
          setSettings(value)
          setPrompts(value.value.prompts ?? [])
          setLoadedScope(`${scope}:${repository?.id ?? ''}`)
          setDraft(value.value.taskDefaults ?? {})
          setShowSetupCommand(!!value.value.taskDefaults?.setupCommand)
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
  const policySupported = snapshot?.permissionPolicySupported === true
  const inherited = settings?.inherited.taskDefaults
  const inheritedPrompts = settings?.inherited.prompts ?? []
  const scopeValue = settings?.value ?? {}
  const inheritedHarness = inherited?.harness ?? defaultTaskHarness('codex')
  const effectiveHarness = harness ?? inheritedHarness
  const defaultPolicy = resolveDefaultPermissionPolicy(effectiveHarness, inherited, draft)
  const policyIssue =
    (!policySupported && (draft.approvalPolicy === null || draft.sandboxMode === null)
      ? 'Update this runtime to reset inherited approval and sandbox controls.'
      : undefined) ||
    permissionPolicyUIIssue(defaultPolicy, policySupported) ||
    (harness && permissionPolicyUIIssue(harness, policySupported))
  const disabled =
    !connected || busy || !settings || loadedScope !== `${scope}:${repository?.id ?? ''}`
  const origins = taskDefaultOrigins(snapshot?.defaults, repository, scope, draft)
  const source = (key: keyof ProjectTaskDefaults) => {
    const origin = origins.find((entry) => entry.key === key)
    return (
      origin && (
        <SettingSource
          {...origin}
          setting={{
            field: { group: 'taskDefaults', key },
            repository,
            scope,
            value: draft[key],
            inheritedValue: inherited?.[key],
          }}
          label={origin.label}
          disabled={
            disabled || ((key === 'approvalPolicy' || key === 'sandboxMode') && !policySupported)
          }
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
    !!settings &&
    JSON.stringify({ draft, prompts }) !==
      JSON.stringify({
        draft: scopeValue.taskDefaults ?? {},
        prompts: scopeValue.prompts ?? [],
      })
  protectDraft.current = dirty
  useSettingsDraft(dirty, busy)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => onSavingChange?.(busy), [busy, onSavingChange])
  return (
    <View style={{ gap: 28 }}>
      <SettingsGroup title="New tasks">
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={styles.muted}>
            Choose the agent and access for new tasks. Source labels show where each value comes
            from. Existing conversations keep their launch settings.
          </Text>
          {!connected && (
            <Text accessibilityRole="alert" style={styles.muted}>
              This computer is offline. Reconnect to load and save defaults.
            </Text>
          )}
          {connected && !settings && !loadError && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              Loading task defaults…
            </Text>
          )}
          {dirty && !saved && (
            <Text style={styles.muted}>
              Unsaved changes · Save changes to apply them at this level.
            </Text>
          )}
          {!selectedScope && (
            <>
              <Choice
                row
                label="Settings scope"
                value={scope}
                disabled={busy}
                items={settingsScopes
                  .filter(
                    (value) =>
                      repository || (value !== 'project' && value !== 'environment-project'),
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
          {repository && scope === 'project' && overviews.length > 1 && (
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
          {(snapshot?.smartModelSelectionEnabled === true || draft.modelSelection === 'smart') && (
            <Choice
              row
              label="Model selection"
              disabled={disabled}
              value={draft.modelSelection ?? ''}
              items={[
                { id: '', name: 'Use inherited setting' },
                { id: 'fixed', name: 'Configured harness and model' },
                ...(snapshot?.smartModelSelectionEnabled === true
                  ? [{ id: 'smart', name: 'Maestro', icon: 'maestro' as const }]
                  : []),
              ]}
              onChange={(value) =>
                change({
                  ...draft,
                  modelSelection:
                    value === 'smart' ? 'smart' : value === 'fixed' ? 'fixed' : undefined,
                })
              }
            />
          )}
          <Choice
            row
            label="Agent configuration"
            disabled={disabled}
            value={harness ? 'custom' : 'inherit'}
            items={[
              {
                id: 'inherit',
                name: `Inherit (${providerDisplayName(inherited?.harness?.provider ?? 'codex')})`,
              },
              { id: 'custom', name: 'Override at this scope' },
              ...configurations.map(({ agent }) => ({
                id: `agent:${agent.id}`,
                name: `Use ${agent.name}`,
              })),
            ]}
            onChange={(value) => {
              const agent = configurations.find(
                (entry) => `agent:${entry.agent.id}` === value,
              )?.agent
              change({
                ...draft,
                harness:
                  value === 'inherit'
                    ? undefined
                    : agent
                      ? decode(taskHarnessSchema.mapFields(Struct.omit(['resources'])), agent)
                      : (inherited?.harness ?? defaultTaskHarness('codex')),
                ...(agent
                  ? {
                      permission: agent.permission,
                      approvalPolicy: agent.approvalPolicy ?? (policySupported ? null : undefined),
                      sandboxMode: agent.sandboxMode ?? (policySupported ? null : undefined),
                    }
                  : {}),
              })
            }}
          />
          {source('harness')}
          <Choice
            row
            label="Access mode"
            disabled={disabled}
            value={
              permissionPolicyLabel(defaultPolicy) === 'Custom'
                ? 'custom'
                : (draft.permission ?? 'inherit')
            }
            selectedLabel={permissionPolicyLabel(defaultPolicy) === 'Custom' ? 'Custom' : undefined}
            items={[
              {
                id: 'inherit',
                name: `Inherit (${accessLabel(inherited?.permission ?? 'full-access')})`,
              },
              ...selectableAccessModes(draft.permission).map((mode) => ({
                id: mode.id,
                name: mode.name,
              })),
            ]}
            onChange={(value) =>
              change(
                selectDefaultPermissionPreset(
                  draft,
                  value === 'inherit' ? undefined : decode(agentSchema.fields.permission, value),
                  policySupported,
                ),
              )
            }
          />
          {source('permission')}
          <Text style={styles.muted}>
            Applies to new tasks across all harnesses. Existing tasks keep their access setting.
          </Text>
          <PermissionPolicyControls
            value={{
              ...defaultPolicy,
              approvalPolicy: draft.approvalPolicy ?? undefined,
              sandboxMode: draft.sandboxMode ?? undefined,
            }}
            inherited={resolveDefaultPermissionPolicy(effectiveHarness, inherited)}
            resetFields={[
              ...(draft.approvalPolicy === null ? ['approvalPolicy' as const] : []),
              ...(draft.sandboxMode === null ? ['sandboxMode' as const] : []),
            ]}
            onResetField={(field) => change({ ...draft, [field]: null })}
            supported={policySupported}
            disabled={disabled}
            onReset={() => change(selectDefaultPermissionPreset(draft, defaultPolicy.permission))}
            onChange={(policy, field) =>
              change(field ? { ...draft, [field]: policy[field] } : { ...draft, ...policy })
            }
          />
          {source('approvalPolicy')}
          {source('sandboxMode')}
          {policyIssue && (
            <Text accessibilityRole="alert" style={styles.error}>
              {policyIssue}
            </Text>
          )}
          {harness && (
            <>
              <Choice
                row
                label="Harness"
                disabled={disabled}
                value={harness.provider}
                items={providerSchema.literals.map((id) => ({ id, name: providerDisplayName(id) }))}
                onChange={(value) => {
                  const next = changeAgentProvider(
                    { ...harness, ...defaultPolicy, id: 'defaults', name: 'Defaults' },
                    decode(providerSchema, value),
                  )
                  change({
                    ...draft,
                    permission: next.permission,
                    approvalPolicy: next.approvalPolicy ?? (policySupported ? null : undefined),
                    sandboxMode: next.sandboxMode ?? (policySupported ? null : undefined),
                    harness: {
                      ...defaultTaskHarness(next.provider),
                      permission: next.permission,
                      approvalPolicy: next.approvalPolicy,
                      sandboxMode: next.sandboxMode,
                    },
                  })
                }}
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
            <SettingsGroup
              title="Advanced workspace setup"
              advanced
              searchLabels={[
                'Working directory',
                'Submodules',
                'Worktree setup',
                'Setup command',
                'Start from origin',
              ]}
            >
              <Choice
                row
                label="Working directory"
                disabled={disabled}
                value={draft.execution ?? 'inherit'}
                items={[
                  {
                    id: 'inherit',
                    name: `Inherit (${inherited?.execution === 'worktree' ? 'Worktree' : 'Local checkout'})`,
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
                      inherited?.worktreeFromOrigin ??
                      defaultWorktreeFromOrigin
                    }
                    onValueChange={(worktreeFromOrigin) => change({ ...draft, worktreeFromOrigin })}
                  />
                </View>
                <Text style={styles.muted}>
                  Prefers the latest matching origin branch for new worktrees, falling back to
                  origin’s default branch. You can still select a local base branch for a task.
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
                          : (inherited?.setupCommand ?? ''),
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
            </SettingsGroup>
          )}
        </View>
      </SettingsGroup>
      <SettingsGroup title="Saved prompts">
        <View style={{ padding: 16, gap: 12 }}>
          {!prompts.length && !inheritedPrompts.length && (
            <Text style={styles.muted}>
              No saved prompts. Add a reusable message to insert with #name.
            </Text>
          )}
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
        </View>
      </SettingsGroup>
      <SettingsSaveBar
        changes={settingsChanges(
          { ...scopeValue.taskDefaults, prompts: scopeValue.prompts ?? [] },
          { ...draft, prompts },
        )}
        saveError={error}
        readLatestChanges={async () =>
          settingsChanges(
            scopeValue,
            (
              await call(
                '/api/agents/settings/read',
                { scope, repositoryId: repository?.id },
                scopedSettingsResultSchema,
              )
            ).value,
          )
        }
        dirty={dirty}
        saving={busy}
        disabled={disabled || !!policyIssue}
        saved={saved}
        changeCount={
          settingsChangeCount(scopeValue.taskDefaults ?? {}, draft) +
          (JSON.stringify(prompts) !== JSON.stringify(scopeValue.prompts ?? []) ? 1 : 0)
        }
        onDiscard={() => {
          setDraft(scopeValue.taskDefaults ?? {})
          setPrompts(scopeValue.prompts ?? [])
          setShowSetupCommand(!!scopeValue.taskDefaults?.setupCommand)
          setSaved(false)
        }}
        onSave={() =>
          act(async () => {
            if (!settings || disabled || policyIssue) return
            const value = decode(projectTaskDefaultsSchema, draft)
            const result = await call(
              '/api/agents/settings/save',
              {
                scope,
                repositoryId: repository?.id,
                before: scopeValue,
                projectKey: settings.projectKey,
                after: {
                  ...scopeValue,
                  taskDefaults: value,
                  prompts: prompts.map((prompt) => ({
                    ...prompt,
                    name: prompt.name.trim().replace(/\s+/g, '-'),
                    text: prompt.text.trim(),
                  })),
                },
              },
              scopedSettingsResultSchema,
            )
            setSettings(result)
            setDraft(result.value.taskDefaults ?? {})
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
      {saved && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Settings saved at {settingsScopeLabels[scope]}. Defaults apply to new tasks.
        </Text>
      )}
      {!!(error || loadError) && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error || loadError}
          </Text>
          <Action
            secondary
            label="Reload settings"
            disabled={!connected || busy}
            onPress={() => {
              const reload = () => {
                setSettings(null)
                setLoadError('')
                setRetry(retry + 1)
              }
              if (!dirty) reload()
              else
                Alert.alert(
                  'Discard unsaved edits?',
                  'Load the latest saved settings and discard your edits?',
                  [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard and reload', style: 'destructive', onPress: reload },
                  ],
                )
            }}
          />
        </>
      )}
    </View>
  )
}
