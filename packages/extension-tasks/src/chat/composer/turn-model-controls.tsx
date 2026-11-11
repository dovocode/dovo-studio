import {
  agentTurnSettings,
  applyTurnSettings,
  resolveScopedAgents,
  type Agent,
  type TurnSettings,
  type TaskHarness,
} from '@dovo/protocol'
import {
  Button,
  ComposerSettingsControls,
  permissionPolicyUIIssue,
  type ComposerControlSlots,
} from '@dovo/studio-ui'
import { useWorkspace } from '@dovo/studio-core'
import { useState, type ReactNode } from 'react'
import { HarnessDialog } from '../../dialogs/harness-dialog'
import type { Task } from '@dovo/protocol'
import { useInlineHarnessHandoff } from './inline-harness-handoff'

/** Edits next-message settings and offers an explicit handoff when changing harnesses. */
export function TurnModelControls({
  agent,
  value,
  onChange,
  disabled,
  task,
  renderControls,
  allowHandoff = true,
}: {
  agent: Agent
  value?: TurnSettings | null
  onChange: (value: TurnSettings | null) => void
  disabled?: boolean
  task: Task
  renderControls?: (controls: ComposerControlSlots) => ReactNode
  allowHandoff?: boolean
}) {
  const { workspace, snapshot } = useWorkspace()
  const [configure, setConfigure] = useState(false)
  const [error, setError] = useState('')
  const handoff = useInlineHarnessHandoff(
    value ? { ...task, draftTurnSettings: task.draftTurnSettings ?? value } : task,
    allowHandoff && !disabled,
  )
  const selected = applyTurnSettings(agent, value ?? undefined)
  const full = snapshot?.fullTurnSettingsSupported === true
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    workspace.repositories.find((repo) => repo.id === task.repositoryId),
    workspace.agents,
  )
  const change = async (next: TaskHarness) => {
    if (disabled || handoff.busy) return false
    const issue = permissionPolicyUIIssue(next, snapshot?.permissionPolicySupported === true)
    if (issue) {
      setError(issue)
      return false
    }
    setError('')
    if (
      next.provider !== agent.provider ||
      (next.provider === 'acp' &&
        (next.acpInstallationId ?? '') !== (agent.acpInstallationId ?? ''))
    )
      return handoff.available ? handoff.choose(next) : false
    onChange(agentTurnSettings(next, full))
    return true
  }
  return (
    <>
      <ComposerSettingsControls
        renderControls={
          renderControls
            ? ({ model, access }) =>
                renderControls({
                  model: (
                    <>
                      {model}
                      {value && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => onChange(null)}
                        >
                          Use thread defaults
                        </Button>
                      )}
                    </>
                  ),
                  access,
                })
            : undefined
        }
        modelOnly={!full}
        value={selected}
        disabled={!!disabled || handoff.busy}
        agents={agents}
        repositoryId={task.repositoryId}
        lockedProvider={handoff.available ? undefined : agent.provider}
        lockedInstallationId={
          !handoff.available && agent.provider === 'acp'
            ? (agent.acpInstallationId ?? '')
            : undefined
        }
        onChange={change}
        onUseHarness={change}
        onSelectAgent={async (id) => {
          const preset = agents.find((item) => item.id === id)
          return preset ? change(preset) : false
        }}
        onConfigure={() => setConfigure(true)}
      />
      {handoff.notice}
      {!renderControls && value && (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
          Use thread defaults
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {configure && full && (
        <HarnessDialog
          task={task}
          initialValue={selected}
          onSave={change}
          onClose={() => setConfigure(false)}
        />
      )}
    </>
  )
}
