import { useState } from 'react'
import { type Task, randomUUID, responses } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from '@dovo/studio-ui'

export function NativeGoal({ task }: { task: Task }) {
  const { request, connected } = useWorkspace()
  const uiText = useInterfaceText()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const goal = task.nativeGoal
  if (!goal || goal.sessionId !== task.sessionId) return null
  const act = async (action: string) => {
    setBusy(true)
    setError('')
    try {
      await request(
        '/api/tasks/message',
        { id: task.id, messageId: randomUUID(), text: `/goal ${action}`, attachmentIds: [] },
        responses.ok,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={uiText('Native goal')} className="space-y-1 rounded-md border p-2 text-xs">
      <p>
        {uiText('Goal')} · {uiText(goal.status)} · {goal.rounds}
      </p>
      <p className="whitespace-pre-wrap break-words">{goal.objective}</p>
      {goal.reason && <p className="text-muted-foreground">{goal.reason}</p>}
      {task.status === 'running' ? (
        <p className="text-muted-foreground">{uiText('Stop the turn to pause this goal.')}</p>
      ) : (
        <div className="flex gap-2">
          {[
            ...(goal.status === 'paused' ? ['resume'] : goal.status === 'active' ? ['pause'] : []),
            'clear',
          ].map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled={busy || !connected}
              onClick={() => void act(action)}
            >
              {uiText(
                action === 'resume'
                  ? 'Resume goal'
                  : action === 'pause'
                    ? 'Pause goal'
                    : 'Clear goal',
              )}
            </Button>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
