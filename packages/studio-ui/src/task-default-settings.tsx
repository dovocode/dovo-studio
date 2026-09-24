import { useCallback, useEffect } from 'react'
import { Schema } from 'effect'
import { useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  executionSchema,
  accessModes,
  agentSchema,
  decode,
  defaultTaskHarness,
  modelCatalogSchema,
  projectTaskDefaultsSchema,
  providerSchema,
  runtimeSetupSchema,
  runtimeDefaultsSchema,
  supportsAccess,
  taskHarnessSchema,
  type AgentDiscovery,
  type ProjectTaskDefaults,
  type Repository,
  type RuntimeSetup,
} from '@dovo/protocol'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { FormField } from './components/form-field'
import { ChoicePicker } from './choice-picker'
import { ModelSettings } from './model-settings'

export function TaskDefaultSettings(props: { repository?: Repository }) {
  const [open, setOpen] = useApplicationState(false)
  return (
    <div className="space-y-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide task defaults' : 'Task defaults'}
      </Button>
      {open && <TaskDefaultSettingsForm {...props} />}
    </div>
  )
}
function TaskDefaultSettingsForm({ repository }: { repository?: Repository }) {
  const { connected, request } = useWorkspace()
  const [setup, setSetup] = useApplicationState<RuntimeSetup | null>(null)
  const [draft, setDraft] = useApplicationState<ProjectTaskDefaults>({})
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    let active = true
    setSetup(null)
    if (!connected) return
    void request('/api/agents/setup/read', {}, runtimeSetupSchema)
      .then((value) => {
        if (!active) return
        setSetup(value)
        setDraft(repository?.taskDefaults ?? (repository ? {} : value.defaults))
      })
      .catch((error: unknown) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [connected, request, repository?.id, retry])
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
          {repository
            ? 'Project overrides. Unset values inherit this runtime’s defaults.'
            : 'Defaults for new tasks on this runtime. Projects can override them.'}{' '}
          Existing tasks keep their settings.
        </p>
      </div>
      <fieldset disabled={!connected || busy || !setup} className="grid gap-3">
        {repository && (
          <FormField label="Agent configuration">
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
              <option value="inherit">
                Use runtime default ({setup?.defaults.harness.provider})
              </option>
              <option value="custom">Project override</option>
            </ChoicePicker>
          </FormField>
        )}
        {harness && (
          <>
            <FormField label="Harness">
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
            <FormField label="Access">
              <ChoicePicker
                value={harness.permission}
                onValueChange={(value) =>
                  change({
                    ...draft,
                    harness: {
                      ...harness,
                      permission: decode(agentSchema.fields.permission, value),
                    },
                  })
                }
              >
                {accessModes.map((mode) => (
                  <option
                    key={mode.id}
                    value={mode.id}
                    disabled={!supportsAccess(harness.provider, mode.id)}
                  >
                    {mode.name}
                  </option>
                ))}
              </ChoicePicker>
            </FormField>
            <FormField label="Instructions">
              <Textarea
                value={harness.instructions}
                onChange={(event) =>
                  change({ ...draft, harness: { ...harness, instructions: event.target.value } })
                }
              />
            </FormField>
            <FormField
              label={harness.provider === 'opencode' ? 'Server URL' : 'Executable (optional)'}
            >
              <Input
                value={harness.endpoint}
                onChange={(event) =>
                  change({ ...draft, harness: { ...harness, endpoint: event.target.value } })
                }
              />
            </FormField>
          </>
        )}
        <FormField label="Working directory">
          <ChoicePicker
            value={draft.execution ?? (repository ? 'inherit' : 'main')}
            onValueChange={(value) =>
              change({
                ...draft,
                execution: value === 'inherit' ? undefined : decode(executionSchema, value),
              })
            }
          >
            {repository && (
              <option value="inherit">
                Use runtime default (
                {setup?.defaults.execution === 'worktree' ? 'Worktree' : 'Local checkout'})
              </option>
            )}
            <option value="main">Local checkout</option>
            <option value="worktree">New worktree</option>
          </ChoicePicker>
        </FormField>
        <FormField label="Worktree base branch">
          <Input
            value={draft.worktreeBaseBranch ?? ''}
            placeholder={
              repository
                ? `Use runtime default (${setup?.defaults.worktreeBaseBranch ?? 'origin/main → origin/master'})`
                : 'Automatic: origin/main → origin/master'
            }
            onChange={(event) =>
              change({ ...draft, worktreeBaseBranch: event.target.value || undefined })
            }
          />
        </FormField>
        {repository && (
          <FormField label="Worktree setup">
            <ChoicePicker
              value={draft.setupCommand === undefined ? 'inherit' : 'custom'}
              onValueChange={(value) =>
                change({ ...draft, setupCommand: value === 'inherit' ? undefined : '' })
              }
            >
              <option value="inherit">Use runtime default</option>
              <option value="custom">Project override (empty disables setup)</option>
            </ChoicePicker>
          </FormField>
        )}
        {(!repository || draft.setupCommand !== undefined) && (
          <FormField label="Setup command">
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
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (!setup) return
              setBusy(true)
              setError('')
              setSaved(false)
              const save = Promise.resolve().then(async () => {
                const value = decode(projectTaskDefaultsSchema, draft)
                await (repository
                  ? request(
                      '/api/workspace',
                      {
                        collection: 'repositories',
                        id: repository.id,
                        changes: {
                          taskDefaults: { before: repository.taskDefaults ?? null, after: value },
                        },
                      },
                      Schema.Struct({ revision: Schema.Number }),
                      'PATCH',
                    )
                  : request(
                      '/api/agents/defaults/save',
                      {
                        before: setup.defaults,
                        after: {
                          ...value,
                          harness: value.harness ?? setup.defaults.harness,
                          configured: true,
                        },
                      },
                      runtimeDefaultsSchema,
                    ).then((defaults) => setSetup({ ...setup, defaults })))
              })
              void save
                .then(() => setSaved(true))
                .catch((error: unknown) => setError(String(error)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Saving…' : 'Save defaults'}
          </Button>
          {repository && (
            <Button variant="ghost" onClick={() => change({})}>
              Reset to runtime defaults
            </Button>
          )}
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
