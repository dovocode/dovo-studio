import { useState } from 'react'
import { MessageSquareText, Send, X } from 'lucide-react'
import { randomUUID, pendingReviewComments, reviewCommentsPrompt } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, IconButton } from '@dovo/studio-ui'

/** Review comments waiting to reach the agent, sent together with one follow-up. */
export function ReviewCommentsTray({ task, className = '' }: { task: Task; className?: string }) {
  const { request, connected } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = pendingReviewComments(task)
  if (!pending.length) return null
  const act = (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    void work()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  const send = () =>
    act(() =>
      request(
        '/api/tasks/message',
        { id: task.id, messageId: randomUUID(), text: reviewCommentsPrompt(pending.length) },
        responses.ok,
      ),
    )
  return (
    <section
      aria-label="Review comments waiting to be sent"
      className={`mx-auto w-full max-w-[var(--chat-max)] ${className}`}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          send()
        }
      }}
    >
      <div className="rounded-lg border bg-card text-xs">
        <div className="flex items-center gap-2 px-3 py-2">
          <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
          <button
            type="button"
            aria-expanded={open}
            className="flex-1 text-left hover:text-foreground"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="font-medium">
              {pending.length} review {pending.length === 1 ? 'comment' : 'comments'} ready
            </span>
            <span className="text-muted-foreground"> · {open ? 'Hide' : 'Show'}</span>
          </button>
          <Button
            size="sm"
            className="h-7 gap-1.5"
            disabled={!connected || busy}
            title="Send all comments to the agent (⌘/Ctrl+Enter)"
            onClick={send}
          >
            <Send className="size-3.5" />
            Send to agent
          </Button>
        </div>
        {open && (
          <ul className="space-y-1 border-t px-3 py-2">
            {pending.map((comment) => (
              <li key={comment.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[0.6875rem] text-muted-foreground">
                    {comment.file ?? 'File'}
                    {comment.diffComment
                      ? `:${comment.diffComment.start}${comment.diffComment.end !== comment.diffComment.start ? `-${comment.diffComment.end}` : ''}`
                      : ''}
                  </span>
                  <span className="block truncate">
                    {comment.diffComment?.body ?? comment.text}
                  </span>
                </span>
                <IconButton
                  label="Remove comment"
                  className="size-6 shrink-0"
                  disabled={!connected || busy}
                  onClick={() =>
                    act(() =>
                      request(
                        '/api/tasks/feedback/remove',
                        { id: task.id, messageId: comment.id },
                        responses.ok,
                      ),
                    )
                  }
                >
                  <X className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="border-t px-3 py-2 text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
