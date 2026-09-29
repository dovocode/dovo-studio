import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRuntimeReleases, type RuntimeReleases } from '@dovo/protocol'
export { newerRuntimeVersion, runtimeUpdate } from '@dovo/protocol'
let cached: Promise<RuntimeReleases> | undefined

export function useRuntimeReleaseCheck() {
  const generation = useRef(0)
  const [state, setState] = useState<{
    releases?: RuntimeReleases
    error?: string
    checking: boolean
  }>({
    checking: true,
  })
  const check = useCallback((force = false) => {
    const current = ++generation.current
    if (force) cached = undefined
    cached ??= fetchRuntimeReleases().catch((error) => {
      cached = undefined
      throw error
    })
    setState((current) => ({ ...current, checking: true, error: undefined }))
    void cached.then(
      (next) => {
        if (generation.current === current) setState({ releases: next, checking: false })
      },
      (error: unknown) =>
        generation.current === current &&
        setState({
          checking: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }, [])
  useEffect(() => {
    check()
    const timer = setInterval(() => check(true), 60 * 60 * 1000)
    return () => {
      generation.current++
      clearInterval(timer)
    }
  }, [check])
  return { ...state, check: () => check(true) }
}
