import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  randomUUID,
  resolveTaskAgent,
  transferOptionsSchema,
  transferPrepareSchema,
  moveTaskToComputer,
  abortTaskTransfer,
  type TransferPrepare,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { Sheet } from '../../ui/layout/sheet'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TaskTransfer({ task, onClose }: { task: Task; onClose: () => void }) {
  const runtime = useRuntime(),
    { navigate } = useNavigation(),
    { styles } = useTheme()
  const [selected, setSelected] = useState('')
  const [options, setOptions] = useState<typeof transferOptionsSchema.Type | null>(null)
  const [sourceIdentity, setSourceIdentity] = useState('')
  const [projectId, setProjectId] = useState(''),
    [agentId, setAgentId] = useState('')
  const [attempt, setAttempt] = useState<TransferPrepare | null>(null)
  const [mode, setMode] = useState<'native' | 'replay'>('native')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const profiles = runtime.profiles.filter((item) => item.id !== runtime.profile?.id)
  const profile = profiles.find((item) => item.id === selected)
  const agent = resolveTaskAgent(task, runtime.snapshot?.workspace.agents ?? [])
  const candidates = options?.projects.filter((item) => item.identity === sourceIdentity) ?? []
  const destination =
    candidates.find((item) => item.id === projectId) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  const agents =
    destination?.agents.filter(
      (item) => item.provider === agent?.provider && item.model === agent.model,
    ) ?? []
  const targetAgent =
    agents.find((item) => item.id === agentId) ?? (agents.length === 1 ? agents[0] : undefined)
  const source = runtime.profile
  const sourceCall: typeof runtime.read = (path, input, schema, method) =>
    source
      ? runtime.readRuntime(source, path, input, schema, method)
      : runtime.read(path, input, schema, method)
  useEffect(() => {
    let alive = true
    void sourceCall('/api/tasks/transfer/options', {}, transferOptionsSchema)
      .then((value) => {
        if (alive)
          setSourceIdentity(
            value.projects.find((item) => item.id === task.repositoryId)?.identity ?? '',
          )
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    if (task.transfer?.direction === 'out')
      void sourceCall('/api/tasks/transfer/read', { id: task.transfer.id }, transferPrepareSchema)
        .then((input) => {
          if (!alive) return
          setAttempt(input)
          setMode(input.mode)
          setProjectId(input.target.repositoryId)
          setAgentId(input.target.agentId)
          setSelected(
            profiles.find((item) => item.connection.address === input.target.address)?.id ?? '',
          )
        })
        .catch((cause) => {
          if (alive) setError(cause instanceof Error ? cause.message : String(cause))
        })
    return () => {
      alive = false
    }
  }, [task.id, task.transfer?.id])
  useEffect(() => {
    setOptions(null)
    if (!profile) return
    let alive = true
    void runtime
      .readRuntime(profile, '/api/tasks/transfer/options', {}, transferOptionsSchema)
      .then((value) => {
        if (alive) setOptions(value)
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      alive = false
    }
  }, [profile?.id])
  const act = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      if (source)
        await runtime
          .refreshRuntime(source)
          .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    }
  }
  const move = () =>
    act(async () => {
      if (!profile || !source) throw new Error('Choose a paired destination computer.')
      if (attempt && options?.runtimeId !== attempt.target.runtimeId)
        throw new Error('Choose the original destination computer to complete this move.')
      const input =
        attempt ??
        (options && destination && targetAgent
          ? {
              id: randomUUID(),
              taskId: task.id,
              sourceAddress: source.connection.address,
              target: {
                runtimeId: options.runtimeId,
                address: profile.connection.address,
                repositoryId: destination.id,
                agentId: targetAgent.id,
                taskId: randomUUID(),
              },
              mode,
            }
          : null)
      if (!input) throw new Error('Choose the matching project and agent.')
      setAttempt(input)
      const result = await moveTaskToComputer(
        sourceCall,
        (path, input, schema) => runtime.readRuntime(profile, path, input, schema),
        input,
      )
      await runtime.refreshRuntime(profile)
      onClose()
      navigate('tasks', result.id, profile.id)
    })
  const cancel = () =>
    act(async () => {
      if (!profile || !attempt) throw new Error('Reconnect the destination to cancel this move.')
      if (options?.runtimeId !== attempt.target.runtimeId)
        throw new Error('Choose the original destination computer to cancel this move.')
      await abortTaskTransfer(
        sourceCall,
        (path, input, schema) => runtime.readRuntime(profile, path, input, schema),
        attempt,
      )
      setAttempt(null)
      onClose()
    })
  const sealed = task.transfer?.direction === 'out' && task.transfer.state === 'sealed'
  return (
    <Sheet
      title={task.transfer?.direction === 'out' ? 'Complete move' : 'Move to computer'}
      busy={busy}
      onClose={onClose}
    >
      <View style={{ gap: 12 }}>
        <Text>
          The conversation and files move into a new worktree at the same commit. This computer
          keeps read-only history.
        </Text>
        <Text>Computer</Text>
        {profiles.map((item) => (
          <Action
            key={item.id}
            secondary={selected !== item.id}
            label={`${selected === item.id ? '✓ ' : ''}${item.name}`}
            disabled={busy}
            onPress={() => {
              setSelected(item.id)
              setProjectId('')
              setAgentId('')
              setError('')
            }}
          />
        ))}
        {options && !candidates.length && (
          <Text>No matching Git project. Add the same project on this computer.</Text>
        )}
        {candidates.map((item) => (
          <Action
            key={item.id}
            secondary={destination?.id !== item.id}
            label={item.name}
            disabled={busy || !!attempt}
            onPress={() => {
              setProjectId(item.id)
              setAgentId('')
            }}
          />
        ))}
        {destination && !agents.length && (
          <Text>Add an agent with the same provider and model on the destination.</Text>
        )}
        {agents.map((item) => (
          <Action
            key={item.id}
            secondary={targetAgent?.id !== item.id}
            label={item.name}
            disabled={busy || !!attempt}
            onPress={() => setAgentId(item.id)}
          />
        ))}
        <Text>Agent context</Text>
        <Action
          secondary={mode !== 'native'}
          label="Preserve native session (experimental, Codex / Claude)"
          disabled={busy || !!attempt}
          onPress={() => setMode('native')}
        />
        <Action
          secondary={mode !== 'replay'}
          label="Start a new session with conversation replay"
          disabled={busy || !!attempt}
          onPress={() => setMode('replay')}
        />
        <Text>
          Native continuation requires the same provider version. Replay may lose tool history and
          compacted context. Commit or stash changes and close task terminals first.
        </Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {sealed && (
          <Action
            secondary
            label="Open destination"
            disabled={busy || !profile || !attempt}
            onPress={() => {
              if (profile && attempt) {
                onClose()
                navigate('tasks', attempt.target.taskId, profile.id)
              }
            }}
          />
        )}
        {attempt && !sealed && (
          <Action
            secondary
            label="Cancel move"
            disabled={busy || !profile}
            onPress={() => void cancel()}
          />
        )}
        <Action
          label={busy ? 'Moving…' : attempt ? 'Retry move' : 'Move task'}
          disabled={
            busy ||
            !runtime.connected ||
            !profile ||
            (!attempt && !targetAgent) ||
            task.transfer?.state === 'aborting'
          }
          onPress={() => void move()}
        />
      </View>
    </Sheet>
  )
}
