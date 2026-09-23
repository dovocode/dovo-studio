import { Alert } from 'react-native'
import { z } from 'zod'
import {
  latestCompletedTaskTurn,
  hasUnviewedTaskCompletion,
  responses,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useAction } from '../ui/use-action'

export const snoozeOptions = [
  { hours: 1, label: 'Snooze 1 hour' },
  { hours: 4, label: 'Snooze 4 hours' },
  { hours: 24, label: 'Until tomorrow' },
] as const

type LifecycleChanges = Partial<{
  [Key in 'pinned' | 'archived' | 'snoozedUntil']: {
    before: Task[Key] | null
    after: Task[Key] | null
  }
}>

export function useTaskLifecycle(task: Task, runtimeId?: string, onDeleted?: () => void) {
  const { call, connected, activeId, overviews, readRuntime, refreshRuntime } = useRuntime()
  const { act, busy, error } = useAction()
  const onCurrentRuntime = runtimeId === undefined || runtimeId === activeId
  const enabled = connected && onCurrentRuntime
  const owner = overviews.find((entry) => entry.profile.id === (runtimeId ?? activeId))
  const completed = latestCompletedTaskTurn(task)
  const unread = hasUnviewedTaskCompletion(task)
  const readStateEnabled = !!owner?.connected && !!completed && !task.archived && !task.example
  const patch = (changes: LifecycleChanges) => {
    if (!enabled) throw new Error('Reconnect to this task’s device before changing it.')
    return call(
      '/api/workspace',
      { collection: 'tasks', id: task.id, changes },
      z.object({ revision: z.number() }),
      'PATCH',
    )
  }
  return {
    busy,
    error,
    enabled,
    onCurrentRuntime,
    readStateEnabled,
    unread,
    toggleRead: () =>
      act(async () => {
        if (!readStateEnabled || !owner || !completed)
          throw new Error('Reconnect to this task’s device before changing its read status.')
        await readRuntime(
          owner.profile,
          '/api/tasks/viewed',
          {
            id: task.id,
            turnId: completed.id,
            viewed: unread,
            expectedRevision: task.viewedRevision ?? 0,
          },
          responses.ok,
        )
        await refreshRuntime(owner.profile)
      }),
    toggleArchived: () =>
      act(() =>
        call(
          '/api/tasks/lifecycle',
          {
            id: task.id,
            action: task.archivedAt ? 'restore' : 'archive',
          },
          responses.ok,
        ),
      ),
    deleteThread: () =>
      Alert.alert(
        'Delete thread?',
        `“${task.title}” and its conversation will be permanently deleted. Project files and worktrees stay on disk.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              act(async () => {
                await call('/api/tasks/lifecycle', { id: task.id, action: 'delete' }, responses.ok)
                onDeleted?.()
              }),
          },
        ],
      ),
    togglePinned: () =>
      act(() => patch({ pinned: { before: task.pinned ?? null, after: !task.pinned } })),
    toggleSettled: () =>
      act(() => {
        if (task.status === 'running') throw new Error('Stop the task before settling it.')
        return patch({
          archived: { before: task.archived ?? null, after: !task.archived },
          snoozedUntil: { before: task.snoozedUntil ?? null, after: null },
        })
      }),
    snooze: (until: string | null) =>
      act(() => patch({ snoozedUntil: { before: task.snoozedUntil ?? null, after: until } })),
  }
}

export type TaskLifecycle = ReturnType<typeof useTaskLifecycle>
