import { useEffect, useRef, useState } from 'react'
import { useRuntime } from '../runtime/provider'
import { pullDetailSchema, type PullDetail as Detail } from '@dovo/protocol'
import { AppState } from 'react-native'
import { useNavigation } from '../shell/navigation'

export function usePullDetail(repositoryId: string, number: number) {
  const { focused } = useNavigation()
  const { read: request, connected, snapshot, readCache } = useRuntime()
  const path =
    (snapshot?.workspace.repositories ?? []).find((repo) => repo.id === repositoryId)?.path ?? ''
  const forge = snapshot?.workspace.repositories.find((repo) => repo.id === repositoryId)?.forge
  const cacheKey = JSON.stringify(['pulls', 'detail', repositoryId, path, number, forge])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [revision, setRevision] = useState(0)
  const forceNext = useRef(false)
  useEffect(() => {
    setDetail(null)
    setError('')
  }, [cacheKey, readCache])
  useEffect(() => {
    let stopped = false,
      loading = false
    const hydrate = async () => {
      if (!readCache) return
      try {
        const cached = await readCache.read(cacheKey, pullDetailSchema)
        if (cached && !stopped)
          setDetail(
            (previous) =>
              previous ?? {
                ...cached.value,
                stale: true,
                cachedAt: cached.value.cachedAt ?? cached.cachedAt,
              },
          )
      } catch {
        if (!stopped) setError('Saved details could not be read from this device.')
      }
    }
    const hydrated = hydrate()
    const load = async (force = false) => {
      if (loading || stopped || !connected || !focused) return
      loading = true
      setBusy(true)
      setRefreshing(force)
      await hydrated
      if (stopped) return
      try {
        const value = await request(
          '/api/scm/pulls/detail',
          { repositoryId, number, refresh: force },
          pullDetailSchema,
        )
        if (!stopped) {
          setDetail(value)
          setError('')
          try {
            await readCache?.write(cacheKey, value)
          } catch {
            if (!stopped) setError('Details loaded, but could not be saved for offline use.')
          }
        }
      } catch (error) {
        if (!stopped) setError(String(error))
      } finally {
        loading = false
        if (!stopped) {
          setBusy(false)
          setRefreshing(false)
        }
      }
    }
    setBusy(false)
    setRefreshing(false)
    const force = forceNext.current
    forceNext.current = false
    void load(force)
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load()
    }, 10000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [repositoryId, number, cacheKey, connected, request, readCache, revision, focused])
  const refresh = () => {
    if (!connected || !focused) return
    forceNext.current = true
    setRefreshing(true)
    setRevision((value) => value + 1)
  }
  const invalidate = () => {
    void readCache
      ?.remove(cacheKey)
      .catch(() =>
        setError('Saved details could not be cleared. Refresh to load the latest discussion.'),
      )
    refresh()
  }
  return { detail, error, setError, busy, refreshing, refresh, invalidate }
}
