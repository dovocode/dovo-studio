import { useForegroundCompletion } from '../../use-foreground-completion'
import { useCallback } from 'react'
import {
  clientScopeKey,
  hasUnviewedTaskCompletion,
  latestCompletedTaskTurn,
  responses,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'

/** Only a foreground conversation can acknowledge a completed response. */
export function useTaskViewed(task: Task, visible: boolean) {
  const { request, connected, connection, activeRuntimeId } = useWorkspace()
  const turnId = !task.archived ? latestCompletedTaskTurn(task)?.id : undefined
  const unread = hasUnviewedTaskCompletion(task)
  const expectedRevision = task.viewedRevision ?? 0
  const completion = JSON.stringify([activeRuntimeId, clientScopeKey(connection), task.id, turnId])
  const identity = JSON.stringify([
    activeRuntimeId,
    clientScopeKey(connection),
    task.id,
    turnId,
    expectedRevision,
  ])
  const write = useCallback(async () => {
    await request('/api/tasks/viewed', { id: task.id, turnId, expectedRevision }, responses.ok)
  }, [request, task.id, turnId, expectedRevision])
  return useForegroundCompletion(
    visible && connected && !!turnId,
    completion,
    identity,
    unread,
    write,
  )
}
