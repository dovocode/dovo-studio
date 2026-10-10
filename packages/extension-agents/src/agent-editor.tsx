import { Schema } from 'effect'
import { useEffect, useRef, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import {
  agentConnectionValue,
  changeAgentConnection,
  changeAgentProvider,
  decode,
  decodeResult,
  formatAgentEnvironment,
  parseAgentEnvironment,
  providerDisplayName,
} from '@dovo/protocol'
import {
  agentSchema,
  providers,
  selectableAccessModes,
  supportsAccess,
  useWorkspace,
  useSettingsDraft,
  type Agent,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  AgentAvatar,
  agentIconChoices,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@dovo/studio-ui'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'

export function AgentEditor({
  initial,
  creating,
  computerName,
  onClose,
  onSave,
  inline = false,
  onDirtyChange,
  fixedProvider = false,
}: {
  initial: Agent
  creating: boolean
  computerName: string
  onClose: () => void
  onSave: (agent: Agent) => Promise<void>
  inline?: boolean
  onDirtyChange?: (dirty: boolean) => void
  fixedProvider?: boolean
}) {
  const { connected } = useWorkspace()
  const pending = useRef(false)
  const [busy, setBusy] = useApplicationState(false)
  const [agent, setAgent] = useApplicationState(initial)
  const [error, setError] = useApplicationState('')
  const [step, setStep] = useApplicationState(creating ? 0 : 2)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(initial.env))
  const dirty =
    JSON.stringify(agent) !== JSON.stringify(initial) ||
    environment !== formatAgentEnvironment(initial.env)
  useSettingsDraft(dirty, busy)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  const availableProviders = Object.keys(providers).map((id) =>
    decode(agentSchema.fields.provider, id),
  )
  const accessModes = selectableAccessModes(agent.permission, agent.provider)
  const discard = () => {
    setAgent(initial)
    setEnvironment(formatAgentEnvironment(initial.env))
    setError('')
  }
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
          {['Provider', 'Profile', 'Model & behavior'].map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs ${step === index ? 'bg-background text-foreground' : 'text-muted-foreground'}`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${step >= index ? 'border-primary text-primary' : ''}`}
              >
                {step > index ? <Check className="size-3" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
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
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
            return
          }
          const result = decodeResult(agentSchema, { ...agent, env, name: agent.name.trim() })
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
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => {
              pending.current = false
              setBusy(false)
            })
        }}
      >
        <fieldset disabled={busy || !connected} className="min-w-0 space-y-5">
          {creating && step === 0 && (
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Choose a provider</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start with your provider’s normal installation and login.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {availableProviders
                  .filter((id) => id !== 'acp')
                  .map((id) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      className={`h-auto justify-start gap-3 whitespace-normal p-4 text-left ${agent.provider === id ? 'border-primary/50 bg-primary/8' : ''}`}
                      aria-pressed={agent.provider === id}
                      onClick={() => setAgent(changeAgentProvider(agent, id))}
                    >
                      <AgentAvatar provider={id} className="size-5" />
                      <span>{providerDisplayName(id)}</span>
                      {agent.provider === id && <Check className="ml-auto size-3.5" />}
                    </Button>
                  ))}
              </div>
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-xs font-medium">
                  More agents from the ACP registry
                </summary>
                <div className="mt-3">
                  <AcpRegistry agent={changeAgentProvider(agent, 'acp')} onChange={setAgent} />
                </div>
              </details>
            </section>
          )}
          {(step === 1 || !creating) && (
            <section className="space-y-4">
              {!creating && <h3 className="text-sm font-semibold">Profile</h3>}
              <FormField layout="settings" label="Name">
                <Input
                  aria-label="Name"
                  required
                  value={agent.name}
                  placeholder="Give this profile a name"
                  onChange={(event) => setAgent({ ...agent, name: event.target.value })}
                />
              </FormField>
              {!creating && !fixedProvider && (
                <FormField layout="settings" label="Provider">
                  <Select
                    value={agent.provider}
                    onValueChange={(value) =>
                      setAgent(
                        changeAgentProvider(agent, decode(agentSchema.fields.provider, value)),
                      )
                    }
                  >
                    <SelectTrigger aria-label="Provider" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProviders.map((id) => (
                        <SelectItem key={id} value={id}>
                          {providerDisplayName(id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
              <details className="text-xs text-muted-foreground" open={creating ? true : undefined}>
                <summary className="cursor-pointer">Profile icon</summary>
                <div role="group" aria-label="Agent icon" className="mt-3 flex flex-wrap gap-1.5">
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
                            icon: decode(
                              Schema.required(agentSchema.fields.icon.schema.schema),
                              id,
                            ),
                          })
                        }
                        className="peer sr-only"
                      />
                      <span className="flex size-8 items-center justify-center rounded-md border border-transparent peer-checked:border-border peer-checked:bg-accent peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:bg-muted">
                        <Icon size={15} />
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            </section>
          )}
          {step === 2 && (
            <>
              <section className="space-y-4 border-t pt-5">
                <h3 className="text-sm font-semibold">Model & behavior</h3>
                {agent.provider === 'acp' && (
                  <AcpRegistry agent={agent} onChange={setAgent} showRegistry={false} />
                )}
                <ModelSettings agent={agent} onChange={setAgent} />
                <FormField layout="settings" label="Access">
                  <div className="space-y-2">
                    <Select
                      value={agent.permission}
                      onValueChange={(value) =>
                        setAgent({
                          ...agent,
                          permission: decode(agentSchema.fields.permission, value),
                        })
                      }
                    >
                      <SelectTrigger aria-label="Access" className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accessModes.map((mode) => (
                          <SelectItem
                            key={mode.id}
                            value={mode.id}
                            disabled={!supportsAccess(agent.provider, mode.id)}
                          >
                            {mode.name}
                            {supportsAccess(agent.provider, mode.id) ? '' : ' · Not supported'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs font-normal leading-relaxed text-muted-foreground">
                      {accessModes.find((mode) => mode.id === agent.permission)?.description}
                    </p>
                  </div>
                </FormField>
                {!supportsAccess(agent.provider, agent.permission) && (
                  <p role="alert" className="text-xs text-destructive">
                    Choose an access mode supported by this provider.
                  </p>
                )}
                <FormField layout="settings" label="Instructions">
                  <Textarea
                    aria-label="Instructions"
                    value={agent.instructions}
                    placeholder="Optional. Added to every task that uses this profile…"
                    onChange={(event) => setAgent({ ...agent, instructions: event.target.value })}
                  />
                </FormField>
              </section>
              <details className="rounded-lg border bg-card/20 p-4">
                <summary className="cursor-pointer text-xs font-medium">
                  Connection & account
                </summary>
                <div className="mt-4 space-y-4">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Optional. Leave blank to use the provider installed and signed in on the
                    computer that runs the task. Paths refer to that computer.
                  </p>
                  {agent.provider === 'hermes' && (
                    <p className="text-xs text-muted-foreground">
                      Uses Hermes installed on this computer, including its memory and skills.
                      Configure its provider with <code>hermes model</code>.
                    </p>
                  )}
                  {agent.provider === 'cursor' && (
                    <p className="text-xs text-muted-foreground">
                      Use CURSOR_API_KEY on this computer or the Cursor SDK browser login. Cursor
                      desktop login is separate.
                    </p>
                  )}
                  {agent.provider !== 'cursor' && (
                    <FormField
                      layout="settings"
                      label={
                        agent.provider === 'opencode' ? 'Server URL' : 'Connection / executable'
                      }
                    >
                      <Input
                        aria-label={
                          agent.provider === 'opencode' ? 'Server URL' : 'Connection / executable'
                        }
                        value={agentConnectionValue(agent)}
                        placeholder={
                          agent.provider === 'opencode'
                            ? 'Automatic local OpenCode server'
                            : 'Use provider default'
                        }
                        onChange={(event) =>
                          setAgent(changeAgentConnection(agent, event.target.value))
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
                  {(['codex', 'claude', 'hermes', 'copilot'] as const).some(
                    (provider) => provider === agent.provider,
                  ) && (
                    <FormField
                      layout="settings"
                      label={`Config directory (${
                        agent.provider === 'hermes'
                          ? 'HERMES_HOME'
                          : agent.provider === 'copilot'
                            ? 'COPILOT_HOME'
                            : agent.provider === 'codex'
                              ? 'CODEX_HOME'
                              : 'CLAUDE_CONFIG_DIR'
                      })`}
                    >
                      <Input
                        value={agent.configDirectory ?? ''}
                        placeholder="Provider default"
                        onChange={(event) =>
                          setAgent({ ...agent, configDirectory: event.target.value })
                        }
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
                              args: event.target.value.split('\n').filter((line) => line.trim()),
                            })
                          }
                        />
                      </FormField>
                    )}
                  <FormField layout="settings" label="Environment variables">
                    <Textarea
                      aria-label="Environment variables"
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value)}
                      placeholder="EXAMPLE=value"
                    />
                    <p className="font-normal leading-relaxed">
                      One NAME=value per line. Stored as readable settings, so keep secrets in the
                      computer’s own environment.
                    </p>
                  </FormField>
                </div>
              </details>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <span aria-live="polite" className="text-xs text-muted-foreground">
              {!creating &&
                (dirty
                  ? `Unsaved changes · saves at ${computerName}`
                  : `No unsaved changes · ${computerName}`)}
            </span>
            <div className="flex gap-2">
              {!creating && dirty && (
                <Button type="button" variant="ghost" disabled={busy} onClick={discard}>
                  Discard changes
                </Button>
              )}
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>{creating ? 'Add agent profile' : 'Edit agent profile'}</DialogTitle>
          <DialogDescription>
            Saved at {computerName} and inherited by more specific settings levels.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
