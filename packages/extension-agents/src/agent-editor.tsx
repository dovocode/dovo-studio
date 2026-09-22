import { accessModes, lockedTaskProvider, supportsAccess } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { ModelSettings } from './model-settings'
import { useRef, useState } from 'react'
import { z } from 'zod'
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
}: {
  initial: Agent
  creating: boolean
  computerName: string
  onClose: () => void
}) {
  const { workspace, request, connected } = useWorkspace()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [agent, setAgent] = useState(initial)
  const [error, setError] = useState('')
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
            const result = agentSchema.safeParse({ ...agent, name: agent.name.trim() })
            if (!result.success) {
              setError('Enter an agent name.')
              return
            }
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
            const before = z.record(z.string(), z.unknown()).parse(initial)
            const after = z.record(z.string(), z.unknown()).parse(result.data)
            const changes: Record<string, { before: unknown; after: unknown }> = {}
            for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
              if (key !== 'id' && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
                changes[key] = { before: before[key] ?? null, after: after[key] ?? null }
            void request(
              '/api/workspace',
              {
                collection: 'agents',
                id: initial.id,
                changes,
                ...(creating ? { create: result.data } : {}),
              },
              z.object({ revision: z.number() }),
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
          <fieldset disabled={busy || !connected} className="grid gap-4">
            <FormField label="Name">
              <Input
                required
                value={agent.name}
                onChange={(e) => setAgent({ ...agent, name: e.target.value })}
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
                          setAgent({ ...agent, icon: agentSchema.shape.icon.parse(id) })
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
                    provider: agentSchema.shape.provider.parse(selection),
                    model: '',
                    reasoning: '',
                    serviceTier: undefined,
                    cyberAccessProgram: undefined,
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
            <FormField label="Access">
              <ChoicePicker
                aria-label="Permissions"
                className="h-9 rounded-md border bg-background px-2 text-xs"
                value={agent.permission}
                onValueChange={(selection) =>
                  setAgent({
                    ...agent,
                    permission: agentSchema.shape.permission.parse(selection),
                  })
                }
              >
                {accessModes.map((mode) => (
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
              {accessModes.find((mode) => mode.id === agent.permission)?.description}
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
                value={agent.endpoint}
                onChange={(e) => setAgent({ ...agent, endpoint: e.target.value })}
                placeholder={
                  agent.provider === 'opencode' ? 'http://127.0.0.1:4096' : 'Managed by runtime'
                }
              />
            </FormField>
            {agent.provider === 'acp' && (
              <FormField label="Executable arguments (one per line)">
                <Textarea
                  value={(agent.args ?? []).join('\n')}
                  onChange={(event) =>
                    setAgent({ ...agent, args: event.target.value.split('\n').filter(Boolean) })
                  }
                  placeholder="--acp"
                />
              </FormField>
            )}
            <FormField label="Instructions">
              <Textarea
                value={agent.instructions}
                onChange={(e) => setAgent({ ...agent, instructions: e.target.value })}
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
              disabled={
                busy ||
                !connected ||
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
