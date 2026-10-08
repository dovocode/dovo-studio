import { Struct } from 'effect'
import { useCallback, useEffect } from 'react'
import {
  accessLabel,
  runtimeComputerName,
  agentSchema,
  agentConnectionValue,
  changeAgentConnection,
  decode,
  defaultTaskHarness,
  executionSchema,
  modelCatalogSchema,
  modelDisplayName,
  projectTaskDefaultsSchema,
  providerSchema,
  providerDisplayName,
  randomUUID,
  scopedAgentEntries,
  scopedSettingsResultSchema,
  settingsScopes,
  settingsScopeLabels,
  taskDefaultOrigins,
  taskHarnessSchema,
  type AgentDiscovery,
  type ProjectTaskDefaults,
  type Repository,
  type SavedPrompt,
  type ScopedSettingsValue,
  type SettingsScope,
} from '@dovo/protocol'
import { useSettingsDraft, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { selectableAccessModes } from '@dovo/protocol'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { ChoicePicker } from './choice-picker'
import { ModelSettings } from './model-settings'
import { SettingsGroup, SettingRow, Toggle } from './settings-layout'
import { SettingSource } from './setting-source'

/** Local detail panels can expand this; dedicated settings pages show the form directly. */
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
    <div className="space-y-3">
      <Button
        variant="outline"
        aria-expanded={open}
        disabled={saving}
        onClick={() => {
          if (!open || !editing || window.confirm('Discard unsaved settings changes?'))
            setOpen(!open)
        }}
      >
        {open ? 'Hide task defaults' : 'Task defaults'}
      </Button>
      {open && (
        <TaskDefaultSettingsForm {...props} onDirtyChange={setEditing} onSavingChange={setSaving} />
      )}
    </div>
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
  const { connected, request, snapshot, runtimes } = useWorkspace()
  const [localScope, setScope] = useApplicationState<SettingsScope>(
    repository ? 'environment-project' : 'environment',
  )
  const scope = selectedScope ?? localScope
  const [settings, setSettings] = useApplicationState<
    typeof scopedSettingsResultSchema.Type | null
  >(null)
  const [loadedScope, setLoadedScope] = useApplicationState('')
  const [draft, setDraft] = useApplicationState<ProjectTaskDefaults>({})
  const [prompts, setPrompts] = useApplicationState<SavedPrompt[]>([])
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  const [showSetupCommand, setShowSetupCommand] = useApplicationState(false)
  useEffect(() => {
    let active = true
    setSettings(null)
    setError('')
    setSaved(false)
    if (connected)
      void request(
        '/api/agents/settings/read',
        { scope, repositoryId: repository?.id },
        scopedSettingsResultSchema,
      )
        .then((value) => {
          if (!active) return
          setSettings(value)
          setDraft(value.value.taskDefaults ?? {})
          setPrompts(value.value.prompts ?? [])
          setShowSetupCommand(!!value.value.taskDefaults?.setupCommand)
          setLoadedScope(`${scope}:${repository?.id ?? ''}`)
        })
        .catch((cause: unknown) => {
          if (active) setError(String(cause))
        })
    return () => {
      active = false
    }
  }, [connected, request, repository?.id, scope, retry])
  const loadModels = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const inherited = settings?.inherited.taskDefaults ?? {}
  const inheritedHarness = inherited.harness ?? defaultTaskHarness('codex')
  const harness = draft.harness
  const disabled =
    !connected || busy || !settings || loadedScope !== `${scope}:${repository?.id ?? ''}`
  const origins = taskDefaultOrigins(snapshot?.defaults, repository, scope, draft)
  const source = (key: keyof ProjectTaskDefaults) => {
    const origin = origins.find((entry) => entry.key === key)
    return (
      origin && (
        <SettingSource
          origin={origin}
          setting={{ field: { group: 'taskDefaults', key }, repository, scope, value: draft[key] }}
          label={origin.label}
          disabled={disabled}
          onReset={() => change({ ...draft, [key]: undefined })}
        />
      )
    )
  }
  const projectServers = runtimes.filter((entry) =>
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
    JSON.stringify({ taskDefaults: draft, prompts }) !==
      JSON.stringify({
        taskDefaults: settings.value.taskDefaults ?? {},
        prompts: settings.value.prompts ?? [],
      })
  useSettingsDraft(dirty, busy)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => onSavingChange?.(busy), [busy, onSavingChange])
  function change(value: ProjectTaskDefaults) {
    setDraft(value)
    setSaved(false)
    if (value.setupCommand === undefined) setShowSetupCommand(false)
  }
  function changePrompts(value: SavedPrompt[]) {
    setPrompts(value)
    setSaved(false)
  }
  async function save() {
    if (!settings || disabled) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const value = decode(projectTaskDefaultsSchema, draft)
      const latest = await request(
        '/api/agents/settings/read',
        { scope, repositoryId: repository?.id },
        scopedSettingsResultSchema,
      )
      const edited = (value: ScopedSettingsValue) =>
        JSON.stringify({ taskDefaults: value.taskDefaults, prompts: value.prompts })
      if (edited(latest.value) !== edited(settings.value))
        throw new Error('Task defaults changed on another device. Reload before saving.')
      const result = await request(
        '/api/agents/settings/save',
        {
          scope,
          repositoryId: repository?.id,
          projectKey: settings.projectKey,
          before: latest.value,
          after: {
            ...latest.value,
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
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-6">
      {!selectedScope && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Settings scope</p>
          <ChoicePicker
            aria-label="Settings scope"
            value={scope}
            disabled={busy}
            onValueChange={(value) => {
              if (!dirty || window.confirm('Discard unsaved settings changes?'))
                setScope(settingsScopes.find((entry) => entry === value) ?? 'environment')
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
        </div>
      )}
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <SettingsGroup
          title="New tasks"
          description="Choose the agent and access for new tasks. Existing conversations keep their launch settings."
        >
          {repository && scope === 'project' && (
            <SettingRow
              label="Default server"
              description="Use this server when choosing the project. If it is offline, use another online copy. You can change servers in the composer."
              source={source('defaultServerId')}
            >
              <ChoicePicker
                aria-label="Default server"
                value={draft.defaultServerId ?? ''}
                onValueChange={(value) => change({ ...draft, defaultServerId: value || undefined })}
              >
                <option value="">Automatic · prefer current server</option>
                {draft.defaultServerId &&
                  !projectServers.some((entry) => entry.profile.id === draft.defaultServerId) && (
                    <option value={draft.defaultServerId}>Unavailable server</option>
                  )}
                {projectServers.map((entry) => (
                  <option key={entry.profile.id} value={entry.profile.id}>
                    {runtimeComputerName(entry)}
                    {entry.connected ? '' : ' · Offline'}
                  </option>
                ))}
              </ChoicePicker>
            </SettingRow>
          )}
          <SettingRow
            label="Agent configuration"
            description={`${providerDisplayName((harness ?? inheritedHarness).provider)} · ${modelDisplayName((harness ?? inheritedHarness).model) || 'Provider default model'}`}
            source={source('harness')}
          >
            <ChoicePicker
              aria-label="Agent configuration"
              value={harness ? 'custom' : 'inherit'}
              onValueChange={(value) => {
                const agent = configurations.find(
                  (entry) => `agent:${entry.agent.id}` === value,
                )?.agent
                change({
                  ...draft,
                  ...(agent ? { permission: agent.permission } : {}),
                  harness:
                    value === 'inherit'
                      ? undefined
                      : agent
                        ? decode(taskHarnessSchema.mapFields(Struct.omit(['resources'])), agent)
                        : inheritedHarness,
                })
              }}
            >
              <option value="inherit">
                Inherit ({providerDisplayName(inheritedHarness.provider)})
              </option>
              {harness && (
                <option value="custom">Custom · {providerDisplayName(harness.provider)}</option>
              )}
              {!harness && <option value="custom">Customize inherited agent</option>}
              {configurations.map(({ agent }) => (
                <option key={agent.id} value={`agent:${agent.id}`}>
                  Use {agent.name}
                </option>
              ))}
            </ChoicePicker>
          </SettingRow>
          <SettingRow
            label="Default permissions"
            description="Access for new tasks, whichever agent you choose."
            source={source('permission')}
          >
            <ChoicePicker
              aria-label="Default permissions"
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
                Inherit ({accessLabel(inherited.permission ?? 'full-access')})
              </option>
              {selectableAccessModes(draft.permission).map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.name}
                </option>
              ))}
            </ChoicePicker>
          </SettingRow>
        </SettingsGroup>
        {harness && (
          <SettingsGroup
            title="Custom agent defaults"
            description="The provider, model and instructions are overridden together at this level."
          >
            <SettingRow label="Provider">
              <ChoicePicker
                aria-label="Harness"
                value={harness.provider}
                onValueChange={(value) =>
                  change({ ...draft, harness: defaultTaskHarness(decode(providerSchema, value)) })
                }
              >
                {providerSchema.literals.map((provider) => (
                  <option key={provider} value={provider}>
                    {providerDisplayName(provider)}
                  </option>
                ))}
              </ChoicePicker>
            </SettingRow>
            <div className="p-4">
              <ModelSettings
                layout="settings"
                agent={{ ...harness, id: 'defaults', name: 'Task defaults' }}
                connected={connected}
                loadModels={loadModels}
                onChange={(agent) =>
                  change({
                    ...draft,
                    harness: decode(taskHarnessSchema.mapFields(Struct.omit(['resources'])), agent),
                  })
                }
              />
            </div>
            <div className="space-y-2 p-4">
              <label htmlFor="default-agent-instructions" className="text-xs font-medium">
                Instructions
              </label>
              <Textarea
                id="default-agent-instructions"
                aria-label="Instructions"
                value={harness.instructions}
                placeholder="Additional instructions for new tasks…"
                onChange={(event) =>
                  change({ ...draft, harness: { ...harness, instructions: event.target.value } })
                }
              />
            </div>
            {harness.provider !== 'cursor' && (
              <details className="p-4">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Connection override
                </summary>
                <div className="mt-3 space-y-2">
                  <label className="text-xs" htmlFor="default-agent-connection">
                    {harness.provider === 'opencode' ? 'Server URL' : 'Executable (optional)'}
                  </label>
                  <Input
                    id="default-agent-connection"
                    aria-label={
                      harness.provider === 'opencode' ? 'Server URL' : 'Executable (optional)'
                    }
                    value={agentConnectionValue({ ...harness, id: 'defaults', name: 'Defaults' })}
                    placeholder="Use the provider’s normal installation"
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
                </div>
              </details>
            )}
          </SettingsGroup>
        )}
        {!repository?.kind && (
          <SettingsGroup
            title="Workspace & setup"
            description="How a new task checks out your code and prepares its workspace."
          >
            <SettingRow
              label="Working directory"
              description="Use your checkout or give each task an isolated worktree."
              source={source('execution')}
            >
              <ChoicePicker
                aria-label="Working directory"
                value={draft.execution ?? 'inherit'}
                onValueChange={(value) =>
                  change({
                    ...draft,
                    execution: value === 'inherit' ? undefined : decode(executionSchema, value),
                  })
                }
              >
                <option value="inherit">
                  Inherit ({inherited.execution === 'worktree' ? 'Worktree' : 'Local checkout'})
                </option>
                <option value="main">Local checkout</option>
                <option value="worktree">New worktree</option>
              </ChoicePicker>
            </SettingRow>
            <SettingRow
              label="Start from origin"
              description="Fetch the matching origin branch before creating a worktree. Falls back to origin’s default branch."
              source={source('worktreeFromOrigin')}
            >
              <Toggle
                label="Start from origin"
                checked={draft.worktreeFromOrigin ?? inherited.worktreeFromOrigin ?? false}
                onChange={(worktreeFromOrigin) => change({ ...draft, worktreeFromOrigin })}
              />
            </SettingRow>
            <SettingRow
              label="Submodules"
              description="Choose which submodules to initialize before setup."
              source={source('submodules')}
            >
              <ChoicePicker
                aria-label="Submodules"
                disabled={!snapshot?.taskBehaviorSupported}
                value={draft.submodules ?? 'inherit'}
                onValueChange={(value) =>
                  change({
                    ...draft,
                    submodules:
                      value === 'none' || value === 'direct' || value === 'recursive'
                        ? value
                        : undefined,
                  })
                }
              >
                <option value="inherit">Inherit ({inherited.submodules ?? 'none'})</option>
                <option value="none">None</option>
                <option value="direct">Direct</option>
                <option value="recursive">Recursive</option>
              </ChoicePicker>
            </SettingRow>
            <SettingRow
              label="Worktree setup"
              description={
                draft.setupCommand === ''
                  ? 'Setup is disabled at this level.'
                  : (draft.setupCommand ?? inherited.setupCommand) || 'No setup command.'
              }
              source={source('setupCommand')}
            >
              <ChoicePicker
                aria-label="Worktree setup"
                value={
                  draft.setupCommand === undefined
                    ? 'inherit'
                    : showSetupCommand
                      ? 'custom'
                      : 'disabled'
                }
                onValueChange={(value) => {
                  setShowSetupCommand(value === 'custom')
                  change({
                    ...draft,
                    setupCommand:
                      value === 'inherit'
                        ? undefined
                        : value === 'disabled'
                          ? ''
                          : inherited.setupCommand || '',
                  })
                }}
              >
                <option value="inherit">
                  Inherit{inherited.setupCommand ? ' command' : ' (no setup)'}
                </option>
                <option value="custom">Custom command</option>
                <option value="disabled">Disable setup</option>
              </ChoicePicker>
            </SettingRow>
            {draft.setupCommand !== undefined && showSetupCommand && (
              <div className="space-y-2 p-4">
                <label className="text-xs font-medium" htmlFor="task-setup-command">
                  Setup command
                </label>
                <Textarea
                  id="task-setup-command"
                  aria-label="Setup command"
                  value={draft.setupCommand}
                  placeholder="pnpm install --frozen-lockfile"
                  onChange={(event) => change({ ...draft, setupCommand: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Runs in each new worktree before the agent starts. Leave empty to disable setup.
                  Five-minute limit; failures stop startup.
                </p>
              </div>
            )}
          </SettingsGroup>
        )}
        <SettingsGroup
          title="Saved prompts"
          description="Type #name in the composer to reuse a prompt. A matching name overrides an earlier level."
        >
          <div className="space-y-3 p-4">
            {(settings?.inherited.prompts ?? [])
              .filter(
                (prompt) =>
                  !prompts.some((entry) => entry.name.toLowerCase() === prompt.name.toLowerCase()),
              )
              .map((prompt) => (
                <div
                  key={prompt.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium">#{prompt.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{prompt.text}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Inherited prompt</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={prompts.length >= 40}
                    onClick={() => changePrompts([...prompts, prompt])}
                  >
                    Override inherited #{prompt.name}
                  </Button>
                </div>
              ))}
            {prompts.map((prompt, index) => (
              <div key={prompt.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-primary">
                    Set here · {settingsScopeLabels[scope]}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => changePrompts(prompts.filter((_, i) => i !== index))}
                  >
                    Remove prompt override
                  </Button>
                </div>
                <Input
                  aria-label="Prompt name"
                  placeholder="Prompt name, e.g. review"
                  value={prompt.name}
                  onChange={(event) =>
                    changePrompts(
                      prompts.map((entry, i) =>
                        i === index ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Textarea
                  aria-label="Prompt text"
                  placeholder="What should the agent do?"
                  value={prompt.text}
                  onChange={(event) =>
                    changePrompts(
                      prompts.map((entry, i) =>
                        i === index ? { ...entry, text: event.target.value } : entry,
                      ),
                    )
                  }
                />
              </div>
            ))}
            {!prompts.length && !settings?.inherited.prompts?.length && (
              <p className="text-xs text-muted-foreground">
                Save a review checklist, test instructions or another prompt you use often.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={prompts.length >= 40}
              onClick={() => changePrompts([...prompts, { id: randomUUID(), name: '', text: '' }])}
            >
              Add prompt
            </Button>
          </div>
        </SettingsGroup>
        <div
          className={`z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur ${dirty ? 'sticky -bottom-6' : ''}`}
        >
          <p role="status" className="text-xs text-muted-foreground">
            {saved
              ? 'Defaults saved for new tasks.'
              : dirty
                ? `Unsaved changes · ${settingsScopeLabels[scope]}`
                : 'Changes apply to new tasks'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => change({})}>
              Reset task defaults to inherited settings
            </Button>
            <Button onClick={() => void save()}>{busy ? 'Saving…' : 'Save defaults'}</Button>
          </div>
        </div>
      </fieldset>
      {!connected && (
        <p role="status" className="text-xs text-muted-foreground">
          Connect to this computer to edit settings.
        </p>
      )}
      {connected && !settings && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading defaults…
        </p>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
          {error}
          <Button variant="ghost" onClick={() => setRetry(retry + 1)}>
            Reload settings
          </Button>
        </div>
      )}
    </section>
  )
}
