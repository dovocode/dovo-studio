import { HarnessModelPicker } from '../../agents/harness-model-picker'
import {
  taskModelSelectionDifficultySchema,
  automaticDifficultyChoices,
  selectPermissionPreset,
  permissionPolicyLabel,
  changeTaskModelSelection,
  canChangeTaskCheckout,
  applyTurnSettings,
  agentTurnSettings,
  type TurnSettings,
} from '@dovo/protocol'
import { mobileWorkflow } from '../../runtime/state/native-effect'
import { workspacePatchResultSchema } from '@dovo/protocol'
import { resolveScopedAgents, decode } from '@dovo/protocol'
import { useEffect, useState } from 'react'
import { Action } from '../../ui/controls/action'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import {
  selectableAccessModes,
  defaultTaskHarness,
  canChangeTaskProvider,
  lockedTaskProvider,
  resolveTaskAgent,
  supportsAccess,
  agentSchema,
  type Task,
  type Agent,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import {
  PermissionPolicyControls,
  permissionPolicyUIIssue,
} from '../../agents/permission-policy-controls'
import { ModelSettings } from '../../agents/model-settings'
import { useHarnessAvailability } from '../../agents/use-harness-availability'
import { Sheet } from '../../ui/layout/sheet'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import {
  harnessNames,
  taskHarnessChanges,
  taskHarnessChoices,
  taskHarnessSelection,
} from '../creation/harness-choices'
export function HarnessSettings({
  task,
  onClose,
  inline = false,
  onBusyChange,
  turn,
}: {
  task: Task
  onClose: () => void
  inline?: boolean
  onBusyChange?: (busy: boolean) => void
  turn?: { value: TurnSettings | null; onChange: (value: TurnSettings | null) => void }
}) {
  const { styles } = useTheme()
  const [turnError, setTurnError] = useState('')
  const [advanced, setAdvanced] = useState(false)

  const { snapshot, connected, profile, callEffect, previewTaskEffect } = useRuntime(),
    { act, busy, error } = useAction()
  useEffect(() => {
    // An inline editor must keep its enclosing sheet mounted until saving finishes.
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId),
    snapshot?.workspace.agents ?? [],
  )
  const defaultAgent = resolveTaskAgent(task, agents) ?? {
    ...defaultTaskHarness('codex'),
    id: 'task',
    name: 'Codex',
  }
  const agent = applyTurnSettings(defaultAgent, turn?.value ?? undefined)
  const selectionTask = turn?.value
    ? { ...task, agentId: '', agentOverrides: undefined, harness: agent, modelSelection: undefined }
    : task
  const selection = taskHarnessSelection(selectionTask)
  const custom = selection.startsWith('agent:')
  const installations = snapshot?.acpInstallations ?? []
  const availability = useHarnessAvailability(task.repositoryId, agents)
  const choices = taskHarnessChoices(
    task,
    agents,
    installations,
    snapshot?.defaults?.modelPreferences,
    availability.available,
    true,
  )
  const lockedProvider = lockedTaskProvider(task, agents)
  const providerLocked = !canChangeTaskProvider(task)
  const selectionAllowed = choices.some(
    (choice) => choice.id === selection && choice.provider === agent.provider,
  )
  const controlsDisabled =
    busy || (!turn && task.status === 'running') || !!task.archived || !connected
  const save = (next: Agent, nextSelection = selection) => {
    if (controlsDisabled) return
    if (turn) {
      const issue = permissionPolicyUIIssue(next, snapshot?.permissionPolicySupported === true)
      if (issue) {
        setTurnError(issue)
        return
      }
      if (
        next.provider !== defaultAgent.provider ||
        next.acpInstallationId !== defaultAgent.acpInstallationId
      )
        return
      setTurnError('')
      turn.onChange(agentTurnSettings(next, true))
      return
    }
    act(() =>
      mobileWorkflow(function* () {
        if (
          !choices.some(
            (choice) => choice.id === nextSelection && choice.provider === next.provider,
          )
        )
          throw new Error('Choose an available harness or agent.')
        const issue = permissionPolicyUIIssue(next, snapshot?.permissionPolicySupported === true)
        if (issue) throw new Error(issue)
        if (!supportsAccess(next.provider, next.permission))
          throw new Error('This access mode is unavailable for this harness.')
        if (!profile) throw new Error('This computer is no longer saved.')
        const changes = taskHarnessChanges(task, nextSelection, next)
        yield* previewTaskEffect(
          profile,
          task.id,
          {
            agentId: changes.agentId.after,
            harness: changes.harness.after,
            harnessCustomized: changes.harnessCustomized.after,
            modelSelection: undefined,
            agentOverrides: changes.agentOverrides.after ?? undefined,
          },
          callEffect(
            '/api/workspace',
            { collection: 'tasks', id: task.id, changes },
            workspacePatchResultSchema,
            'PATCH',
          ),
        )
      }),
    )
  }
  const content = (
    <>
      {/* The selection mode decides whether the picker below applies, so it leads. */}
      {!turn && canChangeTaskCheckout(task) && !task.delegation && (
        <Choice
          row
          label="Model selection"
          value={task.modelSelection ?? 'fixed'}
          disabled={controlsDisabled}
          items={[
            { id: 'fixed', name: 'Specific harness/model' },
            { id: 'inherit', name: 'Inherit' },
            ...(snapshot?.smartModelSelectionEnabled === true
              ? [
                  { id: 'auto', name: 'Tune', icon: 'tune' as const },
                  { id: 'smart', name: 'Maestro', icon: 'maestro' as const },
                ]
              : []),
          ]}
          onChange={(value) => {
            if (value === 'fixed') {
              act(() =>
                mobileWorkflow(function* () {
                  if (!profile) throw new Error('This computer is no longer saved.')
                  yield* previewTaskEffect(
                    profile,
                    task.id,
                    { modelSelection: undefined },
                    callEffect(
                      '/api/workspace',
                      {
                        collection: 'tasks',
                        id: task.id,
                        changes: {
                          modelSelection: { before: task.modelSelection ?? null, after: null },
                        },
                      },
                      workspacePatchResultSchema,
                      'PATCH',
                    ),
                  )
                  onClose()
                }),
              )
              return
            }
            if (value !== 'inherit' && value !== 'auto' && value !== 'smart') return
            act(() =>
              mobileWorkflow(function* () {
                if (!profile) throw new Error('This computer is no longer saved.')
                const next = changeTaskModelSelection(
                  task,
                  value,
                  snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId),
                  snapshot?.defaults,
                )
                yield* previewTaskEffect(
                  profile,
                  task.id,
                  {
                    modelSelection: value,
                    harness: next.harness,
                    agentId: '',
                    agentOverrides: undefined,
                    harnessCustomized: next.harnessCustomized,
                  },
                  callEffect(
                    '/api/workspace',
                    {
                      collection: 'tasks',
                      id: task.id,
                      changes: {
                        modelSelection: { before: task.modelSelection ?? null, after: value },
                        harness: { before: task.harness ?? null, after: next.harness },
                        agentId: { before: task.agentId, after: '' },
                        agentOverrides: { before: task.agentOverrides ?? null, after: null },
                        harnessCustomized: {
                          before: task.harnessCustomized ?? null,
                          after: next.harnessCustomized ?? null,
                        },
                      },
                    },
                    workspacePatchResultSchema,
                    'PATCH',
                  ),
                )
                if (value === 'inherit') onClose()
              }),
            )
          }}
        />
      )}
      {!turn && (task.modelSelection === 'auto' || task.modelSelection === 'smart') && (
        <Choice
          row
          label="Difficulty"
          value={task.modelSelectionDifficulty ?? 'auto'}
          items={[...automaticDifficultyChoices]}
          disabled={controlsDisabled}
          onChange={(reasoning) =>
            act(() =>
              mobileWorkflow(function* () {
                if (!profile) throw new Error('This computer is no longer saved.')
                const difficulty = decode(taskModelSelectionDifficultySchema, reasoning)
                yield* previewTaskEffect(
                  profile,
                  task.id,
                  { modelSelectionDifficulty: difficulty },
                  callEffect(
                    '/api/workspace',
                    {
                      collection: 'tasks',
                      id: task.id,
                      changes: {
                        modelSelectionDifficulty: {
                          before: task.modelSelectionDifficulty ?? null,
                          after: difficulty,
                        },
                      },
                    },
                    workspacePatchResultSchema,
                    'PATCH',
                  ),
                )
              }),
            )
          }
        />
      )}
      {!!(error || turnError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || turnError}
        </Text>
      )}
      {(turn || (task.modelSelection !== 'auto' && task.modelSelection !== 'smart')) && (
        <>
          {!advanced && (
            <>
              <HarnessModelPicker
                task={selectionTask}
                agents={agents}
                choices={choices}
                selection={selection}
                agent={agent}
                disabled={controlsDisabled}
                onChange={(value, next) => save(next, value)}
              />
              {(availability.loading || availability.error || !choices.length) && (
                <Text style={styles.muted}>
                  {availability.loading
                    ? 'Checking available providers…'
                    : availability.error
                      ? `Could not check available providers: ${availability.error}`
                      : !choices.length
                        ? 'No providers available on this runtime. Configure agents in Settings.'
                        : ''}
                </Text>
              )}
            </>
          )}
          <Action
            secondary
            label={advanced ? 'Back to models' : 'More settings'}
            onPress={() => setAdvanced(!advanced)}
          />
          {advanced && (
            <>
              <Text style={styles.muted}>
                {custom
                  ? `${agent.name} uses its saved instructions, skills and MCP servers. Model and access changes apply only to this task.`
                  : 'Choose a built-in provider, installed ACP agent or saved custom agent.'}
              </Text>
              {providerLocked && (
                <Text style={styles.muted}>
                  {lockedProvider
                    ? `This thread uses ${harnessNames[lockedProvider]}. Choose any ${harnessNames[lockedProvider]} agent or model; start a new task to change provider.`
                    : 'The provider is fixed after the first message. Start a new task to choose another provider.'}
                </Text>
              )}
              <ModelSettings
                selectionControls={false}
                agent={agent}
                onChange={save}
                disabled={controlsDisabled || !selectionAllowed}
              />
              <Choice
                row
                label="Access mode"
                value={permissionPolicyLabel(agent) === 'Custom' ? 'custom' : agent.permission}
                selectedLabel={permissionPolicyLabel(agent)}
                disabled={controlsDisabled || !selectionAllowed}
                items={selectableAccessModes(agent.permission, agent.provider)
                  .filter((mode) => supportsAccess(agent.provider, mode.id))
                  .map((mode) => ({
                    id: mode.id,
                    name: mode.name,
                  }))}
                onChange={(value) =>
                  save(selectPermissionPreset(agent, decode(agentSchema.fields.permission, value)))
                }
              />
              <Text style={styles.muted}>
                {
                  selectableAccessModes(agent.permission, agent.provider).find(
                    (mode) => mode.id === agent.permission,
                  )?.description
                }
              </Text>
              <PermissionPolicyControls
                value={agent}
                supported={snapshot?.permissionPolicySupported === true}
                disabled={controlsDisabled || !selectionAllowed}
                onChange={(policy) => save({ ...agent, ...policy })}
              />
              {!custom &&
                (agent.provider === 'opencode' ||
                  ['hermes', 'vibe', 'copilot', 'grok', 'muse'].includes(agent.provider) ||
                  (agent.provider === 'acp' && !agent.acpInstallationId)) && (
                  <Field
                    label={
                      agent.provider === 'hermes'
                        ? 'Hermes executable'
                        : agent.provider === 'acp'
                          ? 'ACP executable'
                          : agent.provider === 'opencode'
                            ? 'OpenCode server URL'
                            : 'Executable'
                    }
                    key={`${selection}:endpoint`}
                    defaultValue={agent.endpoint}
                    editable={!controlsDisabled && selectionAllowed}
                    onEndEditing={({ nativeEvent: { text: endpoint } }) =>
                      save({
                        ...agent,
                        endpoint,
                      })
                    }
                  />
                )}
              {!custom &&
                (['hermes', 'vibe', 'copilot', 'grok', 'muse'].includes(agent.provider) ||
                  (agent.provider === 'acp' && !agent.acpInstallationId)) && (
                  <Field
                    label="Arguments (one per line)"
                    key={`${selection}:args`}
                    defaultValue={agent.args?.join('\n') ?? ''}
                    multiline
                    editable={!controlsDisabled && selectionAllowed}
                    onEndEditing={({ nativeEvent: { text: value } }) =>
                      save({
                        ...agent,
                        args: value.split('\n').filter(Boolean),
                      })
                    }
                  />
                )}
            </>
          )}
          {!turn && task.status === 'running' ? (
            <Text style={styles.muted}>Stop the active turn to change model settings.</Text>
          ) : (
            <Text style={styles.muted}>
              Applies to {turn ? 'this message only' : 'the next turn'}.
            </Text>
          )}
          {turn?.value && (
            <Action
              secondary
              label="Use thread defaults"
              onPress={() => turn.onChange(null)}
              disabled={controlsDisabled}
            />
          )}
          {!selectionAllowed && (
            <Text accessibilityRole="alert" style={styles.error}>
              Choose an available {lockedProvider ? harnessNames[lockedProvider] : ''} harness or
              custom agent.
            </Text>
          )}
          {busy && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              Saving model settings…
            </Text>
          )}
        </>
      )}
    </>
  )
  return inline ? (
    <View
      style={{
        gap: 12,
      }}
    >
      {content}
    </View>
  ) : (
    <Sheet title={advanced ? 'Model settings' : 'Agent & model'} onClose={onClose} busy={busy}>
      {content}
    </Sheet>
  )
}
