import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  workTaskInputSchema,
  workTaskResponseSchema,
  type ForgeIssue,
  type ForgePipeline,
  type WorkTaskInput,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { WorkMenu } from './work-menu'
import { Sheet } from '../ui/sheet'
import { Choice } from '../ui/choice'

export function WorkTaskAction({
  repositoryId,
  jiraSourceId,
  source,
  disabled,
}: {
  repositoryId?: string
  jiraSourceId?: string
  source: { kind: 'issue'; item: ForgeIssue } | { kind: 'pipeline'; item: ForgePipeline }
  disabled: boolean
}) {
  const { call, refresh, snapshot, activeId } = useRuntime()
  const { navigate, focused } = useNavigation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [destination, setDestination] = useState('')
  const projects = snapshot?.workspace.repositories ?? []
  const pending = useRef(false)
  const attempt = useRef<WorkTaskInput | undefined>(undefined)
  const current = useRef(true)
  useEffect(() => {
    current.current = true
    return () => {
      current.current = false
    }
  }, [])
  const linked =
    snapshot?.workspace.tasks.filter(
      (task) =>
        (jiraSourceId
          ? task.workItem?.kind === 'issue' && task.workItem.jiraSourceId === jiraSourceId
          : task.repositoryId === repositoryId) &&
        task.workItem?.kind === source.kind &&
        task.workItem.url === source.item.url,
    ) ?? []
  useEffect(() => {
    if (focused && created && snapshot?.workspace.tasks.some((task) => task.id === created)) {
      setCreated('')
      navigate('tasks', created, activeId ?? undefined)
    }
  }, [created, snapshot, navigate, activeId, focused])
  const create = async (targetId = repositoryId) => {
    if (pending.current || disabled || !focused) return
    if (!targetId && !attempt.current && !created) {
      setDestination(projects.length === 1 ? projects[0]!.id : '')
      setChoosing(true)
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (created) {
        await refresh()
        return
      }
      const input =
        attempt.current ??
        workTaskInputSchema.parse({
          repositoryId: targetId,
          ...(jiraSourceId ? { jiraSourceId } : {}),
          requestId: randomUUID(),
          kind: source.kind,
          id: source.item.id,
          url: source.item.url,
          ...(source.kind === 'issue'
            ? { revision: source.item.revision }
            : { sha: source.item.sha }),
        })
      attempt.current = input
      const result = await call('/api/scm/work/task', input, workTaskResponseSchema)
      attempt.current = undefined
      if (!current.current) return
      setChoosing(false)
      setCreated(result.id)
      await refresh()
    } catch (cause) {
      if (current.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      if (current.current) setBusy(false)
    }
  }
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.row, { flexWrap: 'nowrap' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {linked[0] ? (
            <Action label="Open linked task" onPress={() => navigate('tasks', linked[0]!.id)} />
          ) : (
            <Action
              label={
                busy ? 'Opening task…' : source.kind === 'issue' ? 'Start task' : 'Investigate run'
              }
              disabled={disabled || busy}
              onPress={() => void create()}
            />
          )}
        </View>
        {!!linked.length && (
          <WorkMenu
            label="Linked tasks"
            actions={[
              ...linked.map((task) => ({
                label: task.title,
                onPress: () => navigate('tasks', task.id),
              })),
              {
                label: busy ? 'Opening task…' : 'Start another task',
                disabled: disabled || busy,
                onPress: () => void create(),
              },
            ]}
          />
        )}
      </View>
      {!!linked[0] && (
        <Text numberOfLines={1} style={styles.muted}>
          {linked[0].title}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {choosing && (
        <Sheet title="Start task in a project" busy={busy} onClose={() => setChoosing(false)}>
          <Text style={styles.muted}>
            Choose the codebase for this task. The issue stays in Jira.
          </Text>
          <Choice
            label="Dovo project"
            value={destination}
            onChange={setDestination}
            disabled={busy || !!attempt.current}
            items={[
              { id: '', name: 'Choose a project…' },
              ...projects.map((project) => ({ id: project.id, name: project.name })),
            ]}
          />
          {!projects.length && (
            <Text style={styles.muted}>
              Add a project to this computer first. You can keep working with Jira issues without
              one.
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={busy ? 'Opening task…' : 'Start task'}
            disabled={disabled || busy || !destination}
            onPress={() => void create(destination)}
          />
        </Sheet>
      )}
    </View>
  )
}
