import { useNavigation } from '../../shell/navigation'
import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import {
  createReviewSession,
  reviewProgressSchema,
  type ReviewContext,
  type ReviewSessionState,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
export function useFileReview(context: ReviewContext, version: string, enabled = true) {
  const { focused } = useNavigation()
  const active = enabled && focused
  const { read, call, connected, profile } = useRuntime()
  const key = JSON.stringify([profile?.id, context])
  const [value, setValue] = useState<{ key: string; state: ReviewSessionState } | null>(null)
  const session = useRef<{ key: string; session: ReturnType<typeof createReviewSession> } | null>(
    null,
  )
  useEffect(() => {
    if (!connected || !active) return
    setValue(null)
    const current = createReviewSession(
      context,
      (path, input) =>
        (path === '/api/review/read' ? read : call)(path, input, reviewProgressSchema),
      (state) => setValue({ key, state }),
    )
    session.current = { key, session: current }
    current.visibility(AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', (state) =>
      current.visibility(state === 'active'),
    )
    return () => {
      current.stop()
      subscription.remove()
      if (session.current?.session === current) session.current = null
    }
  }, [key, read, call, connected, active])
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
    ready: connected && active && value?.key === key && !!state?.progress,
    reload: () => {
      void session.current?.session.refresh()
    },
    setViewed: (path: string, fingerprint: string, viewed: boolean) => {
      if (session.current?.key === key) void session.current.session.set(path, fingerprint, viewed)
    },
  }
}
