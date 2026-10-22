import { selectPermissionPreset, permissionPolicyLabel } from '@dovo/protocol'
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
  ModelSettings,
  FormField,
  ChoicePicker,
  PermissionPolicyFields,
  permissionPolicyUIIssue,
} from '@dovo/studio-ui'
import { HarnessFields } from '../harness-fields'
import { changeTaskHarness } from '../chat/composer/task-harness-selection'
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
  const { workspace, setWorkspace, flush, request, connected, snapshot } = useWorkspace()
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    workspace.repositories.find((repo) => repo.id === task.repositoryId),
    workspace.agents,
  )
  const customAgent = onSave ? undefined : agents.find((agent) => agent.id === task.agentId)
  const providerLock = lockedTaskProvider(task, agents)
  const installationLock = lockedAcpInstallationId(task, agents)
  const [value, setValue] = useApplicationState(() => {
    if (initialValue) return initialValue
    const agent = resolveTaskAgent(task, agents)
    return agent ? decode(taskHarnessSchema, agent) : defaultTaskHarness(providerLock ?? 'codex')
  })
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const loadModels = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const save = async () => {
    if (
      busy ||
      !connected ||
      (!onSave && task.status === 'running') ||
      permissionPolicyUIIssue(value, snapshot?.permissionPolicySupported === true)
    )
      return
    setBusy(true)
    setError('')
    try {
      if (onSave) {
        if (await onSave(value)) onClose()
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
              workspace.repositories.find((repo) => repo.id === current.repositoryId),
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
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Task harness</DialogTitle>
          <DialogDescription>
            {onSave
              ? 'Settings for this message only.'
              : 'Model, reasoning and access for this task. Saved agents stay unchanged.'}
          </DialogDescription>
        </DialogHeader>
        <fieldset
          className="grid gap-3"
          disabled={!connected || busy || (!onSave && task.status === 'running')}
        >
          {customAgent ? (
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
                  {selectableAccessModes(value.permission).map((mode) => (
                    <option
                      key={mode.id}
                      value={mode.id}
                      disabled={!supportsAccess(value.provider, mode.id)}
                    >
                      {mode.name}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
              <PermissionPolicyFields
                value={value}
                supported={snapshot?.permissionPolicySupported === true}
                disabled={!connected || busy || (!onSave && task.status === 'running')}
                onChange={(policy) => setValue({ ...value, ...policy })}
              />
            </>
          ) : (
            <HarnessFields
              value={value}
              onChange={setValue}
              lockedProvider={providerLock}
              lockedInstallationId={installationLock}
            />
          )}
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
        </fieldset>
        {!onSave && task.status === 'running' && (
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
