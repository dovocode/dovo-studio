import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  acpHarnessChoiceId,
  continueHarnessSchema,
  agentSchema,
  decode,
  defaultTaskHarness,
  permissionPolicyLabel,
  resolveScopedAgents,
  resolveTaskAgent,
  responses,
  selectableAccessModes,
  selectPermissionPreset,
  supportsAccess,
  taskHarnessSchema,
  type Agent,
  type Repository,
  type Task,
} from '@dovo/protocol'
import { HarnessModelPicker } from '../../agents/harness-model-picker'
import { permissionPolicyUIIssue } from '../../agents/permission-policy-controls'
import { useHarnessAvailability } from '../../agents/use-harness-availability'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Switch } from '../../ui/controls/switch'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'
import {
  harnessNames,
  taskHarnessChoices,
  harnessHandoffSelectionTask,
} from '../creation/harness-choices'

/** Shared wording, so both choices describe the same handoff rules. */
const keptHere = 'Provider sessions and credentials stay on this computer.'

/** The runtime rejects these moves; say why before the user configures a transfer. */
function machineMoveBlocker(task: Task, repository: Repository | undefined) {
  if (!repository || repository.kind === 'scratch')
    return 'Threads without a project folder stay on this computer.'
  const links = [
    task.pullRequest && 'pull request',
    task.workItem && 'work item',
    (task.linkedCheckouts?.length || task.pendingLinkedCheckouts?.length) && 'linked projects',
  ].filter((link): link is string => !!link)
  if (links.length)
    return `Unlink the ${links.join(', ').replace(/, ([^,]*)$/, ' and $1')} to move this thread.`
  return undefined
}

/** Built-in harness entries only: a handoff sends a plain harness, not a saved agent. */
const harnessSelection = (agent: Agent) =>
  agent.provider === 'acp' && agent.acpInstallationId
    ? acpHarnessChoiceId(agent.acpInstallationId)
    : `harness:${agent.provider}`

/**
 * A draft-shaped view of the thread with the chosen harness. It lists every harness for an
 * explicit handoff only; ordinary harness settings keep the thread's provider lock.
 */

/** Continue a started thread with another harness, or on another computer. */
export function ContinueElsewhere({
  task,
  repository,
  onMachine,
  onClose,
}: {
  task: Task
  repository: Repository | undefined
  /** Opens the project transfer flow in continuation mode. */
  onMachine: () => void
  onClose: () => void
}) {
  const { styles, colors } = useTheme()
  const { snapshot, connected, call } = useRuntime()
  const [step, setStep] = useState<'choose' | 'harness'>('choose')
  const machineUnavailable = machineMoveBlocker(task, repository)
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId),
    snapshot?.workspace.agents ?? [],
  )
  const [agent, setAgent] = useState<Agent>(
    () =>
      resolveTaskAgent(task, agents) ?? {
        ...defaultTaskHarness('codex'),
        id: 'task',
        name: harnessNames.codex,
      },
  )
  const [stop, setStop] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  // An uncertain reply is retried with the identical payload, even if the turn stopped since.
  // Only a changed choice starts a new request.
  const attempt = useRef<{ key: string; payload: typeof continueHarnessSchema.Type } | null>(null)
  const availability = useHarnessAvailability(task.repositoryId, agents)
  const view = harnessHandoffSelectionTask(task, agent)
  const selection = harnessSelection(agent)
  const choices = taskHarnessChoices(
    view,
    agents,
    snapshot?.acpInstallations ?? [],
    snapshot?.defaults?.modelPreferences,
    availability.available,
    true,
  ).filter((choice) => !choice.id.startsWith('agent:'))
  const running = task.status === 'running'
  const queued = !!task.queue?.length
  const harness = decode(taskHarnessSchema, agent)
  const policyIssue = permissionPolicyUIIssue(agent, snapshot?.permissionPolicySupported === true)
  const blocked =
    !connected ||
    busy ||
    queued ||
    (running && !stop) ||
    !!policyIssue ||
    !supportsAccess(agent.provider, agent.permission) ||
    !choices.some((choice) => choice.id === selection)
  const name = harnessNames[agent.provider]
  const submit = async () => {
    if (blocked) return
    const key = JSON.stringify([harness, stop])
    if (attempt.current?.key !== key)
      attempt.current = {
        key,
        payload: { id: task.id, requestId: randomUUID(), harness: harness, stop: running && stop },
      }
    const { payload } = attempt.current
    setBusy(true)
    setError('')
    try {
      await call('/api/tasks/continue-harness', payload, responses.ok)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const option = (title: string, description: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 4,
        padding: 12,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={[styles.text, { fontWeight: '600' }]}>{title}</Text>
      <Text style={styles.muted}>{description}</Text>
    </Pressable>
  )
  return (
    <Sheet
      title={step === 'choose' ? 'Continue elsewhere' : 'Continue with another harness'}
      onClose={onClose}
      busy={busy}
    >
      {step === 'choose' ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.muted}>
            Continue “{task.title}” with the full saved conversation, checklist and files.
          </Text>
          {option(
            'Another harness on this computer',
            'Choose any harness and model. The thread stays here.',
            () => {
              setError('')
              setStep('harness')
            },
            !connected,
          )}
          {option(
            'Another computer',
            machineUnavailable ??
              'Move the thread and its checkout to a paired computer. This copy stays read-only for recovery.',
            onMachine,
            !connected || !!machineUnavailable,
          )}
          {!connected && <Text style={styles.muted}>Connect to this computer to continue.</Text>}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={styles.muted}>
            Your next message starts a new {name} session from the saved conversation, checklist and
            attachments. Earlier turns keep their original harness. {keptHere}
          </Text>
          <HarnessModelPicker
            task={view}
            agents={agents}
            choices={choices}
            selection={selection}
            agent={agent}
            disabled={busy || !connected}
            options={
              <Choice
                row
                label="Access mode"
                value={permissionPolicyLabel(agent) === 'Custom' ? 'custom' : agent.permission}
                selectedLabel={permissionPolicyLabel(agent)}
                disabled={busy || !connected}
                items={selectableAccessModes(agent.permission, agent.provider)
                  .filter((mode) => supportsAccess(agent.provider, mode.id))
                  .map((mode) => ({ id: mode.id, name: mode.name }))}
                onChange={(value) =>
                  setAgent(
                    selectPermissionPreset(agent, decode(agentSchema.fields.permission, value)),
                  )
                }
              />
            }
            onChange={(_selection, next) => setAgent(next)}
          />
          {availability.loading && <Text style={styles.muted}>Checking available providers…</Text>}
          {running && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.text, { flex: 1 }]}>Stop the current turn first</Text>
              <Switch
                accessibilityLabel="Stop the current turn first"
                value={stop}
                disabled={busy}
                onValueChange={setStop}
              />
            </View>
          )}
          {queued && (
            <Text accessibilityRole="alert" style={styles.error}>
              Send or remove the queued messages before you change the harness.
            </Text>
          )}
          {!!policyIssue && (
            <Text accessibilityRole="alert" style={styles.error}>
              {policyIssue}
            </Text>
          )}
          <Action
            wide
            label={busy ? 'Switching…' : `Continue with ${name}`}
            disabled={blocked}
            onPress={() => void submit()}
          />
          <Action secondary label="Back" disabled={busy} onPress={() => setStep('choose')} />
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Sheet>
  )
}
