import { useCallback, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import {
  ComposerModelPicker,
  ModelSettings,
  ChoicePicker,
  useHarnessCatalog,
} from '@dovo/studio-ui'
import {
  resolveScopedAgents,
  type Repository,
  decode,
  taskHarnessSchema,
  defaultTaskHarness,
  modelCatalogSchema,
  selectableAccessModes,
  selectedCatalogModel,
  supportsAccess,
  type LauncherAgent,
  type TaskHarness,
  type AgentDiscovery,
} from '@dovo/protocol'

export function TaskLauncherControls({
  selection,
  onChange,
  disabled,
  repository,
}: {
  selection: LauncherAgent
  onChange: (selection: LauncherAgent) => void
  disabled: boolean
  repository: Repository
}) {
  const { workspace, snapshot, request } = useWorkspace()
  const agents = resolveScopedAgents(snapshot?.defaults, repository, workspace.agents)
  const [configure, setConfigure] = useState(false)
  const selectedAgent = agents.find((agent) => agent.id === selection.agentId)
  const value = selection.harness ?? defaultTaskHarness(selection.provider)
  const { catalog } = useHarnessCatalog(value, !disabled)
  const efforts = selectedCatalogModel(catalog, value.model)?.reasoning ?? catalog?.reasoning ?? []
  const change = async (harness: TaskHarness, standalone = false) => {
    if (disabled) return false
    const same =
      harness.provider === selection.provider &&
      harness.acpInstallationId === selection.acpInstallationId
    const agentId = !standalone && same ? selection.agentId : undefined
    onChange({
      ...selection,
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ComposerModelPicker
          value={value}
          disabled={disabled}
          agents={agents}
          selectedAgent={selectedAgent}
          onChange={change}
          onUseHarness={(harness) => change(harness, true)}
          onConfigure={() => setConfigure((open) => !open)}
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
        {(efforts.length > 0 || value.reasoning) && (
          <ChoicePicker
            aria-label="Reasoning"
            value={value.reasoning ?? ''}
            disabled={disabled}
            onValueChange={(reasoning) => void change({ ...value, reasoning })}
            className="h-8 w-auto rounded-md px-2 text-xs"
          >
            <option value="">Default reasoning</option>
            {value.reasoning && !efforts.some((effort) => effort.id === value.reasoning) && (
              <option value={value.reasoning}>{value.reasoning}</option>
            )}
            {efforts.map((effort) => (
              <option key={effort.id} value={effort.id}>
                {effort.name}
              </option>
            ))}
          </ChoicePicker>
        )}
        <ChoicePicker
          aria-label="Access"
          value={value.permission}
          disabled={disabled}
          onValueChange={(permission) => {
            const option = selectableAccessModes(value.permission).find(
              (mode) => mode.id === permission,
            )
            if (option && supportsAccess(value.provider, option.id))
              void change({ ...value, permission: option.id })
          }}
          className="h-8 w-auto rounded-md px-2 text-xs"
        >
          {selectableAccessModes(value.permission)
            .filter((mode) => supportsAccess(value.provider, mode.id))
            .map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.name}
              </option>
            ))}
        </ChoicePicker>
      </div>
      {configure && (
        <ModelSettings
          agent={{ ...value, id: selectedAgent?.id ?? 'launcher', name: selection.name }}
          onChange={(agent) => void change(decode(taskHarnessSchema, agent))}
          loadModels={loadModels}
          connected={!disabled}
          preferences={snapshot?.defaults?.modelPreferences}
        />
      )}
    </div>
  )
}
