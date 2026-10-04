import type { Task } from '@dovo/protocol'
import type { AppPreferences } from './preferences'
export function projectActivity(
  tasks: readonly Task[],
  repositoryId: string,
  order: AppPreferences['projectOrder'],
) {
  return Math.max(
    0,
    ...tasks
      .filter((task) => task.repositoryId === repositoryId && !task.example)
      .map((task) =>
        Date.parse(
          order === 'user-message'
            ? (task.lastPromptAt ??
                [...task.messages].reverse().find((message) => message.role === 'user')
                  ?.createdAt ??
                task.createdAt)
            : (task.updatedAt ?? task.createdAt),
        ),
      )
      .filter(Number.isFinite),
  )
}
