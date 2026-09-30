import { pendingMessageDestination, type PendingMessage } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  generatedTitleSchema,
  readAppPreferences,
  resolveTaskAgent,
  useAppPreferences,
} from '@dovo/studio-core'
import { AttachmentPicker } from './attachment-picker'
import { MessageAttachments } from './message-attachments'
import { useAttachments } from './use-attachments'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useFileMentions, type ComposerCommandId } from './file-mentions'
import { SavedPromptsDialog } from '../../dialogs/saved-prompts-dialog'
import { REVIEW_PROMPT, contextMeter, taskResources } from '@dovo/protocol'
import { ContextMeter } from '../thread/context-meter'
import {
  ArrowUp,
  LoaderCircle,
  ListPlus,
  MessageCircleQuestion,
  Square,
  CornerUpRight,
} from 'lucide-react'
import { useWorkspace, updateTask, responses, type Task } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  cn,
} from '@dovo/studio-ui'
import { ComposerHarnessControls } from './composer-harness-controls'
import { ComposerWorkspace } from './composer-workspace'
import type { CodeReference } from '../../detail/code-reference'
export function Composer({
  task,
  onPending,
  onAside,
  codeReference,
  composerInsert,
  onComposerInsertApplied,
}: {
  task: Task
  onPending: (pending: PendingMessage | null) => void
  /** Opens the side question dialog. */
  onAside?: () => void
  codeReference?: CodeReference | null
  composerInsert?: { id: string; text: string } | null
  onComposerInsertApplied?: () => void
}) {
  const { workspace, setWorkspace, request, connected, connection, flush, snapshot } =
    useWorkspace()
  const [error, setError] = useApplicationState(''),
    [submitBusy, setSending] = useApplicationState(false),
    [stopping, setStopping] = useApplicationState(false)
  const [machineMoving, setMachineMoving] = useApplicationState(false)
  const sending = submitBusy || machineMoving
  const sendingRequest = useRef(false)
  const attachments = useAttachments(task)
  // Draft text is edited locally and written back to the workspace on a short debounce.
  // Routing every keystroke through setWorkspace would deep-diff and sync the whole
  // workspace, re-rendering every useWorkspace consumer on each character typed.
  const [draft, setDraft] = useState(task.draft)
  const [submittedText, setSubmittedText] = useState<string | null>(null)
  const visibleDraft =
    submitBusy && submittedText !== null && draft.trim() === submittedText ? '' : draft
  const insertedReference = useRef<string | null>(null)
  const insertedAnswer = useRef<string | null>(null)
  useEffect(() => {
    if (!composerInsert || insertedAnswer.current === composerInsert.id) return
    insertedAnswer.current = composerInsert.id
    setDraft((current) => [current.trimEnd(), composerInsert.text].filter(Boolean).join('\n\n'))
    input.current?.focus()
    onComposerInsertApplied?.()
  }, [composerInsert])
  useEffect(() => {
    if (
      !codeReference ||
      codeReference.taskId !== task.id ||
      insertedReference.current === codeReference.id
    )
      return
    insertedReference.current = codeReference.id
    setDraft((current) => [current.trimEnd(), codeReference.text].filter(Boolean).join('\n\n'))
  }, [codeReference, task.id])
  const lastWritten = useRef(task.draft)
  useEffect(() => {
    // Adopt external draft changes (e.g. moving the task to another machine) without
    // clobbering in-progress typing.
    if (task.draft !== lastWritten.current) {
      lastWritten.current = task.draft
      setDraft(task.draft)
    }
  }, [task.draft])
  const writeDraft = useRef((_value: string) => {})
  writeDraft.current = (value: string) => {
    try {
      setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, draft: value })))
      lastWritten.current = value
    } catch {
      // A connection change refuses edits; the next change or unmount retries the write.
    }
  }
  const unwritten = useRef<string | null>(null)
  useEffect(() => {
    if (draft === lastWritten.current) {
      unwritten.current = null
      return
    }
    unwritten.current = draft
    const timer = setTimeout(() => {
      unwritten.current = null
      writeDraft.current(draft)
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, task.id, setWorkspace])
  // Leaving the task inside the debounce window must not drop the last typed characters.
  useEffect(
    () => () => {
      if (unwritten.current !== null && unwritten.current !== lastWritten.current)
        writeDraft.current(unwritten.current)
    },
    [],
  )
  const input = useRef<HTMLTextAreaElement>(null)
  const [command, setCommand] = useState<'new-session' | 'undo' | null>(null)
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [compactBusy, setCompactBusy] = useState(false)
  const meter = contextMeter(task)
  const compact = () => {
    if (compactBusy) return
    setCompactBusy(true)
    setError('')
    void request('/api/tasks/compact', { id: task.id }, responses.ok)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setCompactBusy(false))
  }
  // The newest turn whose file changes can still be undone.
  const undoable = [...(task.turns ?? [])]
    .reverse()
    .find(
      (turn) =>
        turn.status !== 'running' &&
        !!turn.checkpoint?.after &&
        !turn.checkpoint.error &&
        !turn.checkpoint.undone &&
        turn.checkpoint.files.length + turn.checkpoint.omitted.length > 0,
    )
  const runCommand = (id: ComposerCommandId) => {
    setCommandError('')
    if (id === 'review')
      void request(
        '/api/tasks/message',
        { id: task.id, messageId: crypto.randomUUID(), text: REVIEW_PROMPT, review: true },
        responses.ok,
      ).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    else if (id === 'compact') compact()
    else setCommand(id)
  }
  const confirmCommand = () => {
    if (!command || commandBusy) return
    setCommandBusy(true)
    setCommandError('')
    const work =
      command === 'new-session'
        ? request('/api/tasks/new-session', { id: task.id }, responses.ok)
        : undoable
          ? request(
              '/api/tasks/turn/restore',
              { id: task.id, turnId: undoable.id, direction: 'undo' },
              responses.ok,
            )
          : Promise.reject(new Error('There is no turn with file changes to undo.'))
    void work
      .then(() => setCommand(null))
      .catch((cause: unknown) =>
        setCommandError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setCommandBusy(false))
  }
  const resources = useMemo(
    () => taskResources(task, workspace),
    [
      task.id,
      task.agentId,
      task.agentOverrides,
      task.harness,
      task.repositoryId,
      workspace.agents,
      workspace.repositories,
    ],
  )
  const mentions = useFileMentions({
    taskId: task.id,
    draft,
    setDraft,
    input,
    resources,
    // A draft has no agent session or turns yet, so commands start with the second message.
    onCommand:
      task.messages.length || task.queue?.length || task.turns?.length ? runCommand : undefined,
    prompts: workspace.repositories.find((repository) => repository.id === task.repositoryId)
      ?.prompts,
    onManagePrompts: task.repositoryId ? () => setManagingPrompts(true) : undefined,
  })
  const [managingPrompts, setManagingPrompts] = useState(false)
  const pendingQuestion = !!snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  const hasInput = !!draft.trim() || attachments.files.length > 0
  const attempt = useRef<{
    id: string
    text: string
    attachmentIds: string[]
    mode: 'queue' | 'steer'
    title?: string
  } | null>(null)
  const firstMessage = task.messages.length === 0 && !task.queue?.length && !task.turns?.length
  const agent = resolveTaskAgent(task, workspace.agents)
  // Settings → General → Follow-ups while a task runs: what Enter does mid-turn.
  const steerFirst = useAppPreferences().followUp === 'steer' && task.status === 'running'
  const other = steerFirst ? 'queue' : 'steer'
  const stop = async () => {
    // Settings → General → Confirm before stopping a running task.
    if (
      readAppPreferences().confirmStop &&
      !window.confirm(
        `Stop “${task.title}”? Queued messages stay paused until you continue or send a follow-up.`,
      )
    )
      return
    setStopping(true)
    setError('')
    try {
      await request(
        '/api/tasks/cancel',
        {
          id: task.id,
        },
        responses.ok,
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setStopping(false)
    }
  }
  const send = async (mode: 'queue' | 'steer' = 'queue') => {
    const text = draft.trim()
    const attachmentIds = attachments.files.map((f) => f.id)
    if (
      (!text && !attachmentIds.length) ||
      machineMoving ||
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
    setSubmittedText(text)
    if (
      attempt.current?.mode !== mode ||
      attempt.current?.text !== text ||
      JSON.stringify(attempt.current.attachmentIds) !== JSON.stringify(attachmentIds)
    )
      attempt.current = {
        id: crypto.randomUUID(),
        text,
        attachmentIds,
        mode,
      }
    const pending: PendingMessage = {
      taskId: task.id,
      state: 'sending',
      destination: pendingMessageDestination(task, mode),
      message: {
        id: attempt.current.id,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
        attachments: attachments.files,
      },
    }
    onPending(pending)
    try {
      await flush()
      if (firstMessage) {
        const summary =
          text ||
          `Work with the attached files: ${attachments.files.map((file) => file.name).join(', ')}`
        // A title is a convenience: without a title harness, or when it is slow or failing,
        // the first message still sends under its first line.
        const title =
          attempt.current.title ??
          (await request('/api/tasks/title', { text: summary }, generatedTitleSchema).then(
            (result) => result.title,
            () => summary.split('\n')[0]?.trim().slice(0, 80) || 'New task',
          ))
        attempt.current.title = title
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            title,
          })),
        )
        await flush()
      }
      if (connection)
        await request(
          mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
          {
            id: task.id,
            messageId: attempt.current.id,
            text,
            attachmentIds,
          },
          responses.ok,
        )
      else
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            messages: [...t.messages, pending.message],
          })),
        )
      lastWritten.current = ''
      setDraft((current) => (current.trim() === text ? '' : current))
      setWorkspace((w) =>
        updateTask(w, task.id, (t) => ({
          ...t,
          draft: t.draft.trim() === text ? '' : t.draft,
        })),
      )
      attempt.current = null
    } catch (e) {
      onPending({ ...pending, state: 'failed' })
      setError(String(e))
    } finally {
      sendingRequest.current = false
      setSending(false)
    }
  }
  return (
    <div className="shrink-0 px-3 pb-2 pt-1">
      <PromptInput
        className="studio-composer relative z-10 mx-auto max-w-[var(--chat-max)] rounded-2xl border-border/70 bg-card shadow-none"
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
          void send(steerFirst ? 'steer' : 'queue')
        }}
      >
        <div className={cn('px-3', pendingQuestion && 'hidden')}>
          <MessageAttachments
            taskId={task.id}
            files={submitBusy ? [] : attachments.files}
            remove={attachments.remove}
            disabled={sending || attachments.busy}
          />
        </div>
        {!submitBusy && mentions.menu}
        <PromptInputTextarea
          ref={input}
          autoFocus={firstMessage}
          aria-label="Message task"
          data-task-id={task.id}
          aria-autocomplete="list"
          aria-expanded={mentions.open && !submitBusy}
          className={cn('min-h-24 max-h-64 px-4 pt-4 pb-2', pendingQuestion && 'hidden')}
          value={visibleDraft}
          disabled={machineMoving || task.archived || pendingQuestion}
          readOnly={submitBusy}
          onKeyDown={mentions.onKeyDown}
          onSelect={mentions.track}
          onChange={(e) => {
            setDraft(e.target.value)
            mentions.track()
          }}
          placeholder={
            task.archived
              ? 'Reopen this task to continue'
              : task.status === 'running'
                ? 'Queue a follow-up while the agent works…'
                : firstMessage
                  ? 'What would you like to build or fix?'
                  : 'Ask a follow-up or describe a change…'
          }
        />
        <PromptInputFooter className="flex-wrap items-center gap-1.5 px-2.5 pb-2 pt-1">
          <PromptInputTools className={cn('flex-wrap gap-0.5', pendingQuestion && 'hidden')}>
            <ComposerHarnessControls task={task} disabled={sending || !!task.archived} />
          </PromptInputTools>
          {pendingQuestion && (
            <span className="text-xs text-muted-foreground">
              Answer the question above to continue.
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ContextMeter task={task} />
            {meter && meter.level !== 'ok' && (
              <span role="status" className="text-[0.625rem] text-amber-400">
                Compact suggested
              </span>
            )}
            {onAside && !firstMessage && (
              <IconButton
                label="Ask a side question (⌘/Ctrl+;)"
                className="size-7"
                disabled={!connected}
                onClick={onAside}
              >
                <MessageCircleQuestion className="size-3.5" />
              </IconButton>
            )}
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
                  className="h-8 gap-1.5 px-2 text-[0.6875rem]"
                  title={
                    other === 'steer'
                      ? 'Send guidance to the active turn; other harnesses interrupt and resume'
                      : 'Send after the current turn finishes'
                  }
                  aria-label={other === 'steer' ? 'Steer agent' : 'Queue follow-up'}
                  disabled={
                    !connected ||
                    sending ||
                    stopping ||
                    attachments.busy ||
                    task.archived ||
                    (!draft.trim() && !attachments.files.length)
                  }
                  onClick={() => void send(other)}
                >
                  {other === 'steer' ? (
                    <>
                      <CornerUpRight className="size-3.5" /> Steer
                    </>
                  ) : (
                    <>
                      <ListPlus className="size-3.5" /> Queue
                    </>
                  )}
                </Button>
              </>
            )}
            {!pendingQuestion && (task.status !== 'running' || hasInput) && (
              <PromptInputSubmit
                busy={sending}
                className={
                  task.status === 'running'
                    ? 'h-8 w-auto gap-1.5 rounded-md bg-muted px-2 text-[0.6875rem] text-foreground hover:bg-accent'
                    : 'size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-35'
                }
                title={
                  steerFirst
                    ? 'Steer agent (Enter)'
                    : task.status === 'running'
                      ? 'Queue follow-up (Enter)'
                      : 'Send message (Enter)'
                }
                aria-label={
                  steerFirst
                    ? 'Steer agent'
                    : task.status === 'running'
                      ? 'Queue follow-up'
                      : connected
                        ? 'Send to agent'
                        : 'Save message to task'
                }
                disabled={
                  (!draft.trim() && !attachments.files.length) ||
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
                ) : steerFirst ? (
                  <CornerUpRight className="size-4" />
                ) : task.status === 'running' ? (
                  <ListPlus className="size-4" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
                {task.status === 'running' && (steerFirst ? 'Steer' : 'Queue')}
              </PromptInputSubmit>
            )}
            {task.status === 'running' && (
              <Button
                type="button"
                size="icon"
                variant="destructive"
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
      {managingPrompts && task.repositoryId && (
        <SavedPromptsDialog
          repositoryId={task.repositoryId}
          onClose={() => setManagingPrompts(false)}
        />
      )}
      <Dialog open={!!command} onOpenChange={(open) => !open && !commandBusy && setCommand(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="text-sm">
            {command === 'undo' ? 'Undo the last turn’s changes?' : 'Start a new agent session?'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {command === 'undo'
              ? undoable
                ? 'The files that turn changed go back to how they were before it. Your current files are saved first, so you can redo this from the turn.'
                : 'No turn has file changes left to undo.'
              : 'The next message starts the agent fresh, with this conversation as context. The current session is not deleted.'}
          </DialogDescription>
          {commandError && (
            <p role="alert" className="text-xs text-destructive">
              {commandError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={commandBusy} onClick={() => setCommand(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                commandBusy ||
                !connected ||
                task.status === 'running' ||
                (command === 'undo' && !undoable)
              }
              onClick={confirmCommand}
            >
              {command === 'undo' ? 'Undo changes' : 'Start fresh'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className={pendingQuestion ? 'hidden' : undefined}>
        <ComposerWorkspace
          task={task}
          disabled={sending || !!task.archived}
          onMachineMoving={setMachineMoving}
        />
        <p className="mx-auto mt-1 hidden max-w-[var(--chat-max)] text-right text-[0.625rem] text-muted-foreground/70">
          {task.status === 'running' ? 'Enter to queue' : 'Enter to send'} · Shift + Enter for a new
          line
        </p>
      </div>
    </div>
  )
}
