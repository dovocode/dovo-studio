import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import { HarnessFields } from './harness-fields'
import {
  defaultTaskHarness,
  providerSchema,
  providers,
  resolveTaskAgent,
  lockedTaskProvider,
} from '@dovo/studio-core'
import { accessModes, supportsAccess, accessLabel } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { agentSchema, branchesSchema } from '@dovo/studio-core'
import { BranchPicker } from '@dovo/studio-ui'
import { useCallback } from 'react'
import {
  modelCatalogSchema,
  updateTask,
  useWorkspace,
  type Task,
  type AgentDiscovery,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Input,
  ModelSettings,
} from '@dovo/studio-ui'
export function TaskSettings({
  task,
  open,
  onOpenChange,
  onSave,
}: {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave?: (
    changes: Pick<Task, 'title' | 'agentId' | 'agentOverrides' | 'harness'>,
  ) => Promise<void>
}) {
  const { workspace, setWorkspace, request, connected, flush } = useWorkspace()
  const providerLock = lockedTaskProvider(task, workspace.agents)
  const [title, setTitle] = useApplicationState(task.title),
    [agentId, setAgentId] = useApplicationState(task.agentId),
    [overrides, setOverrides] = useApplicationState(task.agentOverrides),
    [harness, setHarness] = useApplicationState(task.harness ?? null),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const base = workspace.agents.find((a) => a.id === agentId)
  const agent = resolveTaskAgent(
    {
      ...task,
      agentId,
      harness,
      agentOverrides: overrides,
    },
    workspace.agents,
  )
  const load = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const save = async () => {
    if (busy || task.status === 'running') return
    setBusy(true)
    setError('')
    try {
      if (onSave) {
        const changes = {
          title: title.trim(),
          agentId,
          agentOverrides: overrides,
          harness,
        }
        const provider = lockedTaskProvider(task, workspace.agents)
        if (
          provider &&
          resolveTaskAgent(
            {
              ...task,
              ...changes,
            },
            workspace.agents,
          )?.provider !== provider
        )
          throw new Error(
            `This conversation uses ${providers[provider].short}. Start a new task to use another provider.`,
          )
        await onSave(changes)
        onOpenChange(false)
        return
      }
      setWorkspace((w) =>
        updateTask(w, task.id, (t) => {
          if (t.status === 'running')
            throw new Error('Stop the current turn before changing its settings.')
          const next = {
            ...t,
            title: title.trim(),
            agentId,
            agentOverrides: overrides,
            harness,
          }
          const provider = lockedTaskProvider(t, w.agents)
          if (provider && resolveTaskAgent(next, w.agents)?.provider !== provider)
            throw new Error(
              `This conversation uses ${providers[provider].short}. Start a new task to use another provider.`,
            )
          return next
        }),
      )
      await flush()
      onOpenChange(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle className="text-sm">Task settings</DialogTitle>
        <DialogDescription className="text-xs">
          Choose a harness directly or use a saved agent. Configuration applies only to this task.
        </DialogDescription>
        <BranchPicker
          disabled={!connected || busy || task.status === 'running'}
          load={() =>
            request(
              '/api/scm/branches',
              {
                repositoryId: task.repositoryId,
                taskId: task.id,
              },
              branchesSchema,
            )
          }
          change={(input) =>
            request(
              '/api/scm/branch',
              {
                repositoryId: task.repositoryId,
                taskId: task.id,
                ...input,
              },
              branchesSchema,
            )
          }
        />
        <FormField label="Title">
          <Input aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <fieldset
          disabled={task.status === 'running' || busy}
          className="grid gap-3 disabled:opacity-60"
        >
          <FormField label="Harness or saved agent">
            <ChoicePicker
              aria-label="Task agent"
              className="h-9 rounded-md border bg-background px-2 text-xs"
              value={harness ? `harness:${harness.provider}` : agentId}
              onValueChange={(selection) => {
                if (selection === (harness ? `harness:${harness.provider}` : agentId)) return
                if (selection.startsWith('harness:')) {
                  const provider = decode(providerSchema, selection.slice(8))
                  if (providerLock && provider !== providerLock) return
                  setHarness(defaultTaskHarness(provider))
                  setAgentId('')
                } else {
                  const selectedAgent = workspace.agents.find((agent) => agent.id === selection)
                  if (providerLock && selectedAgent?.provider !== providerLock) return
                  setAgentId(selection)
                  setHarness(null)
                }
                setOverrides(undefined)
              }}
            >
              {providerSchema.literals
                .filter((provider) => !providerLock || provider === providerLock)
                .map((provider) => (
                  <option key={provider} value={`harness:${provider}`}>
                    {providers[provider].short}
                  </option>
                ))}
              {workspace.agents
                .filter((a) => !providerLock || a.provider === providerLock)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </ChoicePicker>
          </FormField>
          {harness && (
            <HarnessFields
              value={harness}
              lockedProvider={providerLock}
              onChange={(value) => {
                setHarness(value)
                setOverrides(undefined)
              }}
            />
          )}
          {!harness && (
            <>
              {providerLock && (
                <p className="text-xs text-muted-foreground">
                  This conversation uses {providers[providerLock].short}. You can choose another
                  model or saved agent using the same provider.
                </p>
              )}
              {agent && (
                <ModelSettings
                  key={agentId}
                  agent={agent}
                  connected={connected}
                  loadModels={load}
                  onChange={(next) =>
                    setOverrides({
                      ...overrides,
                      model: next.model,
                      reasoning: next.reasoning,
                      serviceTier: next.serviceTier ?? null,
                      cyberAccessProgram: next.cyberAccessProgram ?? null,
                      ...(next.provider === 'acp'
                        ? {
                            acpInstallationId: next.acpInstallationId ?? null,
                            acpMode: next.acpMode ?? '',
                            acpConfig: next.acpConfig ?? {},
                          }
                        : {}),
                    })
                  }
                />
              )}
              <FormField label="Access">
                <ChoicePicker
                  aria-label="Task permissions"
                  value={overrides?.permission ?? 'inherit'}
                  onValueChange={(value) =>
                    setOverrides({
                      ...overrides,
                      permission:
                        value === 'inherit'
                          ? undefined
                          : decode(agentSchema.fields.permission, value),
                    })
                  }
                >
                  <option value="inherit">
                    Use agent defaults ({accessLabel(base?.permission ?? 'ask')})
                  </option>
                  {accessModes.map((mode) => (
                    <option
                      key={mode.id}
                      value={mode.id}
                      disabled={!agent || !supportsAccess(agent.provider, mode.id)}
                    >
                      {mode.name}
                      {agent && supportsAccess(agent.provider, mode.id) ? '' : ' · Not supported'}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
              <p className="text-xs text-muted-foreground">
                {accessModes.find((mode) => mode.id === agent?.permission)?.description} Changes
                apply to future turns.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setOverrides(undefined)}>
                Use agent defaults
              </Button>
            </>
          )}
        </fieldset>
        {task.status === 'running' && (
          <p className="text-xs text-muted-foreground">
            Stop the current turn to change its agent or model.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          disabled={
            busy ||
            !title.trim() ||
            !agent ||
            (!!providerLock && agent.provider !== providerLock) ||
            !supportsAccess(agent.provider, agent.permission) ||
            task.status === 'running'
          }
          onClick={() => void save()}
        >
          Save task settings
        </Button>
      </DialogContent>
    </Dialog>
  )
}
