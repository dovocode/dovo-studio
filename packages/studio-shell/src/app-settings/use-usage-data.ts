import { useEffect, useLayoutEffect, useEffectEvent, useRef, useState } from 'react'
import { refreshUsageEntry, type UsageHistoryResult } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
/** Synchronize only when hosts change or the usage page's five-minute timer fires. */
export function useUsageData(selected: string) {
  const { runtimes, readRuntime, refreshRuntime, runtimeReadCache } = useWorkspace()
  const [saved, setSaved] = useState<
    Record<string, { connection: string; history: UsageHistoryResult }>
  >({})
  const [notices, setNotices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const pending = useRef(new Set<string>())
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  const hosts = runtimes.filter((entry) => selected === 'all' || entry.profile.id === selected)
  const scope = JSON.stringify(
    hosts.map((entry) => [entry.profile.id, entry.profile.connection, entry.connected]),
  )
  const currentScope = useRef(scope)
  useLayoutEffect(() => {
    currentScope.current = scope
  }, [scope])
  const refresh = async (force = false) => {
    if (pending.current.has(scope)) {
      if (force) requested.current.add(scope)
      return
    }
    pending.current.add(scope)
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        hosts.map(async (entry) => {
          const messages = await refreshUsageEntry({
            profile: entry.profile,
            connected: entry.connected,
            force,
            read: readRuntime,
            cache: runtimeReadCache(entry.profile),
            refresh: () => refreshRuntime(entry.profile),
            publish: (history) => {
              if (mounted.current && currentScope.current === scope)
                setSaved((previous) => ({
                  ...previous,
                  [entry.profile.id]: {
                    connection: JSON.stringify(entry.profile.connection),
                    history,
                  },
                }))
            },
          })
          if (mounted.current && currentScope.current === scope)
            setNotices((previous) => ({ ...previous, [entry.profile.id]: messages.join(' ') }))
        }),
      )
      if (mounted.current && currentScope.current === scope)
        for (const [index, result] of results.entries())
          if (result.status === 'rejected')
            setNotices((previous) => ({
              ...previous,
              [hosts[index].profile.id]:
                result.reason instanceof Error ? result.reason.message : String(result.reason),
            }))
    } finally {
      pending.current.delete(scope)
      if (mounted.current && currentScope.current === scope) {
        setBusy(false)
        if (requested.current.delete(scope)) void refresh(true)
      }
    }
  }
  const automaticRefresh = useEffectEvent(() => void refresh())
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    automaticRefresh()
    const timer = setInterval(automaticRefresh, 300000)
    return () => clearInterval(timer)
  }, [scope])
  const histories: Record<string, UsageHistoryResult> = {}
  for (const host of hosts) {
    const value = saved[host.profile.id]
    if (value?.connection === JSON.stringify(host.profile.connection))
      histories[host.profile.id] = value.history
  }
  return { hosts, histories, notices, busy, refresh: () => void refresh(true) }
}
