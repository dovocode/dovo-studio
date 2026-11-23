import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { clientScopeKey } from '@dovo/client-runtime'
import type { DashboardTile, StudioDataSource, dashboardReadResultSchema } from '@dovo/protocol'

type Reading = typeof dashboardReadResultSchema.Type
export type StudioReadingSource = (StudioDataSource | Extract<DashboardTile, { kind: 'mcp' }>) & {
  id: string
  title: string
}
export type StudioReadingOwner = readonly [kind: 'dashboard' | 'extension', id: string]

// Readings stay in this client session. The runtime limits each result to 256 KB.
const readings = new Map<string, Reading>()
const readingLimit = 48
const readers = new Map<string, Set<(reading: Reading) => void>>()

export function studioReadingKey(
  connection: object | null | undefined,
  runtimeId: string | null | undefined,
  owner: StudioReadingOwner,
  source: StudioReadingSource,
  projectPath?: string,
) {
  const target =
    source.kind === 'api'
      ? [source.url]
      : source.kind === 'cli'
        ? [source.repositoryId, projectPath, source.command]
        : [source.taskId, source.server, source.tool, source.arguments]
  return JSON.stringify([
    clientScopeKey(connection),
    runtimeId,
    owner,
    source.id,
    source.kind,
    target,
    source.pointer,
  ])
}

function remember(key: string, result: Reading) {
  readings.delete(key)
  readings.set(key, result)
  if (readings.size > readingLimit) {
    const oldest = readings.keys().next().value
    if (oldest !== undefined) readings.delete(oldest)
  }
  for (const receive of readers.get(key) ?? []) receive(result)
}

export function useStudioDataSource(
  key: string,
  source: StudioReadingSource,
  active: boolean,
  read: () => Promise<Reading>,
  onData?: (value: unknown) => void,
  canRead?: () => boolean,
) {
  const seconds = 'refreshSeconds' in source ? source.refreshSeconds : undefined
  const [data, setData] = useState(() => readings.get(key))
  const [stale, setStale] = useState(!!data)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [running, setRunning] = useState(false)
  const lastAttempt = useRef<number | undefined>(undefined)
  const pending = useRef(false)
  const mounted = useRef(false)
  const enabled = useRef(false)
  const available = useRef(active)
  available.current = active

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const receive = (reading: Reading) => {
      setData(reading)
      setStale(false)
    }
    const listeners = readers.get(key) ?? new Set()
    listeners.add(receive)
    readers.set(key, listeners)
    const saved = readings.get(key)
    if (saved) setData(saved)
    return () => {
      listeners.delete(receive)
      if (!listeners.size) readers.delete(key)
    }
  }, [key])

  async function refresh() {
    if (!available.current || canRead?.() === false || pending.current || !mounted.current) return
    lastAttempt.current = Date.now()
    pending.current = true
    setBusy(true)
    setError('')
    try {
      remember(key, await read())
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      if (mounted.current) {
        setBusy(false)
        setAttempt((value) => value + 1)
      }
    }
  }

  const publish = useEffectEvent((data: Reading | undefined) => onData?.(data?.data))
  useEffect(() => {
    publish(data)
  }, [data])

  const reactivate = useEffectEvent(() => {
    const saved = readings.get(key)
    if (saved) {
      setData(saved)
      setStale(true)
    }
    if ((saved || data) && source.kind === 'api') void refresh()
  })
  useEffect(() => {
    if (active) reactivate()
    else setStale(true)
  }, [active])

  const tick = useEffectEvent(() => {
    if (enabled.current) void refresh()
  })
  useEffect(() => {
    if (!active || !running || busy || seconds === undefined) return
    const remaining = (lastAttempt.current ?? Date.now()) + seconds * 1000 - Date.now()
    const timer = setTimeout(() => tick(), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [active, running, busy, seconds, attempt])

  return {
    data,
    stale: !!data && (stale || !active || !!error),
    error,
    busy,
    running,
    refresh,
    start: () => {
      if (!available.current || canRead?.() === false || seconds === undefined || enabled.current)
        return
      enabled.current = true
      setRunning(true)
      void refresh()
    },
    stop: () => {
      enabled.current = false
      setRunning(false)
    },
  }
}
