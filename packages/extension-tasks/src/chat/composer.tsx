import { generatedTitleSchema, resolveTaskAgent } from '@dovo/studio-core'
import { AttachmentPicker } from './attachment-picker'
import { MessageAttachments } from './message-attachments'
import { useAttachments } from './use-attachments'
import { useRef, useState } from 'react'
import { ArrowUp, LoaderCircle, ListPlus, Square, CornerUpRight } from 'lucide-react'
import { useWorkspace, updateTask, responses, type Task } from '@dovo/studio-core'
import {
  Button,
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  cn,
} from '@dovo/studio-ui'
import { ComposerHarnessControls } from './composer-harness-controls'
import { ComposerWorkspace } from './composer-workspace'
export function Composer({ task }: { task: Task }) {
  const { workspace, setWorkspace, request, connected, connection, flush, snapshot } =
    useWorkspace()
  const [error, setError] = useState(''),
    [sending, setSending] = useState(false),
    [stopping, setStopping] = useState(false)
  const sendingRequest = useRef(false)
  const attachments = useAttachments(task)
  const pendingQuestion = !!snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  const hasInput = !!task.draft.trim() || attachments.files.length > 0
  const attempt = useRef<{
    id: string
    text: string
    attachmentIds: string[]
    mode: 'queue' | 'steer'
    title?: string
  } | null>(null)
  const firstMessage = task.messages.length === 0 && !task.queue?.length && !task.turns?.length
  const agent = resolveTaskAgent(task, workspace.agents)
  const stop = async () => {
    setStopping(true)
    setError('')
    try {
      await request('/api/tasks/cancel', { id: task.id }, responses.ok)
    } catch (e) {
      setError(String(e))
    } finally {
      setStopping(false)
    }
  }
  const send = async (mode: 'queue' | 'steer' = 'queue') => {
    const text = task.draft.trim()
    const attachmentIds = attachments.files.map((f) => f.id)
    if (
      (!text && !attachmentIds.length) ||
      sendingRequest.current ||
      stopping ||
      attachments.busy ||
      task.archived ||
      pendingQuestion
    )
      return
    if (firstMessage && (!connected || !task.repositoryId || !agent)) return
    sendingRequest.current = true
    setError('')
    setSending(true)
    if (
      attempt.current?.mode !== mode ||
      attempt.current?.text !== text ||
      JSON.stringify(attempt.current.attachmentIds) !== JSON.stringify(attachmentIds)
    )
      attempt.current = { id: crypto.randomUUID(), text, attachmentIds, mode }
    try {
      await flush()
      if (firstMessage) {
        const title =
          attempt.current.title ??
          (
            await request(
              '/api/tasks/title',
              {
                text:
                  text ||
                  `Work with the attached files: ${attachments.files.map((file) => file.name).join(', ')}`,
              },
              generatedTitleSchema,
            )
          ).title
        attempt.current.title = title
        setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, title })))
        await flush()
      }
      if (connection)
        await request(
          mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
          { id: task.id, messageId: attempt.current.id, text, attachmentIds },
          responses.ok,
        )
      else
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            messages: [...t.messages, { id: crypto.randomUUID(), role: 'user', text }],
          })),
        )
      setWorkspace((w) =>
        updateTask(w, task.id, (t) => ({ ...t, draft: t.draft === task.draft ? '' : t.draft })),
      )
      attempt.current = null
    } catch (e) {
      setError(String(e))
    } finally {
      sendingRequest.current = false
      setSending(false)
    }
  }
  return (
    <div className="shrink-0 px-4 pb-3 pt-2">
      <PromptInput
        className="relative z-10 mx-auto max-w-3xl rounded-[22px] border-border/60 bg-card shadow-none"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          if (connected && !sending && !task.archived)
            void attachments.upload(Array.from(event.dataTransfer.files))
        }}
        onPaste={(event) => {
          if (!event.clipboardData.files.length) return
          event.preventDefault()
          if (connected && !sending && !task.archived)
            void attachments.upload(Array.from(event.clipboardData.files))
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className={cn('px-3', pendingQuestion && 'hidden')}>
          <MessageAttachments
            taskId={task.id}
            files={attachments.files}
            remove={attachments.remove}
            disabled={sending || attachments.busy}
          />
        </div>
        <PromptInputTextarea
          autoFocus={firstMessage}
          aria-label="Message task"
          className={cn('min-h-24 px-4 pt-4 pb-3', pendingQuestion && 'hidden')}
          value={task.draft}
          disabled={sending || task.archived || pendingQuestion}
          onChange={(e) =>
            setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, draft: e.target.value })))
          }
          placeholder={
            task.archived
              ? 'Reopen this task to continue'
              : task.status === 'running'
                ? 'Queue a follow-up while the agent works…'
                : firstMessage
                  ? 'What should get done? Add context or constraints…'
                  : 'Ask for changes or share context…'
          }
        />
        <PromptInputFooter className="flex-wrap items-center gap-2 px-3 pb-3 pt-2">
          <PromptInputTools className={cn('flex-wrap gap-0.5', pendingQuestion && 'hidden')}>
            <ComposerHarnessControls task={task} disabled={sending || !!task.archived} />
          </PromptInputTools>
          {pendingQuestion && (
            <span className="text-xs text-muted-foreground">
              Answer the question above to continue.
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!pendingQuestion && (
              <AttachmentPicker
                disabled={!connected || sending || !!task.archived || attachments.busy}
                upload={attachments.upload}
              />
            )}

            {task.status === 'running' && hasInput && !pendingQuestion && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-[11px]"
                  title="Send guidance to the active turn; other harnesses interrupt and resume"
                  aria-label="Steer agent"
                  disabled={
                    !connected ||
                    sending ||
                    stopping ||
                    attachments.busy ||
                    task.archived ||
                    (!task.draft.trim() && !attachments.files.length)
                  }
                  onClick={() => void send('steer')}
                >
                  <CornerUpRight className="size-3.5" /> Steer
                </Button>
              </>
            )}
            {!pendingQuestion && (task.status !== 'running' || hasInput) && (
              <PromptInputSubmit
                busy={sending}
                className={
                  task.status === 'running'
                    ? 'h-8 w-auto gap-1.5 rounded-md bg-muted px-2 text-[11px] text-foreground hover:bg-accent'
                    : 'size-9 rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-35'
                }
                title={
                  task.status === 'running' || task.queuePaused
                    ? 'Queue follow-up (Enter)'
                    : 'Send message (Enter)'
                }
                aria-label={
                  task.status === 'running' || task.queuePaused
                    ? 'Queue follow-up'
                    : connected
                      ? 'Send to agent'
                      : 'Save message to task'
                }
                disabled={
                  (!task.draft.trim() && !attachments.files.length) ||
                  sending ||
                  stopping ||
                  attachments.busy ||
                  task.archived ||
                  (!!connection && !connected) ||
                  (firstMessage && (!connected || !task.repositoryId || !agent))
                }
              >
                {sending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : task.status === 'running' || task.queuePaused ? (
                  <ListPlus className="size-4" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
                {task.status === 'running' && 'Queue'}
              </PromptInputSubmit>
            )}
            {task.status === 'running' && (
              <Button
                type="button"
                size="icon"
                className="size-8 shrink-0 rounded-full"
                aria-label="Stop"
                title="Stop the agent and pause queued messages"
                disabled={!connected || stopping || task.archived}
                onClick={() => void stop()}
              >
                {stopping ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Square className="size-3.5 fill-current" />
                )}
              </Button>
            )}
          </div>
        </PromptInputFooter>
        {(error || attachments.error) && (
          <p role="alert" className="px-3 pb-2 text-xs text-destructive">
            {error || attachments.error}
          </p>
        )}
      </PromptInput>
      <div className={pendingQuestion ? 'hidden' : undefined}>
        <ComposerWorkspace task={task} disabled={sending || !!task.archived} />
        <p className="mx-auto mt-1 hidden max-w-3xl text-right text-[10px] text-muted-foreground/70">
          {task.status === 'running' || task.queuePaused ? 'Enter to queue' : 'Enter to send'} ·
          Shift + Enter for a new line
        </p>
      </div>
    </div>
  )
}
