import { useCallback, useState, type ReactNode } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import {
  ComposerSettingsControls,
  type ComposerControlSlots,
  ModelSettings,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
import {
  taskModelSelectionDifficultySchema,
  resolveScopedAgents,
  type Repository,
  decode,
  taskHarnessSchema,
  defaultTaskHarness,
  modelCatalogSchema,
  type LauncherAgent,
  type TaskHarness,
  type AgentDiscovery,
} from '@dovo/protocol'

export function TaskLauncherControls({
  selection,
  onChange,
  disabled,
  repository,
  renderControls,
}: {
  selection: LauncherAgent
  onChange: (selection: LauncherAgent) => void
  disabled: boolean
  repository: Repository
  renderControls?: (controls: ComposerControlSlots) => ReactNode
}) {
  const { workspace, snapshot, request } = useWorkspace()
  const agents = resolveScopedAgents(snapshot?.defaults, repository, workspace.agents)
  const [configure, setConfigure] = useState(false)
  const selectedAgent = agents.find((agent) => agent.id === selection.agentId)
  const value = selection.harness ?? defaultTaskHarness(selection.provider)
  const change = async (harness: TaskHarness, standalone = false) => {
    if (disabled) return false
    const same =
      harness.provider === selection.provider &&
      harness.acpInstallationId === selection.acpInstallationId
    const agentId = !standalone && same ? selection.agentId : undefined
    onChange({
      ...selection,
      modelSelection: undefined,
      key: agentId ? `agent:${agentId}` : `harness:${harness.provider}`,
      name: agentId ? selection.name : harness.provider,
      agentId,
      provider: harness.provider,
      model: harness.model,
      acpInstallationId: harness.acpInstallationId,
      harness,
    })
    return true
  }
  const loadModels = useCallback(
    (agent: AgentDiscovery) => request('/api/agents/models', agent, modelCatalogSchema),
    [request],
  )
  return (
    <>
      <ComposerSettingsControls
        renderControls={renderControls}
        automaticModesEnabled={snapshot?.smartModelSelectionEnabled === true}
        modelSelection={selection.modelSelection}
        modelSelectionDifficulty={selection.modelSelectionDifficulty}
        onSelectDifficulty={async (reasoning) => {
          onChange({
            ...selection,
            modelSelectionDifficulty: decode(taskModelSelectionDifficultySchema, reasoning),
          })
          return true
        }}
        onSelectMode={async (mode) => {
          onChange({ ...selection, modelSelection: mode, agentId: undefined })
          return true
        }}
        repositoryId={repository.id}
        value={value}
        disabled={disabled}
        agents={agents}
        selectedAgent={selectedAgent}
        onChange={change}
        onUseHarness={(harness) => change(harness, true)}
        onConfigure={() => setConfigure(true)}
        onSelectAgent={async (id) => {
          const agent = agents.find((entry) => entry.id === id)
          if (!agent || disabled) return false
          onChange({
            key: `agent:${id}`,
            name: agent.name,
            agentId: id,
            provider: agent.provider,
            model: agent.model,
            acpInstallationId: agent.acpInstallationId,
            harness: decode(taskHarnessSchema, agent),
          })
          return true
        }}
      />
      <Dialog open={configure} onOpenChange={setConfigure}>
        <DialogContent>
          <DialogTitle>Agent configuration</DialogTitle>
          <DialogDescription>Configure the agent for this task.</DialogDescription>
          {configure && (
            <ModelSettings
              agent={{ ...value, id: selectedAgent?.id ?? 'launcher', name: selection.name }}
              onChange={(agent) => void change(decode(taskHarnessSchema, agent))}
              loadModels={loadModels}
              connected={!disabled}
              preferences={snapshot?.defaults?.modelPreferences}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
