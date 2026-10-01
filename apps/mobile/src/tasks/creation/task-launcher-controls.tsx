import { View } from 'react-native'
import {
  decode,
  taskHarnessSchema,
  defaultTaskHarness,
  selectableAccessModes,
  supportsAccess,
  createLauncherTask,
  type LauncherAgent,
  type RuntimeSnapshot,
  type Repository,
} from '@dovo/protocol'
import { ModelSettings } from '../../agents/model-settings'
import { Choice } from '../../ui/controls/choice'
import { taskHarnessChoices, taskHarnessSelection, selectedTaskHarness } from './harness-choices'

export function TaskLauncherControls({
  selection,
  onChange,
  snapshot,
  repository,
  disabled,
}: {
  selection: LauncherAgent
  onChange: (selection: LauncherAgent) => void
  snapshot: RuntimeSnapshot
  repository: Repository
  disabled: boolean
}) {
  const harness = selection.harness ?? defaultTaskHarness(selection.provider)
  const task = createLauncherTask(snapshot, repository, selection, '', 'launcher-selection')
  const agents = snapshot.workspace.agents
  const agent = { ...harness, id: selection.agentId ?? 'launcher', name: selection.name }
  return (
    <View style={{ gap: 12 }}>
      <Choice
        label="Agent"
        value={taskHarnessSelection(task)}
        items={taskHarnessChoices(
          task,
          agents,
          snapshot.acpInstallations,
          snapshot.defaults?.modelPreferences,
        )}
        disabled={disabled}
        onChange={(id) => {
          if (disabled) return
          const next = selectedTaskHarness(task, agents, id, snapshot.acpInstallations)
          if (next)
            onChange({
              key: id,
              name: next.name,
              agentId: id.startsWith('agent:') ? next.id : undefined,
              provider: next.provider,
              model: next.model,
              acpInstallationId: next.acpInstallationId,
              harness: decode(taskHarnessSchema, next),
            })
        }}
      />
      <ModelSettings
        agent={agent}
        disabled={disabled}
        onChange={(next) => {
          if (!disabled)
            onChange({ ...selection, model: next.model, harness: decode(taskHarnessSchema, next) })
        }}
      />
      <Choice
        label="Access"
        value={agent.permission}
        disabled={disabled}
        items={selectableAccessModes(agent.permission)
          .filter((mode) => supportsAccess(agent.provider, mode.id))
          .map((mode) => ({ id: mode.id, name: mode.name }))}
        onChange={(permission) => {
          const mode = selectableAccessModes(agent.permission).find(
            (mode) => mode.id === permission,
          )
          if (mode && !disabled && supportsAccess(agent.provider, mode.id))
            onChange({ ...selection, harness: { ...harness, permission: mode.id } })
        }}
      />
    </View>
  )
}
