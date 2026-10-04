import { changeAgentProvider, changeAgentConnection, agentConnectionValue } from '@dovo/protocol'
import { parseAgentEnvironment, formatAgentEnvironment } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { decodeResult, decode } from '@dovo/protocol'
import { selectableAccessModes, supportsAccess } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { useEffect, useRef, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { agentSchema, providers, useWorkspace, type Agent } from '@dovo/studio-core'
import {
  Button,
  AgentAvatar,
  agentIconChoices,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Textarea,
} from '@dovo/studio-ui'
export function AgentEditor({
  initial,
  creating,
  computerName,
  onClose,
  onSave,
  inline = false,
  onDirtyChange,
}: {
  initial: Agent
  inline?: boolean
  onDirtyChange?: (dirty: boolean) => void
  creating: boolean
  computerName: string
  onClose: () => void
  onSave: (agent: Agent) => Promise<void>
}) {
  const { connected } = useWorkspace()
  const pending = useRef(false)
  const [busy, setBusy] = useApplicationState(false)
  const [agent, setAgent] = useApplicationState(initial)
  const [error, setError] = useApplicationState('')
  const [step, setStep] = useApplicationState(creating ? 0 : 2)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(initial.env))
  useEffect(() => {
    onDirtyChange?.(
      JSON.stringify(agent) !== JSON.stringify(initial) ||
        environment !== formatAgentEnvironment(initial.env),
    )
  }, [agent, initial, environment, onDirtyChange])
  const availableProviders = Object.entries(providers)
  return (
    <EditorShell
      inline={inline}
      busy={busy}
      creating={creating}
      computerName={computerName}
      onClose={onClose}
    >
      {creating && (
        <ol
          aria-label="Setup progress"
          className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-2"
        >
          {['Provider', 'Identity', 'Config'].map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${step === index ? 'border bg-background text-foreground' : 'text-muted-foreground'}`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full border text-xs ${step >= index ? 'border-primary text-primary' : ''}`}
              >
                {step > index ? <Check size={14} /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (creating && step < 2) {
            if (step === 1 && !agent.name.trim()) {
              setError('Enter an agent name.')
              return
            }
            setError('')
            setStep(step + 1)
            return
          }
          let env: Record<string, string>
          try {
            env = parseAgentEnvironment(environment)
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error))
            return
          }
          const result = decodeResult(agentSchema, {
            ...agent,
            env,
            name: agent.name.trim(),
          })
          if (!result.success) {
            setError('Enter an agent name.')
            return
          }
          if (pending.current || !connected) return
          pending.current = true
          setBusy(true)
          setError('')
          void onSave(result.data)
            .then(() => {
              setAgent(result.data)
              setEnvironment(formatAgentEnvironment(result.data.env))
              onClose()
            })
            .catch((error: unknown) =>
              setError(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => {
              pending.current = false
              setBusy(false)
            })
        }}
      >
        <fieldset disabled={busy || !connected} className="grid gap-4">
          {(step === 0 || !creating) && (
            <section className="grid gap-4 rounded-xl border p-4">
              <h3 className="text-sm font-medium">Provider</h3>
              {!creating && (
                <FormField layout="settings" label="Provider">
                  <ChoicePicker
                    aria-label="Provider"
                    className="h-9 rounded-md border bg-background px-2 text-xs"
                    value={agent.provider}
                    onValueChange={(selection) => {
                      if (!availableProviders.some(([id]) => id === selection)) return
                      setAgent(
                        changeAgentProvider(agent, decode(agentSchema.fields.provider, selection)),
                      )
                    }}
                  >
                    {availableProviders.map(([id, p]) => (
                      <option
                        key={id}
                        value={id}
                        disabled={!availableProviders.some(([available]) => available === id)}
                      >
                        {p.name}
                      </option>
                    ))}
                  </ChoicePicker>
                </FormField>
              )}
              {creating && (
                <div className="grid grid-cols-2 gap-2">
                  {availableProviders.map(([id, provider]) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      className={`h-auto justify-start gap-3 p-4 ${agent.provider === id ? 'border-primary bg-primary/10 ring-1 ring-primary' : ''}`}
                      aria-pressed={agent.provider === id}
                      onClick={() =>
                        setAgent(
                          changeAgentProvider(agent, decode(agentSchema.fields.provider, id)),
                        )
                      }
                    >
                      <AgentAvatar
                        provider={decode(agentSchema.fields.provider, id)}
                        className="size-5"
                      />
                      {provider.short ?? provider.name}
                      {agent.provider === id && <Check size={14} className="ml-auto" />}
                    </Button>
                  ))}
                </div>
              )}
              {creating && (
                <div className="grid gap-3 border-t pt-4">
                  <p className="text-center text-xs text-muted-foreground">
                    Or choose from the ACP registry
                  </p>
                  <AcpRegistry agent={changeAgentProvider(agent, 'acp')} onChange={setAgent} />
                </div>
              )}
            </section>
          )}
          {(step === 1 || !creating) && (
            <section className="grid gap-4 rounded-xl border p-4">
              <h3 className="text-sm font-medium">Identity</h3>
              <FormField layout="settings" label="Name">
                <Input
                  required
                  value={agent.name}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      name: e.target.value,
                    })
                  }
                />
              </FormField>
              <FormField layout="settings" label="Icon">
                <div className="flex items-center gap-3">
                  <AgentAvatar
                    provider={agent.provider}
                    customIcon={agent.icon ?? 'bot'}
                    className="size-7"
                  />
                  <div role="group" aria-label="Agent icon" className="flex flex-wrap gap-1">
                    {Object.entries(agentIconChoices).map(([id, { label, icon: Icon }]) => (
                      <label key={id} title={label} className="cursor-pointer">
                        <input
                          type="radio"
                          name="agent-icon"
                          value={id}
                          aria-label={label}
                          checked={(agent.icon ?? 'bot') === id}
                          onChange={() =>
                            setAgent({
                              ...agent,
                              icon: decode(agentSchema.fields.icon.from, id),
                            })
                          }
                          className="peer sr-only"
                        />
                        <span className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground peer-checked:border-border peer-checked:bg-accent peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:bg-muted">
                          <Icon size={15} />
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </FormField>
            </section>
          )}
          {step === 2 && (
            <>
              <section className="grid gap-4 rounded-xl border p-4">
                <h3 className="text-sm font-medium">Runtime & access</h3>
                {agent.provider === 'acp' && (
                  <AcpRegistry agent={agent} onChange={setAgent} showRegistry={false} />
                )}
                <FormField layout="settings" label="Access">
                  <ChoicePicker
                    aria-label="Permissions"
                    className="h-9 rounded-md border bg-background px-2 text-xs"
                    value={agent.permission}
                    onValueChange={(selection) =>
                      setAgent({
                        ...agent,
                        permission: decode(agentSchema.fields.permission, selection),
                      })
                    }
                  >
                    {selectableAccessModes(agent.permission, agent.provider).map((mode) => (
                      <option
                        key={mode.id}
                        value={mode.id}
                        disabled={!supportsAccess(agent.provider, mode.id)}
                      >
                        {mode.name}
                        {supportsAccess(agent.provider, mode.id) ? '' : ' · Not supported'}
                      </option>
                    ))}
                  </ChoicePicker>
                </FormField>
                <p className="text-xs text-muted-foreground">
                  {
                    selectableAccessModes(agent.permission, agent.provider).find(
                      (mode) => mode.id === agent.permission,
                    )?.description
                  }
                </p>
                {!supportsAccess(agent.provider, agent.permission) && (
                  <p role="alert" className="text-xs text-destructive">
                    Choose an access mode supported by this provider.
                  </p>
                )}

                {agent.provider === 'hermes' && (
                  <p className="text-xs text-muted-foreground">
                    Uses Hermes installed on this computer, including its memory and skills.
                    Configure its provider with <code>hermes model</code>. Select its{' '}
                    <code>hermes</code> executable; Dovo launches the native Hermes gateway using
                    that installation's environment.
                  </p>
                )}
                {agent.provider !== 'cursor' && (
                  <FormField
                    layout="settings"
                    label={agent.provider === 'opencode' ? 'Server URL' : 'Connection / executable'}
                  >
                    <Input
                      value={agentConnectionValue(agent)}
                      onChange={(e) => setAgent(changeAgentConnection(agent, e.target.value))}
                      placeholder={
                        agent.provider === 'opencode'
                          ? 'Automatic local OpenCode server'
                          : 'Managed by runtime'
                      }
                    />
                  </FormField>
                )}
                {agent.provider === 'opencode' && !agent.endpoint.trim() && (
                  <FormField layout="settings" label="OpenCode executable path (optional)">
                    <Input
                      value={agent.executablePath ?? ''}
                      placeholder="opencode"
                      onChange={(event) =>
                        setAgent({ ...agent, executablePath: event.target.value })
                      }
                    />
                  </FormField>
                )}
                {(agent.provider === 'codex' ||
                  agent.provider === 'claude' ||
                  agent.provider === 'hermes' ||
                  agent.provider === 'copilot') && (
                  <FormField
                    layout="settings"
                    label={
                      agent.provider === 'hermes'
                        ? 'HERMES_HOME directory'
                        : agent.provider === 'copilot'
                          ? 'COPILOT_HOME directory'
                          : agent.provider === 'codex'
                            ? 'CODEX_HOME directory'
                            : 'CLAUDE_CONFIG_DIR directory'
                    }
                  >
                    <Input
                      value={agent.configDirectory ?? ''}
                      onChange={(event) =>
                        setAgent({ ...agent, configDirectory: event.target.value })
                      }
                      placeholder="Provider default"
                    />
                  </FormField>
                )}
                {agent.provider !== 'cursor' &&
                  (agent.provider !== 'opencode' || !agent.endpoint.trim()) && (
                    <FormField layout="settings" label="Executable arguments (one per line)">
                      <Textarea
                        value={(agent.args ?? []).join('\n')}
                        onChange={(event) =>
                          setAgent({
                            ...agent,
                            args: event.target.value.split('\n').filter(Boolean),
                          })
                        }
                        placeholder={agent.provider === 'claude' ? '--flag=value' : '--flag\nvalue'}
                      />
                    </FormField>
                  )}
                {agent.provider === 'cursor' && (
                  <p className="text-xs text-muted-foreground">
                    Runs locally through the Cursor SDK. Set CURSOR_API_KEY on this runtime or use
                    Cursor SDK browser login. Cursor desktop login is separate.
                  </p>
                )}
              </section>
              <section className="grid gap-4 rounded-xl border p-4">
                <h3 className="text-sm font-medium">Environment</h3>
                <FormField
                  layout="settings"
                  label="Environment variables (NAME=value, one per line)"
                >
                  <Textarea
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Saved as readable configuration. Keep secrets in the server's environment.
                  </p>
                </FormField>
              </section>
              <section className="grid gap-4 rounded-xl border p-4">
                <h3 className="text-sm font-medium">Models</h3>
                <ModelSettings key={agent.provider} agent={agent} onChange={setAgent} />
              </section>
              <section className="grid gap-4 rounded-xl border p-4">
                <h3 className="text-sm font-medium">Instructions</h3>
                <FormField layout="settings" label="Instructions">
                  <Textarea
                    value={agent.instructions}
                    onChange={(e) =>
                      setAgent({
                        ...agent,
                        instructions: e.target.value,
                      })
                    }
                    className="min-h-24"
                  />
                </FormField>
              </section>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            {creating && step > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError('')
                  setStep(step - 1)
                }}
              >
                Back
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                busy ||
                !connected ||
                (step === 2 && !supportsAccess(agent.provider, agent.permission))
              }
            >
              {busy
                ? 'Saving…'
                : creating && step < 2
                  ? 'Next'
                  : creating
                    ? 'Add configuration'
                    : 'Save configuration'}
            </Button>
          </div>
        </fieldset>
      </form>
    </EditorShell>
  )
}

function EditorShell({
  inline,
  busy,
  creating,
  computerName,
  onClose,
  children,
}: {
  inline: boolean
  busy: boolean
  creating: boolean
  computerName: string
  onClose: () => void
  children: ReactNode
}) {
  if (inline) return <div className="min-w-0">{children}</div>
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>
            {creating ? 'Add provider configuration' : 'Edit agent configuration'}
          </DialogTitle>
          <DialogDescription>{computerName} · Reusable settings for this target.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
