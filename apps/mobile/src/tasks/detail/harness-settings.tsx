import { mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { resolveScopedAgents, decode } from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Schema } from 'effect'
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
import { ModelSettings } from '../../agents/model-settings'
import { Sheet } from '../../ui/layout/sheet'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { styles } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import {
  harnessNames,
  selectedTaskHarness,
  taskHarnessChanges,
  taskHarnessChoices,
  taskHarnessSelection,
} from '../creation/harness-choices'
export function HarnessSettings({
  task,
  onClose,
  inline = false,
  onBusyChange,
}: {
  task: Task
  onClose: () => void
  inline?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const { snapshot, connected, callEffect } = useRuntime(),
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
  const [selection, setSelection] = useApplicationState(() => taskHarnessSelection(task))
  const [agent, setAgent] = useApplicationState<Agent>(
    () =>
      resolveTaskAgent(task, agents) ?? {
        ...defaultTaskHarness('codex'),
        id: 'task',
        name: 'Codex',
      },
  )
  const custom = selection.startsWith('agent:')
  const installations = snapshot?.acpInstallations ?? []
  const choices = taskHarnessChoices(
    task,
    agents,
    installations,
    snapshot?.defaults?.modelPreferences,
  )
  const lockedProvider = lockedTaskProvider(task, agents)
  const providerLocked = !canChangeTaskProvider(task)
  const selectionAllowed = choices.some(
    (choice) => choice.id === selection && choice.provider === agent.provider,
  )
  const controlsDisabled = busy || task.status === 'running' || !!task.archived || !connected
  const content = (
    <>
      <Choice
        row
        label="Agent"
        value={selection}
        disabled={controlsDisabled || !choices.length}
        items={choices}
        onChange={(value) => {
          if (controlsDisabled || value === selection) return
          const next = selectedTaskHarness(task, agents, value, installations)
          if (!next) return
          setSelection(value)
          setAgent(next)
        }}
      />
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
        agent={agent}
        onChange={setAgent}
        disabled={controlsDisabled || !selectionAllowed}
      />
      <Choice
        row
        label="Access"
        value={agent.permission}
        disabled={controlsDisabled || !selectionAllowed}
        items={selectableAccessModes(agent.permission)
          .filter((mode) => supportsAccess(agent.provider, mode.id))
          .map((mode) => ({
            id: mode.id,
            name: mode.name,
          }))}
        onChange={(value) =>
          setAgent({
            ...agent,
            permission: decode(agentSchema.fields.permission, value),
          })
        }
      />
      <Text style={styles.muted}>
        {
          selectableAccessModes(agent.permission).find((mode) => mode.id === agent.permission)
            ?.description
        }
      </Text>
      {!custom &&
        (agent.provider === 'opencode' ||
          ['hermes', 'copilot', 'grok', 'muse'].includes(agent.provider) ||
          (agent.provider === 'acp' && !agent.acpInstallationId)) && (
          <Field
            label={
              agent.provider === 'hermes'
                ? 'Hermes Python executable'
                : agent.provider === 'acp'
                  ? 'ACP executable'
                  : agent.provider === 'opencode'
                    ? 'OpenCode server URL'
                    : 'Executable'
            }
            value={agent.endpoint}
            editable={!controlsDisabled && selectionAllowed}
            onChangeText={(endpoint) =>
              setAgent({
                ...agent,
                endpoint,
              })
            }
          />
        )}
      {!custom &&
        (['hermes', 'copilot', 'grok', 'muse'].includes(agent.provider) ||
          (agent.provider === 'acp' && !agent.acpInstallationId)) && (
          <Field
            label="Arguments (one per line)"
            value={agent.args?.join('\n') ?? ''}
            multiline
            editable={!controlsDisabled && selectionAllowed}
            onChangeText={(value) =>
              setAgent({
                ...agent,
                args: value.split('\n').filter(Boolean),
              })
            }
          />
        )}
      {task.status === 'running' ? (
        <Text style={styles.muted}>Stop the active turn to change model settings.</Text>
      ) : (
        <Text style={styles.muted}>Applies to the next turn.</Text>
      )}
      {!selectionAllowed && (
        <Text accessibilityRole="alert" style={styles.error}>
          Choose an available {lockedProvider ? harnessNames[lockedProvider] : ''} harness or custom
          agent before saving.
        </Text>
      )}
      {busy && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Saving model settings…
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Action
        label="Save agent & model"
        disabled={
          !connected ||
          busy ||
          task.status === 'running' ||
          !selectionAllowed ||
          !!task.archived ||
          !supportsAccess(agent.provider, agent.permission)
        }
        onPress={() =>
          act(() =>
            mobileWorkflow(function* () {
              if (controlsDisabled || !selectionAllowed) return
              yield* callEffect(
                '/api/workspace',
                {
                  collection: 'tasks',
                  id: task.id,
                  changes: taskHarnessChanges(task, selection, agent),
                },
                mutableStruct({
                  revision: Schema.Number.pipe(Schema.finite()),
                }),
                'PATCH',
              )
              onClose()
            }),
          )
        }
      />
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
    <Sheet title="Agent & model" onClose={onClose} busy={busy}>
      {content}
    </Sheet>
  )
}
