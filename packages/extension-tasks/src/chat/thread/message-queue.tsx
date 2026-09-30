import type { PendingMessage } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { ArrowUp, ArrowDown, CornerUpRight, X } from 'lucide-react'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  IconButton,
  Queue,
  QueueSectionTrigger,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
} from '@dovo/studio-ui'
export function MessageQueue({ task, pending }: { task: Task; pending?: PendingMessage | null }) {
  const { request, connected } = useWorkspace(),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const queue = task.queue ?? []
  const act = async (action: string, messageId?: string) => {
    setBusy(true)
    setError('')
    try {
      await request(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          messageId,
        },
        responses.ok,
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!queue.length) return null
  return (
    <div
      className="mx-auto w-full max-w-[var(--chat-max)] px-5 text-xs"
      aria-label="Queued follow-ups"
    >
      <Queue open>
        <QueueSectionTrigger>
          {queue.length} queued ·{' '}
          {pending?.destination === 'queue'
            ? pending.state === 'sending'
              ? 'Sending…'
              : 'Send failed'
            : task.queuePaused
              ? 'Paused'
              : 'Runs after this turn'}
        </QueueSectionTrigger>
        <QueueList>
          {queue.map((message, index) => (
            <QueueItem key={message.id}>
              <QueueItemIndicator />
              <QueueItemContent title={message.text}>
                {message.text || message.attachments?.map((f) => f.name).join(', ')}
                {message.text && message.attachments?.length
                  ? ` · ${message.attachments.length} files`
                  : ''}
              </QueueItemContent>
              {pending?.message.id === message.id && (
                <span role="status" className="shrink-0 text-muted-foreground">
                  {pending.state === 'sending' ? 'Sending…' : 'Retry from composer'}
                </span>
              )}
              <IconButton
                label={`Steer with queued message ${index + 1}`}
                className="size-6"
                disabled={
                  !connected ||
                  busy ||
                  pending?.message.id === message.id ||
                  task.status !== 'running'
                }
                onClick={() => void act('steer', message.id)}
              >
                <CornerUpRight size={12} />
              </IconButton>
              <IconButton
                label={`Move queued message ${index + 1} up`}
                className="size-6"
                disabled={!connected || busy || pending?.message.id === message.id || index === 0}
                onClick={() => void act('up', message.id)}
              >
                <ArrowUp size={12} />
              </IconButton>
              <IconButton
                label={`Move queued message ${index + 1} down`}
                className="size-6"
                disabled={
                  !connected ||
                  busy ||
                  pending?.message.id === message.id ||
                  index === queue.length - 1 ||
                  pending?.message.id === queue[index + 1]?.id
                }
                onClick={() => void act('down', message.id)}
              >
                <ArrowDown size={12} />
              </IconButton>
              <IconButton
                label={`Cancel queued message ${index + 1} and return it to the composer`}
                className="size-6"
                disabled={!connected || busy || pending?.message.id === message.id}
                onClick={() => void act('restore', message.id)}
              >
                <X size={12} />
              </IconButton>
            </QueueItem>
          ))}
        </QueueList>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[0.6875rem]"
          disabled={
            !connected ||
            busy ||
            task.archived ||
            (queue.length === 1 && pending?.message.id === queue[0]?.id)
          }
          onClick={() => void act(task.queuePaused ? 'resume' : 'pause')}
        >
          {task.queuePaused ? 'Resume queue' : 'Pause queue'}
        </Button>
      </Queue>
      {error && (
        <p role="alert" className="py-1 text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
