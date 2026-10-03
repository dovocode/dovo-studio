import { useApplicationState } from '@dovo/studio-core/state'
import { decode, resolveScopedAgents } from '@dovo/protocol'
import { HarnessFields } from '../harness-fields'
import {
  defaultTaskHarness,
  acpInstallationHarness,
  acpHarnessChoiceId,
  providerSchema,
  providers,
  resolveTaskAgent,
  lockedTaskProvider,
  lockedAcpInstallationId,
} from '@dovo/studio-core'
import { selectableAccessModes, supportsAccess, accessLabel } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { agentSchema, branchesSchema } from '@dovo/studio-core'
import { BranchPicker } from '@dovo/studio-ui'
import { useCallback, useState } from 'react'
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
  Textarea,
} from '@dovo/studio-ui'
import { responses } from '@dovo/studio-core'
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
  const { workspace, setWorkspace, request, connected, flush, snapshot } = useWorkspace()
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    workspace.repositories.find((repo) => repo.id === task.repositoryId),
    workspace.agents,
  )
  const installations = snapshot?.acpInstallations ?? []
  const providerLock = lockedTaskProvider(task, agents)
  const installationLock = lockedAcpInstallationId(task, agents)
  const [laterText, setLaterText] = useState('')
  const [laterAt, setLaterAt] = useState('')
  const [timingError, setTimingError] = useState('')
  const [timingBusy, setTimingBusy] = useState(false)
  const [budgetTokens, setBudgetTokens] = useState(task.budget?.tokens?.toString() ?? '')
  const [budgetMinutes, setBudgetMinutes] = useState(task.budget?.minutes?.toString() ?? '')
  const timing = (path: string, input: unknown) => {
    setTimingBusy(true)
    setTimingError('')
    void request(path, input, responses.ok)
      .then(() => {
        if (path.endsWith('/schedule') && !('removeId' in (input as object))) {
          setLaterText('')
          setLaterAt('')
        }
      })
      .catch((cause: unknown) => setTimingError(String(cause)))
      .finally(() => setTimingBusy(false))
  }
  const [title, setTitle] = useApplicationState(task.title),
    [agentId, setAgentId] = useApplicationState(task.agentId),
    [overrides, setOverrides] = useApplicationState(task.agentOverrides),
    [harness, setHarness] = useApplicationState(task.harness ?? null),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const base = agents.find((a) => a.id === agentId)
  const agent = resolveTaskAgent(
    {
      ...task,
      agentId,
      harness,
      agentOverrides: overrides,
    },
    agents,
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
        const provider = lockedTaskProvider(task, agents)
        if (
          provider &&
          resolveTaskAgent(
            {
              ...task,
              ...changes,
            },
            agents,
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
            budget: {
              ...(budgetTokens && Number(budgetTokens) > 0 ? { tokens: Number(budgetTokens) } : {}),
              ...(budgetMinutes && Number(budgetMinutes) > 0
                ? { minutes: Number(budgetMinutes) }
                : {}),
            },
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
        {!workspace.repositories.find((repo) => repo.id === task.repositoryId)?.kind && (
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
        )}
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
              value={
                harness
                  ? harness.provider === 'acp' && harness.acpInstallationId
                    ? acpHarnessChoiceId(harness.acpInstallationId)
                    : `harness:${harness.provider}`
                  : agentId
              }
              onValueChange={(selection) => {
                const installation = installations.find(
                  (item) => acpHarnessChoiceId(item.id) === selection,
                )
                if (installation) {
                  if (
                    (providerLock && providerLock !== 'acp') ||
                    (installationLock !== undefined && installationLock !== installation.id)
                  )
                    return
                  setHarness(
                    acpInstallationHarness(installation, agent?.permission ?? 'full-access'),
                  )
                  setAgentId('')
                } else if (selection.startsWith('harness:')) {
                  const provider = decode(providerSchema, selection.slice(8))
                  if (providerLock && provider !== providerLock) return
                  if (
                    provider === 'acp' &&
                    installationLock !== undefined &&
                    installationLock !== ''
                  )
                    return
                  setHarness({
                    ...defaultTaskHarness(provider),
                    permission: agent?.permission ?? 'full-access',
                  })
                  setAgentId('')
                } else {
                  const selectedAgent = agents.find((agent) => agent.id === selection)
                  if (providerLock && selectedAgent?.provider !== providerLock) return
                  if (
                    installationLock !== undefined &&
                    (selectedAgent?.acpInstallationId ?? '') !== installationLock
                  )
                    return
                  setAgentId(selection)
                  setHarness(null)
                }
                setOverrides(undefined)
              }}
            >
              {providerSchema.literals
                .filter(
                  (provider) =>
                    (!providerLock || provider === providerLock) &&
                    (provider !== 'acp' ||
                      installationLock === undefined ||
                      installationLock === ''),
                )
                .map((provider) => (
                  <option key={provider} value={`harness:${provider}`}>
                    {providers[provider].short}
                  </option>
                ))}
              {installations
                .filter(
                  (installation) =>
                    (!providerLock || providerLock === 'acp') &&
                    (installationLock === undefined || installationLock === installation.id),
                )
                .map((installation) => (
                  <option key={installation.id} value={acpHarnessChoiceId(installation.id)}>
                    {installation.name} · ACP
                  </option>
                ))}
              {agents
                .filter(
                  (a) =>
                    (!providerLock || a.provider === providerLock) &&
                    (installationLock === undefined ||
                      (a.acpInstallationId ?? '') === installationLock),
                )
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
              lockedInstallationId={installationLock}
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
                  preferences={snapshot?.defaults?.modelPreferences}
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
                  {selectableAccessModes(overrides?.permission).map((mode) => (
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
                {
                  selectableAccessModes(agent?.permission).find(
                    (mode) => mode.id === agent?.permission,
                  )?.description
                }{' '}
                Changes apply to future turns.
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
        {!onSave && (
          <section className="space-y-2 border-t pt-3">
            <h3 className="text-xs font-medium">Task budget · warn only</h3>
            <div className="flex gap-2">
              <Input
                aria-label="Token warning limit"
                type="number"
                min="1"
                step="1"
                placeholder="Tokens"
                value={budgetTokens}
                onChange={(event) => setBudgetTokens(event.target.value)}
              />
              <Input
                aria-label="Agent minutes warning limit"
                type="number"
                min="1"
                step="1"
                placeholder="Agent minutes"
                value={budgetMinutes}
                onChange={(event) => setBudgetMinutes(event.target.value)}
              />
            </div>
            <h3 className="text-xs font-medium">Send later</h3>
            <Textarea
              aria-label="Scheduled follow-up"
              placeholder="Check CI and fix failures"
              value={laterText}
              onChange={(event) => setLaterText(event.target.value)}
              className="min-h-16 text-xs"
            />
            <Input
              aria-label="Send at"
              type="datetime-local"
              value={laterAt}
              onChange={(event) => setLaterAt(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={timingBusy || !laterText.trim() || !laterAt}
              onClick={() =>
                timing('/api/tasks/schedule', {
                  id: task.id,
                  text: laterText.trim(),
                  at: new Date(laterAt).toISOString(),
                })
              }
            >
              Schedule follow-up
            </Button>
            {!!task.scheduledMessages?.length &&
              task.scheduledMessages.map((message) => (
                <div key={message.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate" title={message.text}>
                    {new Date(message.at).toLocaleString()} · {message.text}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={timingBusy}
                    onClick={() =>
                      timing('/api/tasks/schedule', { id: task.id, removeId: message.id })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            {task.status === 'draft' && (
              <div className="space-y-1">
                <h3 className="text-xs font-medium">Start after</h3>
                <ChoicePicker
                  aria-label="Start after task"
                  value={task.startAfter?.taskId ?? ''}
                  disabled={timingBusy}
                  onValueChange={(sourceId) =>
                    timing('/api/tasks/start-after', { id: task.id, sourceId: sourceId || null })
                  }
                >
                  <option value="">Start manually</option>
                  {workspace.tasks
                    .filter((item) => item.id !== task.id && !item.archivedAt)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                </ChoicePicker>
                <p className="text-xs text-muted-foreground">
                  The task starts on this computer when the selected task finishes cleanly. Its
                  checkout choice still applies.
                </p>
              </div>
            )}
            {!!timingError && (
              <p role="alert" className="text-xs text-destructive">
                {timingError}
              </p>
            )}
          </section>
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
