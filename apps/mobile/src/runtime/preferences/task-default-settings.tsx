import { randomUUID } from 'expo-crypto'
import {
  scopedSettingsResultSchema,
  taskDefaultOrigins,
  settingsScopes,
  settingsScopeLabels,
  type SettingsScope,
  type ScopedSettingsValue,
  type SavedPrompt,
} from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
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
import { styles } from '../../ui/theme'
import { ModelSettings } from '../../agents/model-settings'
export function TaskDefaultSettings(props: {
  repository?: Repository
  inline?: boolean
  scope?: SettingsScope
}) {
  const [open, setOpen] = useApplicationState(false)
  if (props.inline) return <TaskDefaultSettingsForm {...props} />
  return (
    <View style={{ gap: 12 }}>
      <Action
        secondary
        label={open ? 'Hide task defaults' : 'Task defaults'}
        onPress={() => setOpen(!open)}
      />
      {open && <TaskDefaultSettingsForm {...props} />}
    </View>
  )
}
function TaskDefaultSettingsForm({
  repository,
  scope: selectedScope,
}: {
  repository?: Repository
  scope?: SettingsScope
}) {
  const { connected, call, snapshot } = useRuntime()
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

  const [draft, setDraft] = useApplicationState<ProjectTaskDefaults>({})
  const [loadError, setLoadError] = useApplicationState('')
  const [showInheritance, setShowInheritance] = useApplicationState(false)
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    let active = true
    setSetup(null)
    if (!connected) return
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
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(String(error))
      })
    return () => {
      active = false
    }
  }, [call, connected, repository?.id, scope, retry])
  const change = (value: ProjectTaskDefaults) => {
    setDraft(value)
    setSaved(false)
  }
  const harness = draft.harness
  const disabled =
    !connected || busy || !setup || loadedScope !== `${scope}:${repository?.id ?? ''}`
  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Text style={styles.text}>Task defaults</Text>
      <Text style={styles.muted}>
        Global → Environment → Project → Environment + project. Unset values inherit the earlier
        levels. Existing tasks keep their settings.
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
              setSaved(false)
              setLoadError('')
              setScope(settingsScopes.find((scope) => scope === value) ?? 'environment')
            }}
          />
        </>
      )}
      <Action
        secondary
        label="Inheritance & overrides"
        onPress={() => setShowInheritance(!showInheritance)}
      />
      {showInheritance && (
        <View style={{ gap: 10 }}>
          <Text style={styles.muted}>
            Reset an override to use the preceding level; save to apply.
          </Text>
          {taskDefaultOrigins(snapshot?.defaults, repository, scope, draft).map((field) => (
            <View key={field.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{field.label}</Text>
                <Text style={styles.muted}>
                  {field.source === 'built-in'
                    ? 'Built-in default'
                    : settingsScopeLabels[field.source]}
                </Text>
              </View>
              <Action
                secondary
                icon="refresh"
                label={`Use inherited ${field.label.toLowerCase()}`}
                disabled={disabled || !field.overridden}
                onPress={() => change({ ...draft, [field.key]: undefined })}
              />
            </View>
          ))}
        </View>
      )}
      <Choice
        row
        label="Agent configuration"
        disabled={disabled}
        value={harness ? 'custom' : 'inherit'}
        items={[
          {
            id: 'inherit',
            name: `Inherit (${setup?.defaults.harness.provider ?? ''})`,
          },
          { id: 'custom', name: 'Override at this scope' },
        ]}
        onChange={(value) =>
          change({
            ...draft,
            harness:
              value === 'inherit'
                ? undefined
                : (setup?.defaults.harness ?? defaultTaskHarness('codex')),
          })
        }
      />
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
            items={providerSchema.literals.map((id) => ({ id, name: id }))}
            onChange={(value) =>
              change({ ...draft, harness: defaultTaskHarness(decode(providerSchema, value)) })
            }
          />
          <ModelSettings
            disabled={disabled}
            agent={{ ...harness, id: 'defaults', name: 'Task defaults' }}
            onChange={(agent) =>
              change({ ...draft, harness: decode(taskHarnessSchema.omit('resources'), agent) })
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
          <View style={{ gap: 4 }}>
            <View style={[styles.row, { flexWrap: 'nowrap', gap: 12 }]}>
              <Text style={[styles.text, { flex: 1 }]}>Start from origin</Text>
              <Switch
                accessibilityLabel="Start from origin"
                disabled={disabled}
                value={draft.worktreeFromOrigin ?? setup?.defaults.worktreeFromOrigin ?? false}
                onValueChange={(worktreeFromOrigin) => change({ ...draft, worktreeFromOrigin })}
              />
            </View>
            <Text style={styles.muted}>
              Creates the worktree from the latest matching branch on origin instead of your local
              branch. Without a matching branch, origin’s default branch is used.
            </Text>
            {draft.worktreeFromOrigin !== undefined && (
              <Action
                secondary
                label={`Use inherited setting (${setup?.defaults.worktreeFromOrigin ? 'on' : 'off'})`}
                disabled={disabled}
                onPress={() => change({ ...draft, worktreeFromOrigin: undefined })}
              />
            )}
          </View>
          <Choice
            row
            label="Worktree setup"
            disabled={disabled}
            value={draft.setupCommand === undefined ? 'inherit' : 'custom'}
            items={[
              { id: 'inherit', name: 'Inherit' },
              { id: 'custom', name: 'Override at this scope (empty disables setup)' },
            ]}
            onChange={(value) =>
              change({ ...draft, setupCommand: value === 'inherit' ? undefined : '' })
            }
          />
          {draft.setupCommand !== undefined && (
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
