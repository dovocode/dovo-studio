import { Layers, Undo2 } from 'lucide-react'
import {
  randomUUID,
  scopedSettingsResultSchema,
  taskDefaultOrigins,
  settingsScopes,
  settingsScopeLabels,
  type SettingsScope,
  type ScopedSettingsValue,
  type SavedPrompt,
} from '@dovo/protocol'
import { useCallback, useEffect } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  executionSchema,
  accessLabel,
  selectableAccessModes,
  agentSchema,
  decode,
  defaultTaskHarness,
  modelCatalogSchema,
  projectTaskDefaultsSchema,
  providerSchema,
  runtimeDefaultsSchema,
  agentConnectionValue,
  changeAgentConnection,
  taskHarnessSchema,
  type AgentDiscovery,
  type ProjectTaskDefaults,
  type Repository,
  type RuntimeDefaults,
} from '@dovo/protocol'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { FormField } from './components/form-field'
import { ChoicePicker } from './choice-picker'
import { ModelSettings } from './model-settings'

/** `inline` shows the form directly, for a dedicated settings page. */
export function TaskDefaultSettings(props: {
  repository?: Repository
  inline?: boolean
  scope?: SettingsScope
}) {
  const [open, setOpen] = useApplicationState(false)
  if (props.inline) return <TaskDefaultSettingsForm {...props} />
  return (
    <div className="space-y-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide task defaults' : 'Task defaults'}
      </Button>
      {open && <TaskDefaultSettingsForm {...props} />}
    </div>
  )
}
function TaskDefaultSettingsForm({
  repository,
  scope: selectedScope,
}: {
  repository?: Repository
  scope?: SettingsScope
}) {
  const { connected, request, snapshot } = useWorkspace()
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
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    let active = true
    setSetup(null)
    if (!connected) return
    void request(
      '/api/agents/settings/read',
      { scope, repositoryId: repository?.id },
      scopedSettingsResultSchema,
    )
      .then((value) => {
        if (!active) return
        setSetup({ defaults: decode(runtimeDefaultsSchema, value.inherited.taskDefaults ?? {}) })
        setScopeValue(value.value)
        setProjectKey(value.projectKey)
        setInheritedPrompts(value.inherited.prompts ?? [])
        setPrompts(value.value.prompts ?? [])
        setLoadedScope(`${scope}:${repository?.id ?? ''}`)
        setDraft(value.value.taskDefaults ?? {})
      })
      .catch((error: unknown) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [connected, request, repository?.id, scope, retry])
  const loadModels = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const change = (value: ProjectTaskDefaults) => {
    setDraft(value)
    setSaved(false)
  }
  const harness = draft.harness
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">Task defaults</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Global → Environment → Project → Environment + project. Unset values inherit the earlier
          levels. Existing tasks keep their settings.
        </p>
      </div>
      {!selectedScope && (
        <>
          <FormField layout="settings" label="Settings scope">
            <ChoicePicker
              value={scope}
              disabled={busy}
              onValueChange={(value) => {
                setSaved(false)
                setError('')
                setScope(settingsScopes.find((scope) => scope === value) ?? 'environment')
              }}
            >
              {settingsScopes
                .filter(
                  (value) => repository || (value !== 'project' && value !== 'environment-project'),
                )
                .filter((value) => value !== 'project' || !!repository?.gitIdentity)
                .map((value) => (
                  <option key={value} value={value}>
                    {settingsScopeLabels[value]}
                  </option>
                ))}
            </ChoicePicker>
          </FormField>
        </>
      )}
      <fieldset
        disabled={
          !connected || busy || !setup || loadedScope !== `${scope}:${repository?.id ?? ''}`
        }
        className="grid gap-3"
      >
        <details className="rounded-md border px-3 py-2 text-xs">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <Layers className="size-3.5" />
            Inheritance & overrides
          </summary>
          <p className="mt-2 text-muted-foreground">
            Global → Environment → Project → Environment + project. Reset an override to use the
            preceding level; save to apply.
          </p>
          <ul className="mt-3 space-y-2">
            {taskDefaultOrigins(snapshot?.defaults, repository, scope, draft).map((field) => (
              <li key={field.key} className="flex items-center justify-between gap-3">
                <span>{field.label}</span>
                <span className="ml-auto text-muted-foreground">
                  {field.source === 'built-in'
                    ? 'Built-in default'
                    : settingsScopeLabels[field.source]}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-7 p-0"
                  disabled={!field.overridden}
                  aria-label={`Use inherited ${field.label.toLowerCase()}`}
                  title="Use inherited setting"
                  onClick={() => change({ ...draft, [field.key]: undefined })}
                >
                  <Undo2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </details>
        <FormField layout="settings" label="Agent configuration">
          <ChoicePicker
            value={harness ? 'custom' : 'inherit'}
            onValueChange={(value) =>
              change({
                ...draft,
                harness:
                  value === 'inherit'
                    ? undefined
                    : (setup?.defaults.harness ?? defaultTaskHarness('codex')),
              })
            }
          >
            <option value="inherit">Inherit ({setup?.defaults.harness.provider})</option>
            <option value="custom">Override at this scope</option>
          </ChoicePicker>
        </FormField>
        <FormField layout="settings" label="Default permissions">
          <ChoicePicker
            value={draft.permission ?? 'inherit'}
            onValueChange={(value) =>
              change({
                ...draft,
                permission:
                  value === 'inherit' ? undefined : decode(agentSchema.fields.permission, value),
              })
            }
          >
            <option value="inherit">
              Inherit ({accessLabel(setup?.defaults.permission ?? 'full-access')})
            </option>
            {selectableAccessModes(draft.permission).map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.name}
              </option>
            ))}
          </ChoicePicker>
          <p className="mt-1 text-xs text-muted-foreground">
            Applies to new tasks across all harnesses. Existing tasks keep their access setting.
          </p>
        </FormField>
        {harness && (
          <>
            <FormField layout="settings" label="Harness">
              <ChoicePicker
                value={harness.provider}
                onValueChange={(value) =>
                  change({ ...draft, harness: defaultTaskHarness(decode(providerSchema, value)) })
                }
              >
                {providerSchema.literals.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </ChoicePicker>
            </FormField>
            <ModelSettings
              agent={{ ...harness, id: 'defaults', name: 'Task defaults' }}
              connected={connected}
              loadModels={loadModels}
              onChange={(agent) =>
                change({ ...draft, harness: decode(taskHarnessSchema.omit('resources'), agent) })
              }
            />
            <FormField layout="settings" label="Instructions">
              <Textarea
                value={harness.instructions}
                onChange={(event) =>
                  change({ ...draft, harness: { ...harness, instructions: event.target.value } })
                }
              />
            </FormField>
            <FormField
              layout="settings"
              label={harness.provider === 'opencode' ? 'Server URL' : 'Executable (optional)'}
            >
              <Input
                value={agentConnectionValue({ ...harness, id: 'defaults', name: 'Defaults' })}
                onChange={(event) =>
                  change({
                    ...draft,
                    harness: changeAgentConnection(
                      { ...harness, id: 'defaults', name: 'Defaults' },
                      event.target.value,
                    ),
                  })
                }
              />
            </FormField>
          </>
        )}
        {!repository?.kind && (
          <>
            <FormField layout="settings" label="Working directory">
              <ChoicePicker
                value={draft.execution ?? 'inherit'}
                onValueChange={(value) =>
                  change({
                    ...draft,
                    execution: value === 'inherit' ? undefined : decode(executionSchema, value),
                  })
                }
              >
                <option value="inherit">
                  Inherit (
                  {setup?.defaults.execution === 'worktree' ? 'Worktree' : 'Local checkout'})
                </option>
                <option value="main">Local checkout</option>
                <option value="worktree">New worktree</option>
              </ChoicePicker>
            </FormField>
            <StartFromOrigin
              value={draft.worktreeFromOrigin}
              inherited={setup?.defaults.worktreeFromOrigin ?? false}
              onChange={(worktreeFromOrigin) => change({ ...draft, worktreeFromOrigin })}
            />
            <FormField layout="settings" label="Worktree setup">
              <ChoicePicker
                value={draft.setupCommand === undefined ? 'inherit' : 'custom'}
                onValueChange={(value) =>
                  change({ ...draft, setupCommand: value === 'inherit' ? undefined : '' })
                }
              >
                <option value="inherit">Inherit</option>
                <option value="custom">Override at this scope (empty disables setup)</option>
              </ChoicePicker>
            </FormField>
            {draft.setupCommand !== undefined && (
              <FormField layout="settings" label="Setup command">
                <Textarea
                  value={draft.setupCommand ?? ''}
                  placeholder="pnpm install --frozen-lockfile"
                  onChange={(event) => change({ ...draft, setupCommand: event.target.value })}
                />
              </FormField>
            )}
            <p className="text-xs text-muted-foreground">
              Setup runs in each new worktree using this runtime’s shell, before the agent starts.
              Five-minute limit. Failures stop startup; retrying the task retries setup. Use an
              idempotent command.
            </p>
          </>
        )}
        <section className="space-y-2">
          <h4 className="text-sm font-medium">Saved prompts</h4>
          <p className="text-xs text-muted-foreground">
            Entries at this scope override earlier prompts with the same name. Type #name in the
            composer. Remove an entry to inherit it again.
          </p>
          {inheritedPrompts
            .filter(
              (prompt) =>
                !prompts.some((item) => item.name.toLowerCase() === prompt.name.toLowerCase()),
            )
            .map((prompt) => (
              <Button
                key={prompt.name}
                variant="ghost"
                disabled={prompts.length >= 40}
                onClick={() => {
                  setSaved(false)
                  setPrompts([...prompts, prompt])
                }}
              >
                Override inherited #{prompt.name}
              </Button>
            ))}
          {prompts.map((prompt, index) => (
            <div key={prompt.id} className="space-y-2 rounded-md border p-2">
              <Input
                aria-label="Prompt name"
                placeholder="name"
                value={prompt.name}
                onChange={(event) => {
                  setSaved(false)
                  setPrompts(
                    prompts.map((item, i) =>
                      i === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }}
              />
              <Textarea
                aria-label="Prompt text"
                placeholder="Prompt text"
                value={prompt.text}
                onChange={(event) => {
                  setSaved(false)
                  setPrompts(
                    prompts.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setSaved(false)
                  setPrompts(prompts.filter((_, i) => i !== index))
                }}
              >
                Remove prompt override
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={prompts.length >= 40}
            onClick={() => {
              setSaved(false)
              setPrompts([...prompts, { id: randomUUID(), name: '', text: '' }])
            }}
          >
            Add prompt
          </Button>
        </section>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (!setup) return
              setBusy(true)
              setError('')
              setSaved(false)
              const save = Promise.resolve().then(async () => {
                const value = decode(projectTaskDefaultsSchema, draft)
                const result = await request(
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
              })
              void save
                .then(() => setSaved(true))
                .catch((error: unknown) => setError(String(error)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Saving…' : 'Save defaults'}
          </Button>
          <Button variant="ghost" onClick={() => change({})}>
            Reset task defaults to inherited settings
          </Button>
        </div>
      </fieldset>
      {!connected && (
        <p className="text-xs text-muted-foreground">Connect to this runtime to edit settings.</p>
      )}
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Defaults saved for new tasks.
        </p>
      )}
      {error && (
        <div role="alert" className="text-xs text-destructive">
          {error}
          <Button
            variant="ghost"
            onClick={() => {
              setError('')
              setRetry(retry + 1)
            }}
          >
            Reload settings
          </Button>
        </div>
      )}
    </section>
  )
}

/** Worktrees start from the project's current branch unless "Start from origin" is on. A project
 * follows its computer's choice until changed here. */
function StartFromOrigin({
  value,
  inherited,
  onChange,
}: {
  value: boolean | undefined
  /** The computer's choice, for project settings; undefined on the computer itself. */
  inherited: boolean | undefined
  onChange: (value: boolean | undefined) => void
}) {
  const checked = value ?? inherited ?? false
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          Start from origin
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Creates the worktree from the latest matching branch on origin instead of your local
            branch. Without a matching branch, origin’s default branch is used.
          </span>
        </span>
      </label>
      {inherited !== undefined && value !== undefined && (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 pl-6 text-xs"
          onClick={() => onChange(undefined)}
        >
          Use inherited setting ({inherited ? 'on' : 'off'})
        </Button>
      )}
    </div>
  )
}
