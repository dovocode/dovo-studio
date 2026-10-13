import { useState } from 'react'
import { Schema } from 'effect'
import { GitCommitHorizontal, Sparkles } from 'lucide-react'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace, type Task } from '@dovo/studio-core'
import { Button, Textarea } from '@dovo/studio-ui'

const messageSchema = mutableStruct({ message: Schema.String })
const commitSchema = mutableStruct({
  commit: Schema.String,
  pushError: Schema.optional(Schema.String),
})

/** Commit everything in the task's checkout from Changes, with a message the title model can
 * write from the conversation and the diff. */
export function CommitBar({ task }: { task: Task }) {
  const { request, connected } = useWorkspace()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'' | 'write' | 'commit'>('')
  const [status, setStatus] = useState('')
  if (!task.files.length && !status) return null
  const idle = connected && !busy && task.status !== 'running'
  const write = () => {
    setBusy('write')
    setStatus('')
    void request('/api/tasks/commit-message', { id: task.id }, messageSchema)
      .then((result) => setMessage(result.message))
      .catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(''))
  }
  const commit = (push: boolean) => {
    setBusy('commit')
    setStatus('')
    void request('/api/tasks/commit', { id: task.id, message, push }, commitSchema)
      .then((result) => {
        setMessage('')
        setStatus(
          result.pushError
            ? `Committed ${result.commit.slice(0, 8)}, but push failed: ${result.pushError}`
            : `Committed ${result.commit.slice(0, 8)}${push ? ' and pushed' : ''}.`,
        )
      })
      .catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(''))
  }
  return (
    <section aria-label="Commit" className="shrink-0 space-y-1.5 border-b px-3 py-2">
      <div className="relative">
        <Textarea
          aria-label="Commit message"
          placeholder="Commit message"
          value={message}
          maxLength={4000}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === 'Enter' &&
              message.trim() &&
              idle
            ) {
              event.preventDefault()
              commit(false)
            }
          }}
          className="min-h-14 pr-9 text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Write the commit message"
          title="Write the message from the conversation and changes"
          className="absolute right-1 top-1 size-7"
          disabled={!idle || !task.files.length}
          onClick={write}
        >
          <Sparkles
            className={busy === 'write' ? 'size-3.5 motion-safe:animate-pulse' : 'size-3.5'}
          />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          disabled={!idle || !message.trim() || !task.files.length}
          title="Stages every change in this checkout, then commits (⌘/Ctrl+Enter)"
          onClick={() => commit(false)}
        >
          <GitCommitHorizontal className="size-3.5" /> Commit all
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!idle || !message.trim() || !task.files.length}
          onClick={() => commit(true)}
        >
          Commit &amp; push
        </Button>
        {status && (
          <span
            role="status"
            className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground"
            title={status}
          >
            {status}
          </span>
        )}
      </div>
    </section>
  )
}
