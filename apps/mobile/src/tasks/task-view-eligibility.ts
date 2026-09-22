import { hasUnviewedTaskCompletion, latestCompletedTaskTurn, type Task } from '@dovo/protocol'

export function viewedTaskTurn(
  task: Task,
  visibility: {
    focused: boolean
    chatVisible: boolean
    appActive: boolean
    connected: boolean
    ownerMatches: boolean
  },
): string | undefined {
  if (
    !visibility.focused ||
    !visibility.chatVisible ||
    !visibility.appActive ||
    !visibility.connected ||
    !visibility.ownerMatches ||
    task.example ||
    !hasUnviewedTaskCompletion(task)
  )
    return undefined
  return latestCompletedTaskTurn(task)?.id
}
