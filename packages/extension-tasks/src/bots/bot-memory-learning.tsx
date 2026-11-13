import { useEffect, useRef, useState } from 'react'
import { botMemoryStatusSchema } from '@dovo/protocol'
import { useConfirmation, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

type Status = typeof botMemoryStatusSchema.Type
export function BotMemoryLearning({
  taskId,
  onChanged,
}: {
  taskId: string
  onChanged: () => void
}) {
  const { request, connected, snapshot } = useWorkspace()
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirmation()
  const lock = useRef(false)
  const mounted = useRef(true)
  const supported = snapshot?.botMemoryReviewSupported === true
  useEffect(() => {
    mounted.current = true
    if (connected && supported)
      void request('/api/memory/bot-review/read', { botId: taskId }, botMemoryStatusSchema).then(
        (value) => {
          if (mounted.current) {
            setStatus(value)
            setError('')
          }
        },
        () => {
          if (mounted.current) setError('Could not load memory review settings.')
        },
      )
    return () => {
      mounted.current = false
    }
  }, [request, connected, supported, taskId])
  const run = async (action: 'save' | 'run' | 'clear') => {
    if (!status || lock.current || !connected) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (
        action === 'clear' &&
        !(await confirm({
          title: 'Clear memory?',
          description:
            'Delete all saved notes for this Bot. Earlier messages will not be reviewed again. The conversation, files and completed actions stay.',
          confirmLabel: 'Clear memory',
          destructive: true,
        }))
      )
        return
      const next = await request(
        `/api/memory/bot-review/${action}`,
        {
          botId: taskId,
          ...(action === 'run' ? {} : { expectedRevision: status.revision }),
          ...(action === 'save' ? { enabled: !status.enabled } : {}),
        },
        botMemoryStatusSchema,
      )
      if (mounted.current) {
        setStatus(next)
        onChanged()
      }
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : 'Memory action failed. Refresh before retrying.',
        )
        try {
          const fresh = await request(
            '/api/memory/bot-review/read',
            { botId: taskId },
            botMemoryStatusSchema,
          )
          if (mounted.current) setStatus(fresh)
        } catch {
          /* Keep the last known settings while offline. */
        }
      }
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  if (!supported) return null
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Background learning</p>
      <p className="text-xs text-muted-foreground">
        Reviews your messages after 20 completed turns, or after 15 idle minutes with 3 new turns.
        Uses the utility model in Settings → Agents, with tools off. Your edits take priority. Reset
        keeps saved memory.
      </p>
      <p className="text-xs" role="status">
        {busy
          ? 'Updating memory…'
          : status?.running
            ? 'Review in progress'
            : status?.lastReviewedAt
              ? `Last reviewed ${new Date(status.lastReviewedAt).toLocaleString()}`
              : 'No reviews yet'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || !status || busy}
          onClick={() => void run('save')}
        >
          {status?.enabled ? 'Pause learning' : 'Enable learning'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || !status?.enabled || busy || status.running}
          onClick={() => void run('run')}
        >
          Review now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || !status || busy}
          onClick={() => void run('clear')}
        >
          Clear memory
        </Button>
      </div>
      {(error || status?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || status?.error}
        </p>
      )}
    </div>
  )
}
