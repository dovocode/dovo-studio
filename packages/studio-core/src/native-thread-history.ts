import { useEffect, useState } from 'react'
import {
  nativeAgentWorking,
  nativeThreadPageSchema,
  type NativeThreadPage,
  type Subagent,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

export function useNativeThreadHistory(
  request: WorkspaceRequest,
  connected: boolean,
  taskId: string,
  agent: Subagent,
) {
  const [page, setPage] = useState<NativeThreadPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState<{ before?: string; revision: number }>({ revision: 0 })
  const following = agent.forkedSkill === true && nativeAgentWorking(agent)
  const changed = agent.workflowId ? agent.updatedAt : undefined
  useEffect(() => {
    if (!connected) {
      setBusy(false)
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (initial: boolean) => {
      if (initial) {
        setBusy(true)
        setError('')
      }
      try {
        const next = await request(
          '/api/tasks/native-thread',
          {
            taskId,
            id: agent.id,
            provider: agent.provider,
            sessionId: agent.sessionId,
            before: load.before,
          },
          nativeThreadPageSchema,
        )
        if (!active) return
        setError('')
        setPage((previous) => {
          if (!load.before || !previous) return next
          const ids = new Set(next.entries.map((entry) => entry.id))
          return {
            ...next,
            entries: [...next.entries, ...previous.entries.filter((entry) => !ids.has(entry.id))],
          }
        })
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (active) {
          setBusy(false)
          if (following && !load.before) timer = setTimeout(() => void read(false), 1000)
        }
      }
    }
    void read(true)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    agent.id,
    agent.provider,
    agent.sessionId,
    changed,
    connected,
    following,
    load,
    request,
    taskId,
  ])
  return {
    page,
    error,
    busy,
    refresh: () => setLoad(({ revision }) => ({ revision: revision + 1 })),
    loadBefore: (before: string | undefined) =>
      setLoad(({ revision }) => ({ before, revision: revision + 1 })),
  }
}
