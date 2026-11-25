import {
  jobRunSchema,
  responses,
  type AutomationRunSubject,
  type JobRun,
  type RuntimeConnection,
} from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { useEffect, useState } from 'react'
import type { WorkspaceRequest } from './workspace/context'

export function useAutomationRun({
  automationId,
  runId,
  summary,
  connection,
  connected,
  supported,
  request,
}: {
  automationId: string
  runId?: string | null
  summary?: JobRun
  connection?: RuntimeConnection | null
  connected: boolean
  supported?: boolean
  request: WorkspaceRequest
}) {
  const scope = connection && JSON.stringify([clientScopeKey(connection), automationId, runId])
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    scope: string
    attempt: number
    run?: JobRun
    error?: string
  }>()
  const saved = result?.scope === scope && result?.attempt === attempt ? result : undefined
  const lookup = Boolean(runId && scope && supported && !summary)

  useEffect(() => {
    if (!lookup || !scope || !runId || !connected) return
    let current = true
    void request('/api/jobs/detail', { id: runId, automationId }, jobRunSchema).then(
      (run) => {
        if (!current) return
        if (run.id !== runId || run.automationId !== automationId)
          setResult({ scope, attempt, error: 'The computer returned a different automation run.' })
        else setResult({ scope, attempt, run })
      },
      (cause: unknown) => {
        if (current)
          setResult({
            scope,
            attempt,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      },
    )
    return () => {
      current = false
    }
  }, [attempt, automationId, connected, lookup, request, runId, scope])

  return {
    run: summary ?? (lookup ? saved?.run : undefined),
    loading: lookup && connected && !saved,
    error: lookup ? saved?.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  }
}

export function useAutomationSubjectRuns({
  subject,
  connection,
  connected,
  request,
}: {
  subject?: AutomationRunSubject
  connection?: RuntimeConnection | null
  connected: boolean
  request: WorkspaceRequest
}) {
  const kind = subject?.kind
  const value = subject?.kind === 'thread' ? subject.threadId : subject?.url
  const scope =
    kind && value && connection && JSON.stringify([clientScopeKey(connection), kind, value])
  const [result, setResult] = useState<{ scope: string; runs?: JobRun[]; error?: string }>()
  const saved = result?.scope === scope ? result : undefined
  useEffect(() => {
    if (!kind || !value || !scope || !connected) return
    let current = true
    void request(
      '/api/jobs/runs-by-subject',
      {
        subject: kind === 'thread' ? { kind, threadId: value } : { kind, url: value },
      },
      responses.automationSubjectRuns,
    ).then(
      ({ runs }) => {
        if (current) setResult({ scope, runs })
      },
      (cause: unknown) => {
        if (current)
          setResult({ scope, error: cause instanceof Error ? cause.message : String(cause) })
      },
    )
    return () => {
      current = false
    }
  }, [connected, kind, request, scope, value])
  return { ...saved, loading: !!scope && connected && !saved }
}
