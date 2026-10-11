import { useEffect, useRef, useState } from 'react'
import {
  createReviewSession,
  reviewProgressSchema,
  type ReviewContext,
  type ReviewSessionState,
} from '@dovo/protocol'
import { useWorkspace } from '../workspace/context'
export function useFileReview(context: ReviewContext, version: string, enabled = true) {
  const { request, connected, activeRuntimeId } = useWorkspace()
  const key = JSON.stringify([activeRuntimeId, context])
  const [value, setValue] = useState<{ key: string; state: ReviewSessionState } | null>(null)
  const session = useRef<{ key: string; session: ReturnType<typeof createReviewSession> } | null>(
    null,
  )
  useEffect(() => {
    if (!connected || !enabled) return
    setValue(null)
    const current = createReviewSession(
      context,
      (path, input) => request(path, input, reviewProgressSchema),
      (state) => setValue({ key, state }),
    )
    session.current = { key, session: current }
    const visibility = () => current.visibility(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', visibility)
    visibility()
    return () => {
      current.stop()
      document.removeEventListener('visibilitychange', visibility)
      if (session.current?.session === current) session.current = null
    }
  }, [key, request, connected, enabled])
  const previousVersion = useRef(`${key}:${version}`)
  useEffect(() => {
    const current = `${key}:${version}`
    if (previousVersion.current !== current) void session.current?.session.refresh()
    previousVersion.current = current
  }, [key, version])
  const state = value?.key === key ? value.state : null
  return {
    progress: state?.progress ?? null,
    busy: state?.busy ?? false,
    error: state?.error ?? '',
    ready: connected && enabled && value?.key === key && !!state?.progress,
    reload: () => {
      void session.current?.session.refresh()
    },
    setViewed: (path: string, fingerprint: string, viewed: boolean) => {
      if (session.current?.key === key) void session.current.session.set(path, fingerprint, viewed)
    },
  }
}
