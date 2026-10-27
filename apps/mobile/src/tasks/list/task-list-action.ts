import type { RuntimeProfile, Task } from '@dovo/protocol'

export type TaskListAction = 'settle' | 'snooze'

export function taskListActionHandlers(
  task: Task,
  profile: RuntimeProfile,
  supported: boolean,
  lifecycle: { toggleSettled: () => void; snooze: (until: string | null) => void },
  undo: (action: TaskListAction, task: Task, profile: RuntimeProfile, until?: string) => void,
) {
  return {
    toggleSettled: () =>
      task.archived || !supported ? lifecycle.toggleSettled() : undo('settle', task, profile),
    snooze: (until: string | null) =>
      until === null || !supported ? lifecycle.snooze(until) : undo('snooze', task, profile, until),
  }
}

export function taskListActionInput(action: TaskListAction, task: Task, until?: string) {
  return {
    action,
    id: task.id,
    expectedArchived: task.archived ?? null,
    expectedSnoozedUntil: task.snoozedUntil ?? null,
    snoozedUntil: action === 'snooze' ? (until ?? null) : null,
  }
}
