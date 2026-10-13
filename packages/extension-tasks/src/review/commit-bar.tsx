import { useRef, useState } from 'react'
import { Schema } from 'effect'
import { GitCommitHorizontal, Sparkles } from 'lucide-react'
import { mutableStruct, responses } from '@dovo/protocol'
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
  const [busy, setBusy] = useState<'' | 'write' | 'commit' | 'push'>('')
  const [status, setStatus] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [pushPending, setPushPending] = useState(false)
  const messageRef = useRef(message)
  messageRef.current = message
  if (!task.files.length && !status) return null
  const idle = connected && !busy && task.status !== 'running'
  const write = () => {
    if (!idle) return
    setSuggestion('')
    setBusy('write')
    setStatus('')
    void request('/api/tasks/commit-message', { id: task.id }, messageSchema)
      .then((result) => {
        if (!messageRef.current.trim()) setMessage(result.message)
        else setSuggestion(result.message)
      })
      .catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(''))
  }
  const commit = (push: boolean) => {
    if (!idle || !message.trim()) return
    const submitted = message
    setBusy('commit')
    setStatus('')
    void request('/api/tasks/commit', { id: task.id, message, push }, commitSchema)
      .then((result) => {
        setMessage((current) => (current === submitted ? '' : current))
        setSuggestion('')
        setPushPending(!!result.pushError)
        setStatus(
          result.pushError
            ? `Committed ${result.commit.slice(0, 8)}, but push failed: ${result.pushError}`
            : `Committed ${result.commit.slice(0, 8)}${push ? ' and pushed' : ''}.`,
        )
      })
      .catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(''))
  }
  const push = () => {
    if (!idle) return
    setBusy('push')
    void request(
      '/api/scm/push',
      { repositoryId: task.repositoryId, taskId: task.id },
      responses.ok,
    )
      .then(() => {
        setPushPending(false)
        setStatus('Branch pushed.')
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
          readOnly={busy === 'commit' || busy === 'push'}
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
      {suggestion && (
        <div className="space-y-2 rounded border p-2 text-xs">
          <p>Generated message</p>
          <pre className="whitespace-pre-wrap break-words">{suggestion}</pre>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => {
              setMessage(suggestion)
              setSuggestion('')
            }}
          >
            Use generated message
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSuggestion('')}>
            Keep my message
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
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
        {pushPending && (
          <Button size="sm" disabled={!idle} onClick={push}>
            {busy === 'push' ? 'Pushing…' : 'Retry push'}
          </Button>
        )}
        {status && (
          <span
            role="status"
            className="w-full whitespace-pre-wrap break-words text-[0.6875rem] text-muted-foreground"
            title={status}
          >
            {status}
          </span>
        )}
      </div>
    </section>
  )
}
