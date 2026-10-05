import { useApplicationState } from '@dovo/studio-core/state'
import { decode, resolveScopedAgents } from '@dovo/protocol'
import { memo, useMemo, useRef } from 'react'
import {
  defaultTaskHarness,
  lockedTaskProvider,
  lockedAcpInstallationId,
  resolveTaskAgent,
  taskHarnessSchema,
  updateTask,
  useWorkspace,
  type Task,
  type TaskHarness,
} from '@dovo/studio-core'
import { ComposerSettingsControls } from '@dovo/studio-ui'
import { HarnessDialog } from '../../dialogs/harness-dialog'
import { changeTaskHarness, chooseTaskAgent } from './task-harness-selection'
export const ComposerHarnessControls = memo(function ComposerHarnessControls({
  task,
  disabled,
}: {
  task: Task
  disabled: boolean
}) {
  const { workspace, setWorkspace, flush, snapshot } = useWorkspace()
  const agents = useMemo(
    () =>
      resolveScopedAgents(
        snapshot?.defaults,
        workspace.repositories.find((repo) => repo.id === task.repositoryId),
        workspace.agents,
      ),
    [snapshot?.defaults, workspace.repositories, workspace.agents, task.repositoryId],
  )
  const providerLock = lockedTaskProvider(task, agents)
  const installationLock = lockedAcpInstallationId(task, agents)
  const value = useMemo(() => {
    const resolved = resolveTaskAgent(task, agents)
    return resolved
      ? decode(taskHarnessSchema, resolved)
      : defaultTaskHarness(providerLock ?? 'codex')
  }, [task.id, task.agentId, task.agentOverrides, task.harness, agents, providerLock])
  const [connection, setConnection] = useApplicationState(false)
  const [saving, setSaving] = useApplicationState(false)
  const savingRef = useRef(false)
  const [error, setError] = useApplicationState('')
  const save = async (change: (current: Task, agents: typeof workspace.agents) => Task) => {
    if (disabled || savingRef.current || task.status === 'running') return false
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      setWorkspace((w) =>
        updateTask(w, task.id, (t) =>
          change(
            t,
            resolveScopedAgents(
              snapshot?.defaults,
              w.repositories.find((repo) => repo.id === t.repositoryId),
              w.agents,
            ),
          ),
        ),
      )
      await flush()
      return true
    } catch (error) {
      setError(String(error))
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const apply = (harness: TaskHarness) =>
    save((current, agents) => changeTaskHarness(current, agents, harness))
  const customAgent = task.agentId ? agents.find((agent) => agent.id === task.agentId) : undefined
  const locked = disabled || saving || task.status === 'running'
  return (
    <>
      <ComposerSettingsControls
        repositoryId={task.repositoryId}
        agents={agents}
        selectedAgent={customAgent}
        value={value}
        lockedProvider={providerLock}
        lockedInstallationId={installationLock}
        disabled={locked}
        onChange={apply}
        onSelectAgent={(agentId) =>
          save((current, agents) => chooseTaskAgent(current, agents, agentId))
        }
        onUseHarness={(harness) =>
          save((current, agents) =>
            changeTaskHarness(current, agents, { ...harness, permission: value.permission }, true),
          )
        }
        onConfigure={() => setConnection(true)}
      />
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
      {connection && <HarnessDialog task={task} onClose={() => setConnection(false)} />}
    </>
  )
})
