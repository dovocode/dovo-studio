import { useApplicationState } from '@dovo/studio-core/state'
import { ArrowUp, ArrowDown, X } from 'lucide-react'
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
export function MessageQueue({ task }: { task: Task }) {
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
    <div className="mx-auto w-full max-w-3xl px-5 text-xs" aria-label="Queued follow-ups">
      <Queue open>
        <QueueSectionTrigger>
          {queue.length} queued · {task.queuePaused ? 'Paused' : 'Runs after this turn'}
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
              <IconButton
                label={`Move queued message ${index + 1} up`}
                className="size-6"
                disabled={!connected || busy || index === 0}
                onClick={() => void act('up', message.id)}
              >
                <ArrowUp size={12} />
              </IconButton>
              <IconButton
                label={`Move queued message ${index + 1} down`}
                className="size-6"
                disabled={!connected || busy || index === queue.length - 1}
                onClick={() => void act('down', message.id)}
              >
                <ArrowDown size={12} />
              </IconButton>
              <IconButton
                label={`Remove queued message ${index + 1}`}
                className="size-6"
                disabled={!connected || busy}
                onClick={() => void act('remove', message.id)}
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
          disabled={!connected || busy || task.archived}
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
