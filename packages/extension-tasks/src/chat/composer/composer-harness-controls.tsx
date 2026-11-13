import { useApplicationState } from '@dovo/studio-core/state'
import {
  taskModelSelectionDifficultySchema,
  decode,
  resolveScopedAgents,
  canChangeTaskCheckout,
  changeTaskModelSelection,
} from '@dovo/protocol'
import { memo, useMemo, useRef, type ReactNode } from 'react'
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
import {
  ComposerSettingsControls,
  permissionPolicyUIIssue,
  type ComposerControlSlots,
} from '@dovo/studio-ui'
import { HarnessDialog } from '../../dialogs/harness-dialog'
import { useInlineHarnessHandoff } from './inline-harness-handoff'
import { changeTaskHarness, chooseTaskAgent } from './task-harness-selection'
export const ComposerHarnessControls = memo(function ComposerHarnessControls({
  task,
  disabled,
  renderControls,
}: {
  task: Task
  disabled: boolean
  renderControls?: (controls: ComposerControlSlots) => ReactNode
}) {
  const { workspace, setWorkspace, flush, snapshot } = useWorkspace()
  const agents = useMemo(
    () =>
      resolveScopedAgents(
        snapshot?.defaults,
        task.bot ? undefined : workspace.repositories.find((repo) => repo.id === task.repositoryId),
        workspace.agents,
      ),
    [snapshot?.defaults, workspace.repositories, workspace.agents, task.repositoryId, task.bot],
  )
  const providerLock = lockedTaskProvider(task, agents)
  const handoff = useInlineHarnessHandoff(task, !disabled)
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
      if (snapshot?.permissionPolicySupported !== true) {
        const nextAgent = resolveTaskAgent(change(task, agents), agents)
        const issue = nextAgent && permissionPolicyUIIssue(nextAgent, false)
        if (issue) throw new Error(issue)
      }
      setWorkspace((w) =>
        updateTask(w, task.id, (t) =>
          change(
            t,
            resolveScopedAgents(
              snapshot?.defaults,
              t.bot ? undefined : w.repositories.find((repo) => repo.id === t.repositoryId),
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
  const apply = async (harness: TaskHarness, standalone = false) => {
    if (disabled || handoff.busy) return false
    const issue = permissionPolicyUIIssue(harness, snapshot?.permissionPolicySupported === true)
    if (issue) {
      setError(issue)
      return false
    }
    if (
      handoff.available &&
      (harness.provider !== value.provider ||
        (harness.provider === 'acp' &&
          (harness.acpInstallationId ?? '') !== (value.acpInstallationId ?? '')))
    )
      return handoff.choose(harness)
    return save((current, agents) => changeTaskHarness(current, agents, harness, standalone))
  }
  const customAgent = task.agentId ? agents.find((agent) => agent.id === task.agentId) : undefined
  const locked = disabled || saving || handoff.busy || task.status === 'running'
  return (
    <>
      <ComposerSettingsControls
        renderControls={renderControls}
        automaticModesEnabled={snapshot?.smartModelSelectionEnabled === true}
        modelSelection={task.modelSelection}
        modelSelectionDifficulty={task.modelSelectionDifficulty}
        onSelectDifficulty={(reasoning) =>
          save((current) => ({
            ...current,
            modelSelectionDifficulty: decode(taskModelSelectionDifficultySchema, reasoning),
          }))
        }
        onSelectMode={
          !task.bot && canChangeTaskCheckout(task) && !task.delegation
            ? (mode) =>
                save((current) =>
                  changeTaskModelSelection(
                    current,
                    mode,
                    current.bot
                      ? undefined
                      : workspace.repositories.find((repo) => repo.id === current.repositoryId),
                    snapshot?.defaults,
                  ),
                )
            : undefined
        }
        repositoryId={task.bot ? undefined : task.repositoryId}
        agents={agents}
        selectedAgent={customAgent}
        value={value}
        lockedProvider={handoff.available ? undefined : providerLock}
        lockedInstallationId={handoff.available ? undefined : installationLock}
        disabled={locked}
        onChange={apply}
        onSelectAgent={(agentId) => {
          const agent = agents.find((entry) => entry.id === agentId)
          return agent &&
            handoff.available &&
            (agent.provider !== value.provider ||
              (agent.provider === 'acp' &&
                (agent.acpInstallationId ?? '') !== (value.acpInstallationId ?? '')))
            ? apply(decode(taskHarnessSchema, agent), true)
            : save((current, agents) => chooseTaskAgent(current, agents, agentId))
        }}
        onUseHarness={(harness) => apply(harness, true)}
        onConfigure={() => setConnection(true)}
      />
      {handoff.notice}
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
      {connection && <HarnessDialog task={task} onClose={() => setConnection(false)} />}
    </>
  )
})
