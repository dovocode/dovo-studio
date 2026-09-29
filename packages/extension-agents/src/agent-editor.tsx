import { useAppPreferences, updateAppPreferences } from '@dovo/studio-core'
import { agentPresetSchema } from '@dovo/protocol'
import { parseAgentEnvironment, formatAgentEnvironment } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { selectableAccessModes, lockedTaskProvider, supportsAccess } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { useRef } from 'react'
import { Schema } from 'effect'
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
  global = false,
}: {
  initial: Agent
  creating: boolean
  computerName: string
  onClose: () => void
  global?: boolean
}) {
  const { workspace, request, connected } = useWorkspace()
  const { globalAgentPresets } = useAppPreferences()
  const [scope, setScope] = useApplicationState(global ? 'global' : 'server')
  const pending = useRef(false)
  const [busy, setBusy] = useApplicationState(false)
  const [agent, setAgent] = useApplicationState(initial)
  const [error, setError] = useApplicationState('')
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(initial.env))
  const storedProvider = workspace.agents.find((saved) => saved.id === initial.id)?.provider
  const lockedProviders = creating
    ? []
    : workspace.tasks
        .filter((task) => task.agentId === initial.id && !task.harness)
        .map((task) => lockedTaskProvider(task, workspace.agents))
        .filter((provider) => provider !== undefined)
  const availableProviders = Object.entries(providers).filter(
    ([id]) => id === storedProvider || lockedProviders.every((provider) => provider === id),
  )
  const providerAllowed = availableProviders.some(([id]) => id === agent.provider)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent configuration</DialogTitle>
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
            if (scope === 'global') {
              if (agent.acpInstallationId) {
                setError('Installed ACP agents belong to their server. Use a server configuration.')
                return
              }
              const preset = decode(agentPresetSchema, result.data)
              if (
                initial.globalPreset &&
                !globalAgentPresets.some((item) => item.id === initial.id)
              )
                preset.id = crypto.randomUUID()
              updateAppPreferences({
                globalAgentPresets: [
                  ...globalAgentPresets.filter((item) => item.id !== preset.id),
                  preset,
                ],
              })
              onClose()
              return
            }
            if (initial.globalPreset) result.data.serverOverride = true
            if (!providerAllowed) {
              setError(
                'This agent is used by an existing conversation. Keep its provider or create a new agent.',
              )
              return
            }
            if (pending.current) return
            pending.current = true
            setBusy(true)
            setError('')
            const before = decode(
              Schema.mutable(
                Schema.Record({
                  key: Schema.String,
                  value: Schema.Unknown,
                }),
              ),
              initial,
            )
            const after = decode(
              Schema.mutable(
                Schema.Record({
                  key: Schema.String,
                  value: Schema.Unknown,
                }),
              ),
              result.data,
            )
            const changes: Record<
              string,
              {
                before: unknown
                after: unknown
              }
            > = {}
            for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
              if (key !== 'id' && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
                changes[key] = {
                  before: before[key] ?? null,
                  after: after[key] ?? null,
                }
            void request(
              '/api/workspace',
              {
                collection: 'agents',
                id: initial.id,
                changes,
                ...(creating || !workspace.agents.some((agent) => agent.id === initial.id)
                  ? {
                      create: result.data,
                    }
                  : {}),
              },
              mutableStruct({
                revision: Schema.Number.pipe(Schema.finite()),
              }),
              'PATCH',
            )
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
          <fieldset disabled={busy || (scope === 'server' && !connected)} className="grid gap-4">
            <FormField label="Configuration scope">
              <ChoicePicker
                value={scope}
                onValueChange={setScope}
                aria-label="Configuration scope"
                className="h-9 rounded-md border bg-background px-2 text-xs"
              >
                <option value="server">This server · {computerName}</option>
                <option value="global">Global · All servers connected to this app</option>
              </ChoicePicker>
              <p className="text-xs text-muted-foreground">
                Global presets apply on reconnect. Server overrides keep their own settings.
                Executables and config directories resolve on each server.
              </p>
            </FormField>
            <FormField label="Name">
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
            <FormField label="Icon">
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
            <FormField label="Provider">
              <ChoicePicker
                aria-label="Provider"
                className="h-9 rounded-md border bg-background px-2 text-xs"
                value={agent.provider}
                disabled={availableProviders.length === 1 && providerAllowed}
                onValueChange={(selection) => {
                  if (!availableProviders.some(([id]) => id === selection)) return
                  setAgent({
                    ...agent,
                    provider: decode(agentSchema.fields.provider, selection),
                    model: '',
                    reasoning: '',
                    serviceTier: undefined,
                    cyberAccessProgram: undefined,
                    acpInstallationId: undefined,
                    acpMode: undefined,
                    acpConfig: undefined,
                    endpoint: '',
                    args: [],
                  })
                }}
              >
                {Object.entries(providers)
                  .filter(
                    ([id]) =>
                      id === agent.provider ||
                      availableProviders.some(([available]) => available === id),
                  )
                  .map(([id, p]) => (
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
            {lockedProviders.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Existing conversations use this agent. Keep their provider, or create a new agent to
                use another. Models and settings can still change.
              </p>
            )}
            {agent.provider === 'acp' && (
              <AcpRegistry agent={agent} onChange={setAgent} showRegistry={false} />
            )}
            <FormField label="Access">
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
              label={agent.provider === 'opencode' ? 'Server URL' : 'Connection / executable'}
            >
              <Input
                value={agent.acpInstallationId ? (agent.executablePath ?? '') : agent.endpoint}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    endpoint: e.target.value,
                  })
                }
                placeholder={
                  agent.provider === 'opencode' ? 'http://127.0.0.1:4096' : 'Managed by runtime'
                }
              />
            </FormField>
            {(agent.provider === 'codex' || agent.provider === 'claude') && (
              <FormField
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
            {agent.provider !== 'opencode' && (
              <FormField label="Executable arguments (one per line)">
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
            {agent.provider !== 'opencode' && (
              <FormField label="Environment variables (NAME=value, one per line)">
                <Textarea
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Saved as readable configuration. Keep secrets in the server's environment.
                </p>
              </FormField>
            )}
            <FormField label="Instructions">
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
            {initial.globalPreset && (
              <Button
                type="button"
                variant="outline"
                disabled={!connected || busy}
                onClick={() => {
                  setBusy(true)
                  void request(
                    '/api/agents/presets/reset',
                    { id: initial.id },
                    mutableStruct({ ok: Schema.Boolean }),
                  )
                    .then(onClose)
                    .catch((error: unknown) =>
                      setError(error instanceof Error ? error.message : String(error)),
                    )
                    .finally(() => setBusy(false))
                }}
              >
                Use global preset on this server
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                busy ||
                (scope === 'server' && !connected) ||
                !providerAllowed ||
                !supportsAccess(agent.provider, agent.permission)
              }
            >
              {busy ? 'Saving…' : 'Save configuration'}
            </Button>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
