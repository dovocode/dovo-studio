import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  claudeAutoRestrictionText,
  containerSandboxEnabled,
  selectPermissionPreset,
  permissionPolicyLabel,
  taskContainerSandbox,
} from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { decode, resolveScopedAgents } from '@dovo/protocol'
import { useCallback } from 'react'
import {
  defaultTaskHarness,
  lockedTaskProvider,
  lockedAcpInstallationId,
  resolveTaskAgent,
  taskHarnessSchema,
  updateTask,
  selectableAccessModes,
  modelCatalogSchema,
  supportsAccess,
  useWorkspace,
  type AgentDiscovery,
  type Task,
  type TaskHarness,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ModelSettings,
  FormField,
  ChoicePicker,
  PermissionPolicyFields,
  permissionPolicyUIIssue,
  useHarnessAvailability,
} from '@dovo/studio-ui'
import { HarnessFields } from '../harness-fields'
import { changeTaskHarness } from '../chat/composer/task-harness-selection'
import { useInlineHarnessHandoff } from '../chat/composer/inline-harness-handoff'
export function HarnessDialog({
  task,
  onClose,
  initialValue,
  onSave,
}: {
  task: Task
  onClose: () => void
  initialValue?: TaskHarness
  onSave?: (value: TaskHarness) => Promise<boolean>
}) {
  const uiText = useInterfaceText()

  const { workspace, setWorkspace, flush, request, connected, snapshot } = useWorkspace()
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    task.bot ? undefined : workspace.repositories.find((repo) => repo.id === task.repositoryId),
    workspace.agents,
  )
  const customAgent = onSave ? undefined : agents.find((agent) => agent.id === task.agentId)
  const handoff = useInlineHarnessHandoff(task, !onSave)
  const canDefer = !!task.bot && snapshot?.pendingBotHarnessSupported === true
  const providerLock = handoff.available ? undefined : lockedTaskProvider(task, agents)
  const installationLock = handoff.available ? undefined : lockedAcpInstallationId(task, agents)
  const [value, setValue] = useApplicationState(() => {
    if (initialValue) return initialValue
    if (task.pendingHarness) return task.pendingHarness.harness
    const agent = resolveTaskAgent(task, agents)
    return agent ? decode(taskHarnessSchema, agent) : defaultTaskHarness(providerLock ?? 'codex')
  })
  const repository = workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const { claudeAutoLimits } = useHarnessAvailability(
    task.repositoryId,
    value.provider === 'claude',
    agents,
    false,
    containerSandboxEnabled(taskContainerSandbox(task, snapshot?.defaults, repository)),
    { taskId: task.id },
  )
  const autoLimit =
    value.provider === 'claude'
      ? claudeAutoLimits.get(task.agentId ? `agent:${task.agentId}` : 'harness:claude')
      : undefined
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const locked =
    !connected || busy || handoff.busy || (!onSave && task.status === 'running' && !canDefer)
  const loadModels = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const save = async () => {
    if (locked || permissionPolicyUIIssue(value, snapshot?.permissionPolicySupported === true))
      return
    setBusy(true)
    setError('')
    try {
      if (onSave) {
        if (await onSave(value)) onClose()
        return
      }
      const current = resolveTaskAgent(task, agents)
      if (
        handoff.available &&
        ((canDefer && (task.status === 'running' || task.pendingHarness)) ||
          current?.provider !== value.provider ||
          (value.provider === 'acp' &&
            (current?.acpInstallationId ?? '') !== (value.acpInstallationId ?? '')))
      ) {
        if (await handoff.choose(value)) onClose()
        return
      }
      setWorkspace((workspace) =>
        updateTask(workspace, task.id, (current) => {
          if (current.status === 'running')
            throw new Error('Stop the current turn before changing its model.')
          return changeTaskHarness(
            current,
            resolveScopedAgents(
              snapshot?.defaults,
              current.bot
                ? undefined
                : workspace.repositories.find((repo) => repo.id === current.repositoryId),
              workspace.agents,
            ),
            value,
          )
        }),
      )
      await flush()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !handoff.busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thread harness</DialogTitle>
          <DialogDescription>
            {onSave
              ? 'Settings for this message only.'
              : 'Model, reasoning and access for this thread. Saved agents stay unchanged.'}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-3" disabled={locked}>
          {customAgent && !handoff.available ? (
            <>
              <p className="text-xs text-muted-foreground">
                {customAgent.name} uses its saved instructions, skills and MCP servers.
              </p>
              <ModelSettings
                preferences={snapshot?.defaults?.modelPreferences}
                agent={{ ...customAgent, ...value }}
                connected={connected}
                loadModels={loadModels}
                onChange={(next) => setValue(decode(taskHarnessSchema, next))}
              />
              <FormField label="Access mode">
                <ChoicePicker
                  aria-label="Harness access"
                  value={permissionPolicyLabel(value) === 'Custom' ? 'custom' : value.permission}
                  onValueChange={(permission) =>
                    setValue(
                      selectPermissionPreset(
                        value,
                        decode(taskHarnessSchema.fields.permission, permission),
                      ),
                    )
                  }
                >
                  {permissionPolicyLabel(value) === 'Custom' && (
                    <option value="custom" disabled>
                      Custom
                    </option>
                  )}
                  {selectableAccessModes(
                    value.permission,
                    value.provider,
                    value.acpInstallationId,
                  ).map((mode) => (
                    <option
                      key={mode.id}
                      value={mode.id}
                      disabled={
                        !supportsAccess(value.provider, mode.id) ||
                        (mode.id === 'auto' && !!autoLimit)
                      }
                    >
                      {mode.name}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
              {autoLimit && (
                <p className="text-xs text-muted-foreground">
                  {uiText(claudeAutoRestrictionText[autoLimit])}
                </p>
              )}
              <PermissionPolicyFields
                value={value}
                supported={snapshot?.permissionPolicySupported === true}
                disabled={locked}
                onChange={(policy) => setValue({ ...value, ...policy })}
              />
            </>
          ) : (
            <HarnessFields
              value={value}
              onChange={setValue}
              lockedProvider={providerLock}
              lockedInstallationId={installationLock}
              claudeAutoLimit={autoLimit}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy || handoff.busy}
              onClick={onClose}
            >
              {uiText('Cancel')}
            </Button>
            <Button
              disabled={
                !!permissionPolicyUIIssue(value, snapshot?.permissionPolicySupported === true) ||
                !supportsAccess(value.provider, value.permission) ||
                (!!providerLock && value.provider !== providerLock) ||
                (installationLock !== undefined &&
                  (value.acpInstallationId ?? '') !== installationLock)
              }
              onClick={() => void save()}
            >
              Save harness
            </Button>
          </DialogFooter>
        </fieldset>
        {handoff.notice}
        {!onSave && task.status === 'running' && !canDefer && (
          <p className="text-xs text-muted-foreground">
            Stop the current turn to change its harness.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
