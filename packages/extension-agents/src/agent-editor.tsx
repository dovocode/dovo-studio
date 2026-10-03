import { changeAgentProvider, changeAgentConnection, agentConnectionValue } from '@dovo/protocol'
import { parseAgentEnvironment, formatAgentEnvironment } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { decodeResult, decode } from '@dovo/protocol'
import { selectableAccessModes, supportsAccess } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { useRef } from 'react'
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
}: {
  initial: Agent
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
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(initial.env))
  const availableProviders = Object.entries(providers)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{creating ? 'New' : 'Edit'} agent configuration</DialogTitle>
          <DialogDescription>
            {computerName} · Reusable settings. Provider sessions remain attached to tasks.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
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
              .then(onClose)
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
                {selectableAccessModes(agent.permission).map((mode) => (
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
                selectableAccessModes(agent.permission).find((mode) => mode.id === agent.permission)
                  ?.description
              }
            </p>
            {!supportsAccess(agent.provider, agent.permission) && (
              <p role="alert" className="text-xs text-destructive">
                Choose an access mode supported by this provider.
              </p>
            )}
            <ModelSettings key={agent.provider} agent={agent} onChange={setAgent} />
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
            {agent.provider === 'opencode' && !agent.endpoint.trim() && (
              <FormField layout="settings" label="OpenCode executable path (optional)">
                <Input
                  value={agent.executablePath ?? ''}
                  placeholder="opencode"
                  onChange={(event) => setAgent({ ...agent, executablePath: event.target.value })}
                />
              </FormField>
            )}
            {(agent.provider === 'codex' || agent.provider === 'claude') && (
              <FormField
                layout="settings"
                label={
                  agent.provider === 'codex'
                    ? 'CODEX_HOME directory'
                    : 'CLAUDE_CONFIG_DIR directory'
                }
              >
                <Input
                  value={agent.configDirectory ?? ''}
                  onChange={(event) => setAgent({ ...agent, configDirectory: event.target.value })}
                  placeholder="Provider default"
                />
              </FormField>
            )}
            {(agent.provider !== 'opencode' || !agent.endpoint.trim()) && (
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
            <FormField layout="settings" label="Environment variables (NAME=value, one per line)">
              <Textarea
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Saved as readable configuration. Keep secrets in the server's environment.
              </p>
            </FormField>
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
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || !connected || !supportsAccess(agent.provider, agent.permission)}
            >
              {busy ? 'Saving…' : 'Save configuration'}
            </Button>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
