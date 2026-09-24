import { useCallback, useEffect } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, providers } from '@dovo/studio-core'
import {
  decode,
  defaultTaskHarness,
  modelCatalogSchema,
  providerSchema,
  resolveTitleHarness,
  runtimeSetupSchema,
  taskHarnessSchema,
  titleSettingsForHarness,
  type Agent,
  type AgentDiscovery,
  type RuntimeSetup,
} from '@dovo/protocol'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  ModelSettings,
  Textarea,
} from '@dovo/studio-ui'
import { AcpRegistry } from './acp-registry'

export function Setup() {
  const { snapshot, connected } = useWorkspace()
  const [open, setOpen] = useApplicationState(false)
  const defaults = snapshot?.defaults
  return (
    <section className="mb-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            {defaults?.configured ? 'Your defaults' : 'Set up your workspace'}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {defaults?.configured
              ? `${providers[defaults.harness.provider].short} · ${defaults.harness.model || 'Provider default model'}`
              : 'Choose your everyday model and a separate model for titles and dictation.'}
          </p>
        </div>
        <Button size="sm" disabled={!connected} onClick={() => setOpen(true)}>
          {defaults?.configured ? 'Edit defaults' : 'Set up defaults'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Shared with devices paired to this computer. Existing tasks keep their settings.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Workspace setup</DialogTitle>
          </DialogHeader>
          {open && <SetupForm onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </section>
  )
}
function SetupForm({ onClose }: { onClose: () => void }) {
  const { workspace, connected, request } = useWorkspace()
  const [settings, setSettings] = useApplicationState<RuntimeSetup | null>(null)
  const [step, setStep] = useApplicationState(0)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    let active = true
    setSettings(null)
    setError('')
    if (!connected) return
    void request('/api/agents/setup/read', {}, runtimeSetupSchema)
      .then((value) => {
        if (active) setSettings(value)
      })
      .catch((error) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [request, connected, retry])
  const loadModels = useCallback(
    (agent: AgentDiscovery) => request('/api/agents/models', agent, modelCatalogSchema),
    [request],
  )
  if (!settings)
    return (
      <div className="space-y-3 text-sm">
        <p role={error ? 'alert' : 'status'}>
          {error ||
            (connected ? 'Loading your settings…' : 'Connect this computer to set up defaults.')}
        </p>
        {error && <Button onClick={() => setRetry((n) => n + 1)}>Try again</Button>}
      </div>
    )
  const titleHarness = resolveTitleHarness(
    settings.titles,
    workspace.agents,
    settings.defaults.configured ? settings.defaults.harness : undefined,
  )
  const agent: Agent =
    step === 0
      ? { ...settings.defaults.harness, id: 'default', name: 'Default agent' }
      : {
          ...(titleHarness ?? defaultTaskHarness('codex')),
          id: 'titles',
          name: 'Titles & dictation',
          model: settings.titles.model,
          reasoning: settings.titles.reasoning,
        }
  const change = (next: Agent) =>
    setSettings(
      step === 0
        ? {
            ...settings,
            defaults: { ...settings.defaults, harness: decode(taskHarnessSchema, next) },
          }
        : { ...settings, titles: titleSettingsForHarness(next) },
    )
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || !connected) return
        if (step === 0) {
          setStep(1)
          return
        }
        setBusy(true)
        setError('')
        void request(
          '/api/agents/setup/save',
          {
            ...settings,
            titles:
              settings.titles.harness || settings.titles.agentId
                ? settings.titles
                : titleSettingsForHarness(agent),
          },
          runtimeSetupSchema,
        )
          .then(onClose)
          .catch((error) => setError(String(error)))
          .finally(() => setBusy(false))
      }}
    >
      <div>
        <p className="text-xs text-primary">Step {step + 1} of 2</p>
        <h3 className="mt-1 text-base font-medium">
          {step === 0 ? 'Your everyday agent' : 'Titles & dictation'}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {step === 0
            ? 'New tasks start with this provider and model. You can change them before sending the first message.'
            : 'Choose a separate model for short titles and dictation cleanup. A small, fast model is usually enough. This setting stays independent of your everyday model.'}
        </p>
      </div>
      <fieldset disabled={busy || !connected} className="space-y-3">
        <FormField label="Provider">
          <ChoicePicker
            aria-label="Setup provider"
            value={agent.provider}
            onValueChange={(provider) =>
              change({
                ...defaultTaskHarness(decode(providerSchema, provider)),
                id: agent.id,
                name: agent.name,
              })
            }
          >
            {providerSchema.literals.map((provider) => (
              <option key={provider} value={provider}>
                {providers[provider].short}
              </option>
            ))}
          </ChoicePicker>
        </FormField>
        {agent.provider === 'acp' && (
          <AcpRegistry key={`${step}:${agent.provider}`} agent={agent} onChange={change} />
        )}
        <ModelSettings
          key={`${step}:${agent.provider}`}
          agent={agent}
          onChange={change}
          loadModels={loadModels}
          connected={connected}
          modes={step === 0}
        />
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Connection options
          </summary>
          <div className="mt-3 space-y-3">
            <FormField label="Executable or server URL">
              <Input
                value={agent.endpoint}
                placeholder="Use runtime default"
                onChange={(event) => change({ ...agent, endpoint: event.target.value })}
              />
            </FormField>
            {agent.provider === 'acp' && (
              <FormField label="Arguments (one per line)">
                <Textarea
                  value={(agent.args ?? []).join('\n')}
                  onChange={(event) =>
                    change({ ...agent, args: event.target.value.split('\n').filter(Boolean) })
                  }
                />
              </FormField>
            )}
          </div>
        </details>
        {step === 1 && (
          <p className="rounded-md border p-3 text-xs leading-5 text-muted-foreground">
            New tasks: {providers[settings.defaults.harness.provider].short} ·{' '}
            {settings.defaults.harness.model || 'Provider default model'}
            <br />
            Titles & dictation: {providers[agent.provider].short} ·{' '}
            {agent.model || 'Provider default model'}
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => (step ? setStep(0) : onClose())}>
            {step ? 'Back' : 'Cancel'}
          </Button>
          <Button type="submit">
            {busy ? 'Saving…' : step ? 'Save setup' : 'Next: title model'}
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
