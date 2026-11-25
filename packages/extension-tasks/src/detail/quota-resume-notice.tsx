import { useCallback, useEffect, useState } from 'react'
import { quotaRetryTurn } from '@dovo/protocol'
import {
  formatDateTime,
  responses,
  useStudioHost,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useScopedError } from '@dovo/studio-core/scoped-error'
import { Button } from '@dovo/studio-ui'

export function QuotaResumeNotice({ task, command }: { task: Task; command?: boolean }) {
  const uiText = useInterfaceText()
  const { registerCommand } = useStudioHost()
  const { connected, snapshot, activeRuntimeId, request } = useWorkspace()
  const continuation = task.quotaContinuation
  const turn = task.turns?.at(-1)
  const offer =
    snapshot?.quotaResumeSupported &&
    !continuation?.resume &&
    !snapshot.workspace?.automations?.some((routine) => routine.id === task.origin)
      ? quotaRetryTurn(task, turn, Date.now())
      : undefined
  const turnId = offer?.turnId ?? continuation?.turnId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useScopedError(JSON.stringify([activeRuntimeId, task.id, turnId]))
  const act = useCallback(
    (action: 'schedule' | 'cancel') => {
      const turnId = action === 'schedule' ? offer?.turnId : continuation?.turnId
      if (!connected || busy || !turnId) return
      setBusy(true)
      setError('')
      void request(`/api/tasks/quota/${action}`, { id: task.id, turnId }, responses.ok)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setBusy(false))
    },
    [busy, connected, continuation?.turnId, offer?.turnId, request, setError, task.id],
  )
  const scheduleLabel = uiText('Auto-resume after rate limit')
  const cancelLabel = uiText('Cancel quota continuation')
  const canSchedule = !!offer
  const canCancel = !!continuation
  useEffect(() => {
    if (!command || !connected || (!canSchedule && !canCancel)) return
    return registerCommand({
      id: 'tasks.quota-resume',
      title: canSchedule ? scheduleLabel : cancelLabel,
      run: () => act(canSchedule ? 'schedule' : 'cancel'),
    })
  }, [act, canCancel, canSchedule, cancelLabel, command, connected, registerCommand, scheduleLabel])
  const at = continuation?.at ?? offer?.at
  if (!at) return null
  const time = formatDateTime(at)
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-[var(--chat-max)] flex-wrap items-center gap-2 px-5 py-2 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1">
        {continuation
          ? uiText('{value0} at {value1}', {
              value0: continuation.resume ? uiText('Scheduled to resume') : uiText('Snoozed'),
              value1: time,
            })
          : uiText('Rate limit resets at {value0}', { value0: time })}
      </span>
      {offer && (
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() => act('schedule')}
        >
          {scheduleLabel}
        </Button>
      )}
      {continuation && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || busy}
          onClick={() => act('cancel')}
        >
          {cancelLabel}
        </Button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
