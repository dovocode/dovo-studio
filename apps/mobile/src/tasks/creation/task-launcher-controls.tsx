import {
  taskModelSelectionDifficultySchema,
  selectPermissionPreset,
  permissionPolicyLabel,
  modelDisplayName,
} from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { Sheet } from '../../ui/layout/sheet'
import { HarnessIcon } from '../../agents/harness-icon'
import { useState, type ComponentProps } from 'react'
import { Action } from '../../ui/controls/action'
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
import { HarnessModelPicker } from '../../agents/harness-model-picker'
import { ModelSettings } from '../../agents/model-settings'
import { useHarnessAvailability } from '../../agents/use-harness-availability'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { Choice } from '../../ui/controls/choice'
import { taskHarnessChoices, taskHarnessSelection } from './harness-choices'

export function TaskLauncherPicker(props: ComponentProps<typeof TaskLauncherControls>) {
  const [open, setOpen] = useState(false)
  const { colors } = useTheme()
  const { selection, disabled } = props
  const model =
    selection.modelSelection === 'auto'
      ? 'Tune'
      : selection.modelSelection === 'smart'
        ? 'Maestro'
        : selection.modelSelection === 'inherit'
          ? 'Inherit'
          : modelDisplayName(selection.model ?? selection.harness?.model ?? '') ||
            'Provider default'
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose agent and model"
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <HarnessIcon provider={selection.provider} size={18} />
        <Text style={{ flex: 1, color: colors.text }}>
          {selection.name} · {model}
        </Text>
        <Text style={{ color: colors.muted }}>⌄</Text>
      </Pressable>
      {open && (
        <Sheet title="Agent & model" onClose={() => setOpen(false)}>
          <TaskLauncherControls {...props} />
        </Sheet>
      )}
    </>
  )
}

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
  const [advanced, setAdvanced] = useState(false)

  const harness = selection.harness ?? defaultTaskHarness(selection.provider)
  const task = createLauncherTask(snapshot, repository, selection, '', 'launcher-selection')
  const agents = resolveScopedAgents(snapshot.defaults, repository, snapshot.workspace.agents)
  const agent = { ...harness, id: selection.agentId ?? 'launcher', name: selection.name }
  const availability = useHarnessAvailability(repository.id, agents)
  return (
    <View style={{ gap: 12 }}>
      {(advanced ||
        selection.modelSelection === 'auto' ||
        selection.modelSelection === 'smart') && (
        <Choice
          label="Model selection"
          value={selection.modelSelection ?? 'fixed'}
          disabled={disabled}
          items={[
            { id: 'fixed', name: 'Specific harness/model' },
            { id: 'inherit', name: 'Inherit' },
            ...(snapshot.smartModelSelectionEnabled === true
              ? [
                  { id: 'auto', name: 'Tune', icon: 'tune' as const },
                  { id: 'smart', name: 'Maestro', icon: 'maestro' as const },
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
      )}
      {!advanced && (
        <>
          <HarnessModelPicker
            task={task}
            agents={agents}
            selection={taskHarnessSelection(task)}
            agent={agent}
            choices={taskHarnessChoices(
              task,
              agents,
              snapshot.acpInstallations,
              snapshot.defaults?.modelPreferences,
              availability.available,
            )}
            disabled={disabled}
            onChange={(id, next) => {
              if (disabled) return
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
        </>
      )}
      <Action
        secondary
        label={advanced ? 'Back to models' : 'More settings'}
        onPress={() => setAdvanced(!advanced)}
      />
      {(advanced ||
        selection.modelSelection === 'auto' ||
        selection.modelSelection === 'smart') && (
        <>
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
              selectionControls={false}
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
        </>
      )}
    </View>
  )
}
