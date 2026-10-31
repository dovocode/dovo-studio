import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type TitleGenerationSettings,
  type ReviewProgress,
  createReviewSession,
  reviewProgressSchema,
  type ReviewContext,
  type ReviewSessionState,
} from '@dovo/protocol'
import { useWorkspace } from '../workspace/context'
export function useFileReview(context: ReviewContext, version: string, enabled = true) {
  const { request, connected, activeRuntimeId, connection } = useWorkspace()
  const key = JSON.stringify([activeRuntimeId, connection?.address, connection?.token, context])
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
    if (previousVersion.current !== current) session.current?.session.invalidate()
    previousVersion.current = current
  }, [key, version])
  const [organized, setOrganized] = useState<{ key: string; progress: ReviewProgress } | null>(null)
  const [hiddenGroups, setHiddenGroups] = useState('')
  const organizing = useRef(false)
  const [organizingKey, setOrganizingKey] = useState('')
  const [organizeFailure, setOrganizeFailure] = useState<{ key: string; message: string } | null>(
    null,
  )
  const state =
    value?.key === key && previousVersion.current === `${key}:${version}` ? value.state : null
  const evidence = useMemo(
    () =>
      JSON.stringify(state?.progress?.files.map(({ path, fingerprint }) => [path, fingerprint])),
    [state?.progress?.files],
  )
  const analysisKey = `${key}:${version}:${evidence}`
  const analysisRef = useRef(analysisKey)
  analysisRef.current = analysisKey
  return {
    progress:
      organized?.key === analysisKey && state?.progress
        ? {
            ...state.progress,
            groups: hiddenGroups === analysisKey ? [] : organized.progress.groups,
          }
        : state?.progress
          ? { ...state.progress, groups: hiddenGroups === analysisKey ? [] : state.progress.groups }
          : null,
    featureGroups:
      hiddenGroups !== analysisKey &&
      (organized?.key === analysisKey ||
        !!state?.progress?.groups.some((group) => group.basis === 'feature')),
    organizing: !!organizingKey,
    organizeError: organizeFailure?.key === analysisKey ? organizeFailure.message : '',
    clearGroups: () => {
      setOrganized(null)
      setHiddenGroups(analysisKey)
    },
    moveGuide: (position: number, reviewed?: number) => {
      const guide = state?.progress?.guide
      if (!guide || session.current?.key !== key) return Promise.resolve(false)
      return session.current.session.moveGuide({
        id: guide.id,
        version: guide.version,
        position,
        reviewed,
      })
    },
    organize: async (selection?: TitleGenerationSettings, guided = false) => {
      if (!state?.progress || organizing.current) return false
      organizing.current = true
      const currentKey = analysisKey
      setOrganizingKey(currentKey)
      setOrganizeFailure(null)
      try {
        const progress = await request(
          '/api/review/organize',
          {
            context,
            selection,
            ...(guided ? { guided: true, revision: state.progress.revision } : {}),
            files: state.progress.files.map(({ path, fingerprint }) => ({ path, fingerprint })),
          },
          reviewProgressSchema,
        )
        if (analysisRef.current === currentKey) {
          setHiddenGroups('')
          if (guided && session.current?.key === key) {
            session.current.session.adopt(progress)
            setOrganized(null)
          } else setOrganized({ key: currentKey, progress })
          return true
        }
        return false
      } catch (cause: unknown) {
        if (analysisRef.current === currentKey)
          setOrganizeFailure({
            key: currentKey,
            message: cause instanceof Error ? cause.message : String(cause),
          })
        return false
      } finally {
        organizing.current = false
        setOrganizingKey('')
      }
    },
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
