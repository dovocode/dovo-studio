import {
  taskModelSelectionDifficultySchema,
  selectPermissionPreset,
  permissionPolicyLabel,
} from '@dovo/protocol'
import { View } from 'react-native'
import {
  automaticDifficultyChoices,
  resolveScopedAgents,
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
import { PermissionPolicyControls } from '../../agents/permission-policy-controls'
import { ModelSettings } from '../../agents/model-settings'
import { useHarnessAvailability } from '../../agents/use-harness-availability'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
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
  const { styles } = useTheme()

  const harness = selection.harness ?? defaultTaskHarness(selection.provider)
  const task = createLauncherTask(snapshot, repository, selection, '', 'launcher-selection')
  const agents = resolveScopedAgents(snapshot.defaults, repository, snapshot.workspace.agents)
  const agent = { ...harness, id: selection.agentId ?? 'launcher', name: selection.name }
  const availability = useHarnessAvailability(repository.id, agents)
  return (
    <View style={{ gap: 12 }}>
      {
        <Choice
          label="Model selection"
          value={selection.modelSelection ?? 'fixed'}
          disabled={disabled}
          items={[
            { id: 'fixed', name: 'Specific harness/model' },
            { id: 'inherit', name: 'Inherit' },
            ...(snapshot.smartModelSelectionEnabled === true
              ? [
                  { id: 'auto', name: 'AUTO' },
                  { id: 'smart', name: 'SMART' },
                ]
              : []),
          ]}
          onChange={(mode) => {
            if (!disabled && mode === 'fixed') {
              onChange({ ...selection, modelSelection: undefined })
              return
            }
            if (!disabled && (mode === 'inherit' || mode === 'auto' || mode === 'smart'))
              onChange({ ...selection, modelSelection: mode, agentId: undefined })
          }}
        />
      }
      <Choice
        label="Agent"
        value={taskHarnessSelection(task)}
        selectedLabel={selection.name}
        items={taskHarnessChoices(
          task,
          agents,
          snapshot.acpInstallations,
          snapshot.defaults?.modelPreferences,
          availability.available,
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
      {(availability.loading || availability.error || !availability.available.size) && (
        <Text style={styles.muted}>
          {availability.loading
            ? 'Checking available providers…'
            : availability.error
              ? `Could not check available providers: ${availability.error}`
              : 'No providers available on this runtime. Configure agents in Settings.'}
        </Text>
      )}
      {(selection.modelSelection === 'auto' || selection.modelSelection === 'smart') && (
        <Choice
          label="Difficulty"
          value={selection.modelSelectionDifficulty ?? 'auto'}
          items={[...automaticDifficultyChoices]}
          disabled={disabled}
          onChange={(reasoning) => {
            if (!disabled)
              onChange({
                ...selection,
                modelSelectionDifficulty: decode(taskModelSelectionDifficultySchema, reasoning),
              })
          }}
        />
      )}
      {selection.modelSelection !== 'auto' && selection.modelSelection !== 'smart' && (
        <ModelSettings
          agent={agent}
          disabled={disabled}
          onChange={(next) => {
            if (!disabled)
              onChange({
                ...selection,
                modelSelection: undefined,
                model: next.model,
                harness: decode(taskHarnessSchema, next),
              })
          }}
        />
      )}
      <Choice
        label="Access mode"
        selectedLabel={permissionPolicyLabel(agent)}
        value={permissionPolicyLabel(agent) === 'Custom' ? 'custom' : agent.permission}
        disabled={disabled}
        items={selectableAccessModes(agent.permission, agent.provider)
          .filter((mode) => supportsAccess(agent.provider, mode.id))
          .map((mode) => ({ id: mode.id, name: mode.name }))}
        onChange={(permission) => {
          const mode = selectableAccessModes(agent.permission, agent.provider).find(
            (mode) => mode.id === permission,
          )
          if (mode && !disabled && supportsAccess(agent.provider, mode.id))
            onChange({ ...selection, harness: selectPermissionPreset(harness, mode.id) })
        }}
      />
      <PermissionPolicyControls
        value={agent}
        supported={snapshot.permissionPolicySupported === true}
        disabled={disabled}
        onChange={(policy) => {
          if (!disabled) onChange({ ...selection, harness: { ...harness, ...policy } })
        }}
      />
    </View>
  )
}
