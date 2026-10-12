import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import {
  createTaskReviewSession,
  taskReviewReportSchema,
  type TaskReviewSessionState,
} from '@dovo/protocol'
export function useTaskReview(taskId: string, version: string, enabled = true) {
  const { request, connected, activeRuntimeId } = useWorkspace()
  const key = JSON.stringify([activeRuntimeId, taskId])
  const [value, setValue] = useState<{ key: string; state: TaskReviewSessionState } | null>(null)
  const session = useRef<ReturnType<typeof createTaskReviewSession> | null>(null)
  useEffect(() => {
    if (!connected || !enabled) return
    const current = createTaskReviewSession(
      taskId,
      (path, input) => request(path, input, taskReviewReportSchema),
      (state) => setValue({ key, state }),
    )
    session.current = current
    const changed = () => current.visibility(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', changed)
    changed()
    return () => {
      current.stop()
      document.removeEventListener('visibilitychange', changed)
      if (session.current === current) session.current = null
    }
  }, [key, request, connected, enabled])
  useEffect(() => {
    void session.current?.refresh()
  }, [key, version])
  const state = value?.key === key ? value.state : null
  return {
    report: state?.report ?? null,
    busy: state?.busy ?? false,
    error: state?.error ?? '',
    refresh: () => session.current?.refresh(),
    run: (
      action: Parameters<ReturnType<typeof createTaskReviewSession>['run']>[0],
      input: Record<string, unknown>,
    ) => session.current?.run(action, input) ?? Promise.resolve(false),
  }
}
export type TaskReviewController = ReturnType<typeof useTaskReview>
