import type { TaskReviewReport } from './task-review.js'
export type TaskReviewSessionState = {
  report: TaskReviewReport | null
  busy: boolean
  error: string
}
/** One visible thread owns its polling and mutations; late reads cannot overwrite actions. */
export function createTaskReviewSession(
  taskId: string,
  request: (path: string, input: unknown) => Promise<TaskReviewReport>,
  publish: (state: TaskReviewSessionState) => void,
) {
  let stopped = false,
    visible = false,
    reading = false,
    generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: TaskReviewSessionState = { report: null, busy: false, error: '' }
  const emit = (next: Partial<TaskReviewSessionState>) => {
    state = { ...state, ...next }
    if (!stopped) publish(state)
  }
  const schedule = () => {
    clearTimeout(timer)
    if (!stopped && visible)
      timer = setTimeout(refresh, state.report?.reviews[0]?.status === 'running' ? 2000 : 15000)
  }
  const refresh = async () => {
    clearTimeout(timer)
    if (stopped || !visible || reading || state.busy) return
    const current = generation
    reading = true
    try {
      const report = await request('/api/review/task/read', { taskId })
      if (current === generation) emit({ report, error: '' })
    } catch (error) {
      if (current === generation)
        emit({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      reading = false
      schedule()
    }
  }
  return {
    refresh,
    visibility(value: boolean) {
      visible = value
      clearTimeout(timer)
      if (value) void refresh()
    },
    async run(action: 'start' | 'finding' | 'fix' | 'stop', input: Record<string, unknown>) {
      if (stopped || state.busy) return false
      generation++
      clearTimeout(timer)
      emit({ busy: true, error: '' })
      try {
        const report = await request(`/api/review/task/${action}`, { ...input, taskId })
        emit({ report })
        return true
      } catch (error) {
        emit({ error: error instanceof Error ? error.message : String(error) })
        return false
      } finally {
        emit({ busy: false })
        schedule()
      }
    },
    stop() {
      stopped = true
      generation++
      clearTimeout(timer)
    },
  }
}
