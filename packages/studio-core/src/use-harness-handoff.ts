import { useEffect, useRef, useState } from 'react'
import {
  randomUUID,
  type Task,
  type TaskHarness,
  type continueHarnessSchema,
  type pendingHarnessSchema,
} from '@dovo/protocol'

/** UI adapter for the existing checkpointed, idempotent harness handoff endpoint. */
export function useHarnessHandoff({
  task,
  scope,
  supported,
  connected,
  request,
  defer,
}: {
  task: Task
  scope: string
  supported: boolean
  connected: boolean
  request: (input: typeof continueHarnessSchema.Type) => Promise<unknown>
  defer?: (input: typeof pendingHarnessSchema.Type) => Promise<unknown>
}) {
  const [pending, setPending] = useState<TaskHarness | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const attempt = useRef<{ key: string; payload: typeof continueHarnessSchema.Type } | null>(null)
  const deferredAttempt = useRef<{ key: string; payload: typeof pendingHarnessSchema.Type } | null>(
    null,
  )
  const running = useRef(false)
  const identity = JSON.stringify([scope, task.id])
  const latest = useRef(identity)
  latest.current = identity
  useEffect(() => {
    attempt.current = null
    deferredAttempt.current = null
    setPending(null)
    setError('')
    setNotice('')
  }, [identity])
  const available =
    supported &&
    task.status !== 'draft' &&
    !task.archivedAt &&
    !task.archived &&
    !task.machineHandoff &&
    !task.delegation &&
    !task.sideThread &&
    !task.importedCodexSession &&
    !task.importedPiSession
  const submit = async (harness: TaskHarness, stop: boolean) => {
    if (!available || !connected || running.current) return false
    setError('')
    setNotice('')
    setPending(harness)
    if (task.queue?.length || task.subagentInbox?.length) {
      setError('Send or remove queued messages before switching harnesses.')
      return false
    }
    if (task.draftTurnSettings) {
      setError('Use thread defaults before switching harnesses. Your draft stays saved.')
      return false
    }
    const key = JSON.stringify([identity, harness])
    if (attempt.current?.key !== key)
      attempt.current = { key, payload: { id: task.id, requestId: randomUUID(), harness, stop } }
    running.current = true
    setBusy(true)
    try {
      await request(attempt.current.payload)
      if (latest.current !== identity) return false
      attempt.current = null
      setPending(null)
      setNotice('Harness switched. Your next message continues with the saved conversation.')
      return true
    } catch (cause) {
      if (latest.current === identity)
        setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const schedule = async (harness: TaskHarness | null) => {
    if (!available || !connected || running.current || !defer || !task.bot) return false
    const key = JSON.stringify([identity, harness, task.bot.revision])
    if (deferredAttempt.current?.key !== key)
      deferredAttempt.current = {
        key,
        payload: {
          id: task.id,
          requestId: randomUUID(),
          harness,
          expectedBotRevision: task.bot.revision,
          expectedPendingId: task.pendingHarness?.id,
        },
      }
    running.current = true
    setBusy(true)
    setError('')
    try {
      await defer(deferredAttempt.current.payload)
      if (latest.current !== identity) return false
      deferredAttempt.current = null
      setPending(null)
      return true
    } catch (cause) {
      if (latest.current === identity)
        setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return {
    available,
    pending,
    busy,
    error,
    notice,
    cancelDeferred: () => schedule(null),
    choose: async (harness: TaskHarness) => {
      if (!available || !connected || running.current) return false
      if (defer && task.bot && (task.status === 'running' || task.pendingHarness))
        return schedule(harness)
      setNotice('')
      if (task.status === 'running') {
        setPending(harness)
        setError('')
        return true
      }
      return submit(harness, false)
    },
    confirm: () => (pending ? submit(pending, task.status === 'running') : Promise.resolve(false)),
    cancel: () => {
      if (!running.current) {
        setPending(null)
        setError('')
        attempt.current = null
      }
    },
  }
}
