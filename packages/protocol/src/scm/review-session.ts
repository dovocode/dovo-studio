import type { ReviewContext, ReviewProgress } from './review.js'
export type ReviewSessionState = { progress: ReviewProgress | null; busy: boolean; error: string }
/** One mounted viewer owns this session. No global timers or retained file contents. */
export function createReviewSession(
  context: ReviewContext,
  request: (path: string, input: unknown) => Promise<ReviewProgress>,
  publish: (state: ReviewSessionState) => void,
) {
  let stopped = false,
    visible = true,
    generation = 0,
    reading = false,
    readAgain = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: ReviewSessionState = { progress: null, busy: false, error: '' }
  const emit = (changes: Partial<ReviewSessionState>) => {
    if (
      changes.progress &&
      state.progress &&
      JSON.stringify(changes.progress) === JSON.stringify(state.progress)
    )
      changes = { ...changes, progress: state.progress }
    const next = { ...state, ...changes }
    if (next.progress === state.progress && next.busy === state.busy && next.error === state.error)
      return
    state = next
    if (!stopped) publish(state)
  }
  const read = async () => {
    clearTimeout(timer)
    if (stopped || !visible) return
    if (reading || state.busy) {
      readAgain = true
      return
    }
    readAgain = false
    reading = true
    const current = generation
    try {
      const progress = await request('/api/review/read', { context })
      if (current === generation) emit({ progress, error: '' })
    } catch (error) {
      if (current === generation)
        emit({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      reading = false
      clearTimeout(timer)
      if (!stopped && visible) timer = setTimeout(read, readAgain ? 0 : 20_000)
    }
  }
  return {
    refresh: read,
    visibility(value: boolean) {
      visible = value
      clearTimeout(timer)
      if (visible) void read()
    },
    async set(path: string, fingerprint: string, viewed: boolean) {
      if (stopped || state.busy) return
      const file = state.progress?.files.find(
        (file) => file.path === path && file.fingerprint === fingerprint,
      )
      if (!file) {
        emit({ error: 'Refresh this diff before marking it viewed.' })
        return
      }
      generation++
      clearTimeout(timer)
      emit({ busy: true, error: '' })
      try {
        const progress = await request('/api/review/set', {
          context,
          path,
          fingerprint,
          viewed,
          version: file.version,
        })
        emit({ progress })
      } catch (error) {
        emit({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        emit({ busy: false })
        clearTimeout(timer)
        if (!stopped && visible) timer = setTimeout(read, readAgain ? 0 : 20_000)
      }
    },
    stop() {
      stopped = true
      generation++
      clearTimeout(timer)
    },
  }
}
