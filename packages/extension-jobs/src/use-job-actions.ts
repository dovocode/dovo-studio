import { useRef, useState } from 'react'
import { responses, useWorkspace } from '@dovo/studio-core'
import {
  acknowledgeAutomationStart,
  automationStartRequest,
  pendingAutomationStart,
} from './automation-starts'

export function useJobActions() {
  const { request, flush, connection } = useWorkspace()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [webhook, setWebhook] = useState<{ scope: string; path: string; secret: string } | null>(
    null,
  )
  const lock = useRef(false)
  const latestConnection = useRef(connection)
  latestConnection.current = connection
  const key = (id: string) => `${connection?.address}\0${connection?.token}\0${id}`
  const act = async (fn: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await flush()
      if (latestConnection.current !== connection)
        throw new Error('Computer changed. Try again on the selected computer.')
      await fn()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return {
    busy,
    error,
    webhook: (id: string) => (webhook?.scope === key(id) ? webhook : null),
    act,
    pendingStart: (id: string) => !!connection && !!pendingAutomationStart(connection, id),
    start: (id: string, select: (id: string) => void) =>
      act(async () => {
        if (!connection) throw new Error('Connect to this computer before starting an automation.')
        const requestId = automationStartRequest(connection, id)
        const run = await request('/api/jobs/run', { id, requestId }, responses.job)
        acknowledgeAutomationStart(connection, id, requestId)
        select(run.id)
      }),
    retry: (id: string, select: (id: string) => void) =>
      act(async () => {
        const run = await request('/api/jobs/retry', { id }, responses.job)
        select(run.id)
      }),
    review: (id: string, allow: boolean) =>
      act(() => request('/api/jobs/review', { id, allow }, responses.ok)),
    cancel: (id: string) => act(() => request('/api/jobs/cancel', { id }, responses.ok)),
    rotateWebhook: (id: string) =>
      act(async () => {
        const credential = await request('/api/jobs/webhook-secret', { id }, responses.webhook)
        setWebhook({ scope: key(id), ...credential })
      }),
  }
}
export type JobActions = ReturnType<typeof useJobActions>
