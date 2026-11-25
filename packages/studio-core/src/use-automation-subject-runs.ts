import {
  responses,
  type AutomationRunSubject,
  type JobRun,
  type RuntimeConnection,
} from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { useEffect, useState } from 'react'
import type { WorkspaceRequest } from './workspace/context'

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
