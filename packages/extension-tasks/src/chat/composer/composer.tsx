import { permissionPolicyUIIssue } from '@dovo/studio-ui'
import { randomUUID, checkpointCanUndo, taskForkResultSchema } from '@dovo/protocol'
import { projectPrompts } from '@dovo/protocol'
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
import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useCommittedCallback } from '../../detail/use-committed-callback'
import { useComposerDraft } from './use-composer-draft'
import { ComposerCommandDialog } from './composer-command-dialog'
import type { ComposerCommandId } from './file-mentions'
import { ComposerEditor } from './composer-editor'
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
  Minimize2,
  GitBranchPlus,
  ChevronDown,
} from 'lucide-react'
import { useWorkspace, useStudioHost, updateTask, responses, type Task } from '@dovo/studio-core'
import {
  Button,
  IconButton,
  ComposerSurface,
  ComposerSubmit,
  DropdownMenu,
  cn,
} from '@dovo/studio-ui'
import { ComposerHarnessControls } from './composer-harness-controls'
import { ComposerWorkspace } from './composer-workspace'
export function Composer({
  task,
  collapsed = false,
  onPending,
  onAside,
  composerInsert,
  onComposerInsertApplied,
  workspaceControls,
  queuedMessages,
  temporary = false,
}: {
  task: Task
  temporary?: boolean
  workspaceControls?: import('react').ReactNode
  queuedMessages?: ReactNode
  collapsed?: boolean
  onPending: (pending: PendingMessage | null) => void
  /** Opens side chats, selecting a newly sent question when provided. */
  onAside?: (chatId?: string) => void
  composerInsert?: { id: string; text: string } | null
  onComposerInsertApplied?: () => void
}) {
  const { workspace, setWorkspace, request, connected, connection, flush, snapshot } =
    useWorkspace()
  const [error, setError] = useApplicationState(''),
    [submitBusy, setSending] = useApplicationState(false),
    [stopping, setStopping] = useApplicationState(false)
  const [machineMoving, setMachineMoving] = useApplicationState(false)
  const [asideBusy, setAsideBusy] = useState(false)
  const [asideCreating, setAsideCreating] = useState(false)
  const asideRequest = useRef<'saving' | 'asking' | null>(null)
  const sending = submitBusy || machineMoving || asideCreating
  const sendingRequest = useRef(false)
  const [fileDrag, setFileDrag] = useState(false)
  const attachments = useAttachments(task)
  const composerDraft = useComposerDraft(task, temporary)
  const askAside = useCommittedCallback(async () => {
    if (
      !onAside ||
      !connected ||
      sendingRequest.current ||
      asideRequest.current ||
      sending ||
      task.archived ||
      task.archivedAt
    )
      return
    const text = composerDraft.controller.text
    if (!text.trim()) {
      onAside()
      return
    }
    if (text.length > 4000) {
      setError('Side questions can contain up to 4,000 characters.')
      return
    }
    asideRequest.current = 'saving'
    setAsideBusy(true)
    setAsideCreating(true)
    setError('')
    try {
      // Persist the question before consuming the main draft. A failed ask stays retryable here.
      const chat = await request(
        '/api/tasks/side-chat/save',
        { id: task.id, draft: text },
        mutableStruct({ id: Schema.String }),
      )
      composerDraft.accept(text)
      asideRequest.current = 'asking'
      setAsideCreating(false)
      onAside(chat.id)
      await request(
        '/api/tasks/side-chat/ask',
        { id: task.id, chatId: chat.id, question: text },
        mutableStruct({ answer: Schema.String }),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      asideRequest.current = null
      setAsideBusy(false)
      setAsideCreating(false)
    }
  })
  useEffect(() => {
    if (!onAside) return
    const handle = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== task.id) return
      event.preventDefault()
      void askAside()
    }
    window.addEventListener('dovo:ask-side-question', handle)
    return () => window.removeEventListener('dovo:ask-side-question', handle)
  }, [task.id, onAside, askAside])
  const host = useStudioHost()
  const forkAttempt = useRef<{ id: string; text: string; attachmentIds: string[] } | null>(null)
  const setDraft = composerDraft.update
  const [submittedText, setSubmittedText] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const appliedInsert = useRef<string | null>(null)
  useEffect(() => {
    if (!composerInsert || appliedInsert.current === composerInsert.id) return
    appliedInsert.current = composerInsert.id
    setDraft((current) => [current.trimEnd(), composerInsert.text].filter(Boolean).join('\n\n'))
    input.current?.focus()
    onComposerInsertApplied?.()
  }, [composerInsert, setDraft, onComposerInsertApplied])
  const [command, setCommand] = useState<'new-session' | 'undo' | null>(null)
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [compactBusy, setCompactBusy] = useState(false)
  const meter = contextMeter(task)
  const compactDisabled =
    !connected ||
    sending ||
    compactBusy ||
    task.status === 'running' ||
    !!task.archived ||
    !!task.archivedAt ||
    !task.sessionId ||
    !!task.queue?.length
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
    .find((turn) => turn.status !== 'running' && checkpointCanUndo(turn.checkpoint))
  const undoableId = undoable?.id ?? task.historyTotals?.undoableTurnId
  const runCommand = (id: ComposerCommandId) => {
    setCommandError('')
    if (id === 'review')
      void request(
        '/api/tasks/message',
        { id: task.id, messageId: randomUUID(), text: REVIEW_PROMPT, review: true },
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
        : undoableId
          ? request(
              '/api/tasks/turn/restore',
              { id: task.id, turnId: undoableId, direction: 'undo' },
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
    () => taskResources(task, workspace, snapshot?.defaults),
    [
      task.id,
      task.agentId,
      task.agentOverrides,
      task.harness,
      task.repositoryId,
      workspace.agents,
      workspace.repositories,
      snapshot?.defaults,
    ],
  )
  const [managingPrompts, setManagingPrompts] = useState(false)
  const pendingQuestion = !!snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  const hasInput = composerDraft.hasText || attachments.files.length > 0
  const attempt = useRef<{
    id: string
    text: string
    attachmentIds: string[]
    mode: 'queue' | 'steer'
    title?: string
    accepted?: boolean
    runId?: string
  } | null>(null)
  const pendingSubmission = useRef<string | null>(null)
  const acceptDraft = composerDraft.accept
  useEffect(() => {
    const id = pendingSubmission.current
    if (!id || ![...task.messages, ...(task.queue ?? [])].some((message) => message.id === id))
      return
    const submitted = attempt.current
    if (submitted?.id === id && !submitted.accepted) {
      submitted.accepted = true
      acceptDraft(submitted.text)
    }
    pendingSubmission.current = null
    onPending(null)
  }, [task.messages, task.queue, acceptDraft, onPending])
  const firstMessage = task.messages.length === 0 && !task.queue?.length && !task.turns?.length
  const agent = resolveTaskAgent(task, workspace.agents)
  const policyIssue = agent
    ? permissionPolicyUIIssue(agent, snapshot?.permissionPolicySupported === true)
    : undefined
  // Settings → General → Follow-ups while a task runs: what Enter does mid-turn.
  const steerFirst = useAppPreferences().followUp === 'steer' && task.status === 'running'
  const other = steerFirst ? 'queue' : 'steer'
  const stop = async () => {
    const runId = task.activeRunId
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
          runId,
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
    if (policyIssue) {
      setError(policyIssue)
      return
    }
    const text = composerDraft.controller.text.trim()
    const attachmentIds = attachments.files.map((f) => f.id)
    if (
      (!text && !attachmentIds.length) ||
      sending ||
      sendingRequest.current ||
      asideRequest.current === 'saving' ||
      stopping ||
      attachments.busy ||
      task.archivedAt ||
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
        id: randomUUID(),
        text,
        attachmentIds,
        mode,
        runId: mode === 'steer' ? task.activeRunId : undefined,
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
    pendingSubmission.current = pending.message.id
    onPending(pending)
    try {
      composerDraft.flush()
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
      if (connection) {
        const result = await request(
          mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
          {
            id: task.id,
            messageId: attempt.current.id,
            runId: attempt.current.runId,
            text,
            attachmentIds,
          },
          responses.ok,
        )
        if (result.pending) onPending({ ...pending, state: 'saved' })
      } else
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            messages: [...t.messages, pending.message],
            ...(t.archived ? { archived: false, autoSettled: undefined, snoozedUntil: null } : {}),
          })),
        )
      if (!attempt.current.accepted) composerDraft.accept(text)
      attempt.current = null
    } catch (e) {
      if (attempt.current?.accepted) {
        attempt.current = null
      } else {
        onPending({ ...pending, state: 'failed' })
        setError(String(e))
      }
    } finally {
      sendingRequest.current = false
      setSending(false)
    }
  }
  const startFork = async () => {
    if (policyIssue) {
      setError(policyIssue)
      return
    }
    const text = composerDraft.controller.text.trim()
    const attachmentIds = attachments.files.map((file) => file.id)
    if (
      !connected ||
      sendingRequest.current ||
      asideRequest.current === 'saving' ||
      sending ||
      stopping ||
      attachments.busy ||
      (!text && !attachmentIds.length)
    )
      return
    sendingRequest.current = true
    setSending(true)
    setSubmittedText(text)
    setError('')
    if (
      forkAttempt.current?.text !== text ||
      JSON.stringify(forkAttempt.current.attachmentIds) !== JSON.stringify(attachmentIds)
    )
      forkAttempt.current = { id: randomUUID(), text, attachmentIds }
    try {
      composerDraft.flush()
      await flush()
      const fork = await request(
        '/api/tasks/start-fork',
        { id: task.id, forkId: forkAttempt.current.id, text, attachmentIds },
        taskForkResultSchema,
      )
      setWorkspace((workspace) =>
        updateTask(workspace, task.id, (current) => ({
          ...current,
          draftAttachments: current.draftAttachments?.filter(
            (file) => !attachmentIds.includes(file.id),
          ),
        })),
      )
      composerDraft.accept(text)
      forkAttempt.current = null
      host.navigate({ viewId: 'tasks', entityId: fork.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      sendingRequest.current = false
      setSending(false)
    }
  }
  return (
    <div className="shrink-0 px-3 pb-2 pt-1">
      {meter && meter.level !== 'ok' && !pendingQuestion && (
        <div className="mx-auto mb-1 flex max-w-[var(--chat-max)] justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1.5 rounded-full border border-border/60 px-2.5 text-[0.6875rem] font-normal text-muted-foreground"
            title={meter.label}
            disabled={compactDisabled}
            onClick={compact}
          >
            {compactBusy ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Minimize2 className="size-3" />
            )}
            {compactBusy ? 'Compacting…' : 'Compact context'}
          </Button>
        </div>
      )}
      {queuedMessages}
      <ComposerSurface
        collapsed={collapsed}
        controls={
          pendingQuestion ? (
            <span className="text-xs text-muted-foreground">
              Answer the question above to continue.
            </span>
          ) : (
            <ComposerHarnessControls task={task} disabled={sending || !!task.archived} />
          )
        }
        actions={
          <>
            <ContextMeter task={task} />
            {onAside && !firstMessage && (
              <IconButton
                label="Ask a side question (⌘/Ctrl+;)"
                type="button"
                className="size-7"
                disabled={
                  !connected || sending || asideBusy || !!task.archived || !!task.archivedAt
                }
                onClick={() => void askAside()}
              >
                <MessageCircleQuestion className="size-3.5" />
              </IconButton>
            )}
            {!pendingQuestion && (
              <AttachmentPicker
                disabled={!connected || sending || !!task.archivedAt || attachments.busy}
                upload={attachments.upload}
              />
            )}

            {!pendingQuestion && (task.status !== 'running' || hasInput) && (
              <div className="flex shrink-0 items-center" role="group" aria-label="Send message">
                <ComposerSubmit
                  busy={sending}
                  className={
                    task.status === 'running'
                      ? 'h-8 w-auto gap-1.5 rounded-l-md rounded-r-none bg-muted px-2 text-[0.6875rem] text-foreground hover:bg-accent'
                      : undefined
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
                    !!policyIssue ||
                    (!composerDraft.hasText && !attachments.files.length) ||
                    sending ||
                    stopping ||
                    attachments.busy ||
                    !!task.archivedAt ||
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
                </ComposerSubmit>
                {task.status === 'running' && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="More message actions"
                        title="Other ways to send this message"
                        className="h-8 w-6 rounded-l-none rounded-r-md border-l border-border/60 bg-muted p-0 hover:bg-accent"
                        disabled={
                          !connected || sending || stopping || attachments.busy || !!task.archivedAt
                        }
                      >
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        side="top"
                        align="end"
                        sideOffset={6}
                        className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
                      >
                        <DropdownMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                          disabled={!!policyIssue || !!task.archived}
                          onSelect={() => void send(other)}
                        >
                          {other === 'steer' ? (
                            <CornerUpRight className="size-3.5" />
                          ) : (
                            <ListPlus className="size-3.5" />
                          )}
                          {other === 'steer' ? 'Steer agent' : 'Queue follow-up'}
                          <span className="ml-auto text-[0.625rem] text-muted-foreground">
                            Alt+Enter
                          </span>
                        </DropdownMenu.Item>
                        {task.repositoryId &&
                          !workspace.repositories.find((repo) => repo.id === task.repositoryId)
                            ?.kind && (
                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                              disabled={!!task.archived}
                              onSelect={() => void startFork()}
                            >
                              <GitBranchPlus className="size-3.5" /> Fork
                            </DropdownMenu.Item>
                          )}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                )}
              </div>
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
          </>
        }
        error={error || policyIssue || composerDraft.error || attachments.error}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          const allowed = connected && !sending && !attachments.busy && !task.archivedAt
          event.dataTransfer.dropEffect = allowed ? 'copy' : 'none'
          setFileDrag(allowed)
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return
          setFileDrag(false)
        }}
        onDrop={(event) => {
          setFileDrag(false)
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          if (connected && !sending && !task.archivedAt)
            void attachments.upload(Array.from(event.dataTransfer.files))
        }}
        onPaste={(event) => {
          if (!event.clipboardData.files.length) return
          event.preventDefault()
          if (connected && !sending && !task.archivedAt)
            void attachments.upload(Array.from(event.clipboardData.files))
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void send(steerFirst ? 'steer' : 'queue')
        }}
      >
        {fileDrag && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-primary bg-card/95 text-sm"
          >
            Drop files to attach
          </div>
        )}
        <div className={cn('px-3', pendingQuestion && 'hidden')}>
          <MessageAttachments
            compact
            taskId={task.id}
            files={submitBusy ? [] : attachments.files}
            previews={attachments.previews}
            remove={attachments.remove}
            disabled={sending || attachments.busy}
          />
        </div>
        {!!attachments.uploading.length && (
          <div
            className="flex flex-wrap gap-1.5 px-3 py-1"
            role="status"
            aria-label="Uploading attachments"
          >
            {attachments.uploading.map(({ attachment, url }) => (
              <div
                key={attachment.id}
                className="flex h-7 min-w-0 max-w-52 items-center gap-1.5 rounded-md border bg-secondary/40 px-1.5 text-[0.6875rem]"
              >
                {url && (
                  <img
                    src={url}
                    alt={attachment.name}
                    className="size-5 shrink-0 rounded object-cover"
                  />
                )}
                <span className="min-w-0 truncate" title={attachment.name}>
                  {attachment.name}
                </span>
                <span className="animate-pulse text-muted-foreground">Uploading…</span>
              </div>
            ))}
          </div>
        )}
        <ComposerEditor
          onAlternativeSubmit={task.status === 'running' ? () => void send(other) : undefined}
          controller={composerDraft.controller}
          messages={task.messages}
          taskId={task.id}
          input={input}
          resources={resources}
          prompts={projectPrompts(
            workspace.repositories.find((repository) => repository.id === task.repositoryId),
            snapshot?.defaults,
          )}
          onCommand={
            task.messages.length || task.queue?.length || task.turns?.length
              ? runCommand
              : undefined
          }
          onManagePrompts={task.repositoryId ? () => setManagingPrompts(true) : undefined}
          autoFocus={firstMessage}
          hidden={pendingQuestion}
          disabled={machineMoving || !!task.archivedAt || pendingQuestion}
          submitBusy={submitBusy}
          submittedText={submittedText}
          placeholder={
            task.archivedAt
              ? 'Restore this archived thread to continue'
              : task.archived
                ? 'Send a message to reopen this thread…'
                : task.status === 'running'
                  ? steerFirst
                    ? 'Steer the agent while it works…'
                    : 'Queue a follow-up while the agent works…'
                  : firstMessage
                    ? 'What would you like to build or fix?'
                    : 'Ask a follow-up or describe a change…'
          }
        />
      </ComposerSurface>
      {managingPrompts && task.repositoryId && (
        <SavedPromptsDialog
          repositoryId={task.repositoryId}
          onClose={() => setManagingPrompts(false)}
        />
      )}
      <ComposerCommandDialog
        command={command}
        commandBusy={commandBusy}
        canUndo={!!undoableId}
        connected={connected}
        running={task.status === 'running'}
        error={commandError}
        onClose={() => setCommand(null)}
        onConfirm={confirmCommand}
      />
      <div className={pendingQuestion ? 'hidden' : undefined}>
        {workspaceControls ?? (
          <ComposerWorkspace
            task={task}
            disabled={sending || !!task.archived}
            onMachineMoving={setMachineMoving}
          />
        )}
        <p className="mx-auto mt-1 hidden max-w-[var(--chat-max)] text-right text-[0.625rem] text-muted-foreground/70">
          {task.status === 'running'
            ? steerFirst
              ? 'Enter to steer · Alt+Enter to queue'
              : 'Enter to queue · Alt+Enter to steer'
            : 'Enter to send'}{' '}
          · Shift + Enter for a new line
        </p>
      </div>
    </div>
  )
}
