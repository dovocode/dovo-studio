import type { ReviewContext, ReviewProgress } from './review.js'
import { reviewGuideGroups, type ReviewGuide, type reviewGuideMoveSchema } from './review-guide.js'
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
    adoptions = 0,
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
  const merge = (progress: ReviewProgress, preserveGuide = false): ReviewProgress => {
    const prior = state.progress
    if (!prior || prior.revision !== progress.revision) return progress
    const files = new Map(prior.files.map((file) => [file.path, file]))
    const guide =
      prior.guide && progress.guide?.id === prior.guide.id
        ? prior.guide.version > progress.guide.version
          ? prior.guide
          : progress.guide
        : preserveGuide
          ? prior.guide
          : progress.guide
    return {
      ...progress,
      files: progress.files.map((file) => {
        const previous = files.get(file.path)
        return previous && previous.version > file.version ? previous : file
      }),
      ...(guide ? { guide } : {}),
      groups:
        preserveGuide && prior.guide?.id !== progress.guide?.id ? prior.groups : progress.groups,
    }
  }
  /** Names the held guide so the runtime can omit its immutable steps. Only a runtime that
   * already sent a guide receives the field. */
  const held = () => {
    const guide = state.progress?.guide
    return { guide, input: guide ? { knownGuide: guide.id } : {} }
  }
  /** Restores a compact guide from the one held when the request was sent, and its groups. */
  const restore = (
    progress: ReviewProgress,
    sent: ReviewGuide | undefined,
  ): ReviewProgress | undefined => {
    const { guideState, ...value } = progress
    if (!guideState && (!value.guide || value.groups.length)) return progress
    if (guideState && (sent?.id !== guideState.id || sent.revision !== guideState.revision)) return
    const guide = guideState && sent ? { ...sent, ...guideState } : value.guide
    return guide
      ? { ...value, guide, groups: value.groups.length ? value.groups : reviewGuideGroups(guide) }
      : value
  }
  /** A compact response without its held guide falls back to one complete read. */
  const expand = async (progress: ReviewProgress, sent: ReviewGuide | undefined) => {
    const value =
      restore(progress, sent) ?? restore(await request('/api/review/read', { context }), undefined)
    if (!value) throw new Error('The runtime omitted an unknown review guide.')
    return value
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
    const current = generation,
      adoption = adoptions
    try {
      const sent = held()
      const progress = await expand(
        await request('/api/review/read', { context, ...sent.input }),
        sent.guide,
      )
      if (current === generation && adoption === adoptions)
        emit({ progress: merge(progress), error: '' })
    } catch (error) {
      if (current === generation && adoption === adoptions)
        emit({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      reading = false
      clearTimeout(timer)
      if (!stopped && visible) timer = setTimeout(read, readAgain ? 0 : 20_000)
    }
  }
  return {
    refresh: read,
    invalidate() {
      generation++
      emit({ progress: null, error: '' })
      void read()
    },
    adopt(progress: ReviewProgress) {
      if (stopped) return
      adoptions++
      // Generation responses always carry the complete guide.
      const value = restore(progress, undefined)
      if (value) emit({ progress: merge(value), error: '' })
      void read()
    },
    async moveGuide(move: typeof reviewGuideMoveSchema.Type) {
      if (stopped || state.busy) return false
      const current = ++generation,
        adoption = adoptions
      clearTimeout(timer)
      emit({ busy: true, error: '' })
      try {
        const sent = held()
        const progress = await expand(
          await request('/api/review/guide', { context, move, ...sent.input }),
          sent.guide,
        )
        if (current !== generation || stopped) return false
        emit({ progress: merge(progress, adoption !== adoptions) })
        return true
      } catch (error) {
        if (current === generation)
          emit({ error: error instanceof Error ? error.message : String(error) })
        return false
      } finally {
        if (!stopped) emit({ busy: false })
        clearTimeout(timer)
        if (!stopped && visible) timer = setTimeout(read, readAgain ? 0 : 20_000)
      }
    },
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
      const current = ++generation,
        adoption = adoptions
      clearTimeout(timer)
      emit({ busy: true, error: '' })
      try {
        const sent = held()
        const progress = await expand(
          await request('/api/review/set', {
            context,
            path,
            fingerprint,
            viewed,
            version: file.version,
            ...sent.input,
          }),
          sent.guide,
        )
        if (current === generation) emit({ progress: merge(progress, adoption !== adoptions) })
      } catch (error) {
        if (current === generation)
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
