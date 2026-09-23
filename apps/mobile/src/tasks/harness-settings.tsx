import { mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { Schema } from 'effect'
import {
  accessModes,
  defaultTaskHarness,
  canChangeTaskProvider,
  lockedTaskProvider,
  resolveTaskAgent,
  supportsAccess,
  agentSchema,
  type Task,
  type Agent,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { ModelSettings } from '../agents/model-settings'
import { Sheet } from '../ui/sheet'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import {
  harnessNames,
  selectedTaskHarness,
  taskHarnessChanges,
  taskHarnessChoices,
  taskHarnessSelection,
} from './harness-choices'
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
  const [selection, setSelection] = useApplicationState(() => taskHarnessSelection(task))
  const [agent, setAgent] = useApplicationState<Agent>(
    () =>
      resolveTaskAgent(task, snapshot?.workspace.agents ?? []) ?? {
        ...defaultTaskHarness('codex'),
        id: 'task',
        name: 'Codex',
      },
  )
  const custom = selection.startsWith('agent:')
  const agents = snapshot?.workspace.agents ?? []
  const choices = taskHarnessChoices(task, agents)
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
          const next = selectedTaskHarness(task, agents, value)
          if (!next) return
          setSelection(value)
          setAgent(next)
        }}
      />
      <Text style={styles.muted}>
        {custom
          ? `${agent.name} uses its saved instructions, skills and MCP servers. Model and access changes apply only to this task.`
          : 'Choose a built-in agent or one of your saved custom agents.'}
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
        items={accessModes
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
        {accessModes.find((mode) => mode.id === agent.permission)?.description}
      </Text>
      {!custom && (agent.provider === 'acp' || agent.provider === 'opencode') && (
        <Field
          label={agent.provider === 'acp' ? 'ACP executable' : 'OpenCode server URL'}
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
      {!custom && agent.provider === 'acp' && (
        <Field
          label="ACP arguments (one per line)"
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
