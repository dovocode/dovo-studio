import { readMobilePreferences } from '../runtime/app-preferences'
import { mobileWorkflow } from '../runtime/native-effect'
import { mutableStruct } from '@dovo/protocol'
import { Alert } from 'react-native'
import { Schema, Effect } from 'effect'
import {
  latestCompletedTaskTurn,
  hasUnviewedTaskCompletion,
  responses,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useAction } from '../ui/use-action'
export const snoozeOptions = [
  {
    hours: 1,
    label: 'Snooze 1 hour',
  },
  {
    hours: 4,
    label: 'Snooze 4 hours',
  },
  {
    hours: 24,
    label: 'Until tomorrow',
  },
] as const
type LifecycleChanges = Partial<{
  [Key in 'pinned' | 'archived' | 'snoozedUntil']: {
    before: Task[Key] | null
    after: Task[Key] | null
  }
}>
export function useTaskLifecycle(task: Task, runtimeId?: string, onDeleted?: () => void) {
  const {
    previewTaskEffect,
    connected,
    activeId,
    overviews,
    readRuntimeEffect,
    refreshRuntimeEffect,
    callEffect,
  } = useRuntime()
  const { act, busy, error } = useAction()
  const onCurrentRuntime = runtimeId === undefined || runtimeId === activeId
  const enabled = connected && onCurrentRuntime
  const owner = overviews.find((entry) => entry.profile.id === (runtimeId ?? activeId))
  const completed = latestCompletedTaskTurn(task)
  const unread = hasUnviewedTaskCompletion(task)
  const readStateEnabled = !!owner?.connected && !!completed && !task.archived && !task.example
  const patch = (changes: LifecycleChanges) => {
    if (!enabled) throw new Error('Reconnect to this task’s device before changing it.')
    if (!owner) throw new Error('This computer is no longer saved.')
    return previewTaskEffect(
      owner.profile,
      task.id,
      {
        ...(changes.pinned ? { pinned: changes.pinned.after ?? false } : {}),
        ...(changes.archived ? { archived: changes.archived.after ?? false } : {}),
        ...(changes.snoozedUntil ? { snoozedUntil: changes.snoozedUntil.after ?? undefined } : {}),
      },
      callEffect(
        '/api/workspace',
        {
          collection: 'tasks',
          id: task.id,
          changes,
        },
        mutableStruct({
          revision: Schema.Number.pipe(Schema.finite()),
        }),
        'PATCH',
      ),
    ).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          // Settling or snoozing can unmount the row that owns useAction's inline error.
          if (changes.archived?.after || changes.snoozedUntil?.after)
            Alert.alert('Could not update thread', error.message)
        }),
      ),
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
      act(() =>
        mobileWorkflow(function* () {
          if (!readStateEnabled || !owner || !completed)
            return yield* Effect.fail(
              new Error('Reconnect to this task’s device before changing its read status.'),
            )
          yield* readRuntimeEffect(
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
          yield* refreshRuntimeEffect(owner.profile)
        }),
      ),
    toggleArchived: () => {
      const run = () =>
        act(() =>
          callEffect(
            '/api/tasks/lifecycle',
            {
              id: task.id,
              action: task.archivedAt ? 'restore' : 'archive',
            },
            responses.ok,
          ),
        )
      // Settings → General → Confirm before archiving a task.
      if (task.archivedAt || !readMobilePreferences().confirmArchive) return run()
      Alert.alert(
        `Archive “${task.title}”?`,
        'You can restore it from Settings → Archived tasks.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', onPress: run },
        ],
      )
    },
    deleteThread: () =>
      Alert.alert(
        'Delete thread?',
        `“${task.title}” and its conversation will be permanently deleted. Project files and worktrees stay on disk.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              act(() =>
                mobileWorkflow(function* () {
                  yield* callEffect(
                    '/api/tasks/lifecycle',
                    {
                      id: task.id,
                      action: 'delete',
                    },
                    responses.ok,
                  )
                  onDeleted?.()
                }),
              ),
          },
        ],
      ),
    togglePinned: () =>
      act(() =>
        patch({
          pinned: {
            before: task.pinned ?? null,
            after: !task.pinned,
          },
        }),
      ),
    toggleSettled: () =>
      act(() => {
        if (task.status === 'running') throw new Error('Stop the task before settling it.')
        return patch({
          archived: {
            before: task.archived ?? null,
            after: !task.archived,
          },
          snoozedUntil: {
            before: task.snoozedUntil ?? null,
            after: null,
          },
        })
      }),
    snooze: (until: string | null) =>
      act(() =>
        patch({
          snoozedUntil: {
            before: task.snoozedUntil ?? null,
            after: until,
          },
        }),
      ),
  }
}
export type TaskLifecycle = ReturnType<typeof useTaskLifecycle>
