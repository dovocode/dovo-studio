import { useEffect, useRef, useState } from 'react'
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
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const attempted = useRef('')
  useEffect(() => {
    if (!visible || !connected) {
      attempted.current = ''
      return
    }
    if (!turnId) return
    let stopped = false
    let pending = false
    let acknowledged = false
    const modalOpen = () =>
      [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
        (dialog) => dialog.getClientRects().length > 0,
      )
    let covered = modalOpen()
    const acknowledge = async () => {
      if (
        stopped ||
        pending ||
        acknowledged ||
        attempted.current === completion ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        modalOpen()
      )
        return
      // Preserve an explicit Mark unread action until this conversation is revisited.
      // Snapshot updates alone must not acknowledge the same completion again.
      attempted.current = completion
      if (!unread) return
      pending = true
      try {
        await request('/api/tasks/viewed', { id: task.id, turnId, expectedRevision }, responses.ok)
        acknowledged = true
        if (!stopped) setFailure(null)
      } catch (error) {
        if (!stopped)
          setFailure({
            identity,
            message: error instanceof Error ? error.message : String(error),
          })
      } finally {
        pending = false
      }
    }
    const onVisible = () => void acknowledge()
    const onInactive = () => {
      attempted.current = ''
      acknowledged = false
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onVisible()
      else onInactive()
    }
    onVisible()
    window.addEventListener('focus', onVisible)
    window.addEventListener('blur', onInactive)
    document.addEventListener('visibilitychange', onVisibilityChange)
    // A modal can close without a window-focus event. Retry only when it reveals the chat,
    // not on every DOM mutation (including an acknowledgement failure message).
    const observer = new MutationObserver(() => {
      const next = modalOpen()
      if (covered && !next) onVisible()
      covered = next
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'hidden', 'data-state'],
    })
    return () => {
      stopped = true
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('blur', onInactive)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer.disconnect()
    }
  }, [
    request,
    connected,
    visible,
    task.id,
    turnId,
    unread,
    expectedRevision,
    identity,
    completion,
    attempt,
  ])
  return {
    error: unread && failure?.identity === identity ? failure.message : '',
    retry: () => {
      attempted.current = ''
      setAttempt((value) => value + 1)
    },
  }
}
