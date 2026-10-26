import {
  agentTurnSettings,
  applyTurnSettings,
  resolveScopedAgents,
  type Agent,
  type TurnSettings,
  type TaskHarness,
} from '@dovo/protocol'
import { Button, ComposerSettingsControls, permissionPolicyUIIssue } from '@dovo/studio-ui'
import { useWorkspace } from '@dovo/studio-core'
import { useState } from 'react'
import { HarnessDialog } from '../../dialogs/harness-dialog'
import type { Task } from '@dovo/protocol'

/** Edits a queued turn without changing the active run. */
export function TurnModelControls({
  agent,
  value,
  onChange,
  disabled,
  task,
}: {
  agent: Agent
  value?: TurnSettings | null
  onChange: (value: TurnSettings | null) => void
  disabled?: boolean
  task: Task
}) {
  const { workspace, snapshot } = useWorkspace()
  const [configure, setConfigure] = useState(false)
  const [error, setError] = useState('')
  const selected = applyTurnSettings(agent, value ?? undefined)
  const full = snapshot?.fullTurnSettingsSupported === true
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    workspace.repositories.find((repo) => repo.id === task.repositoryId),
    workspace.agents,
  )
  const change = async (next: TaskHarness) => {
    if (
      disabled ||
      next.provider !== agent.provider ||
      next.acpInstallationId !== agent.acpInstallationId
    )
      return false
    const issue = permissionPolicyUIIssue(next, snapshot?.permissionPolicySupported === true)
    if (issue) {
      setError(issue)
      return false
    }
    setError('')
    onChange(agentTurnSettings(next, full))
    return true
  }
  return (
    <>
      <ComposerSettingsControls
        modelOnly={!full}
        value={selected}
        disabled={!!disabled}
        agents={agents}
        repositoryId={task.repositoryId}
        lockedProvider={agent.provider}
        lockedInstallationId={
          agent.provider === 'acp' ? (agent.acpInstallationId ?? '') : undefined
        }
        onChange={change}
        onUseHarness={change}
        onSelectAgent={async (id) => {
          const preset = agents.find((item) => item.id === id)
          return preset ? change(preset) : false
        }}
        onConfigure={() => setConfigure(true)}
      />
      {snapshot?.persistentTurnModelsSupported && (
        <span className="text-xs text-muted-foreground">
          Model and reasoning stay selected for following turns.
        </span>
      )}
      {value && (
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
