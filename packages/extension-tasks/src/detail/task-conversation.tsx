import { ThreadSharing, InlineThreadSuggestions } from '../chat/thread-sharing'
import { CodeReviewCard } from '../review/code-review-card'
import type { CodeFinding } from '@dovo/protocol'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, GitFork, Folder } from 'lucide-react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  taskBudgetUsage,
  taskPreparation,
  mergePendingMessages,
  pendingMessageQueue,
  startingConversationMessage,
  type PendingMessage,
  type ArtifactReference,
} from '@dovo/protocol'
import { ComposerActivity } from '../chat/composer/composer-activity'
import { TaskQuestions } from '../chat/thread/task-questions'
import { RunControls } from '../chat/actions/run-controls'
import {
  useAppPreferences,
  formatDateTime,
  responses,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { ChatThread } from '../chat/thread/chat-thread'
import { Composer } from '../chat/composer/composer'
import { TaskEmptyState } from '../task-creation/task-empty-state'
import { PreparationProgress } from '../chat/thread/preparation-progress'
import { ReviewCommentsTray } from '../chat/thread/review-comments-tray'
import { PlanApproval } from '../chat/thread/plan-approval'
import { ReviewFindings } from '../chat/thread/review-findings'
import { useTaskViewed } from '../chat/thread/use-task-viewed'
import { Button } from '@dovo/studio-ui'
import { ArtifactOpenContext } from '../chat/artifact-open-context'
import { TaskPullLinkDialog } from '../dialogs/task-pull-link-dialog'
import { ChatImageEditProvider } from '../chat/composer/chat-image-edit'
export function TaskConversation({
  task,
  historyLoaded,
  historyError,
  onReview,
  onCodeReview,
  onTerminal,
  onBrowser,
  onPullLink,
  onArtifact,
  revealMessage,
  onRevealHandled,
  onAside,
  visible,
  composerInsert,
  onComposerInsertApplied,
  temporary,
  workspaceControls,
}: {
  task: Task
  temporary?: boolean
  workspaceControls?: ReactNode
  historyLoaded?: boolean
  historyError?: string
  onReview: () => void
  onCodeReview?: (finding?: CodeFinding) => void
  onTerminal?: (terminalId: string) => void
  onBrowser?: (url: string) => void
  onPullLink?: (url: string) => boolean
  onArtifact?: (reference: ArtifactReference) => void
  revealMessage?: string
  onRevealHandled?: () => void
  /** Opens the side question dialog. */
  onAside?: (chatId?: string) => void
  visible: boolean
  composerInsert?: { id: string; text: string } | null
  onComposerInsertApplied?: () => void
}) {
  const { collapseComposerOnScroll } = useAppPreferences()
  const [templateInsert, setTemplateInsert] = useState<{
    id: string
    text: string
    taskId: string
  } | null>(null)
  const pendingTemplate = templateInsert?.taskId === task.id ? templateInsert : null
  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const composer = useRef<HTMLDivElement>(null)
  const readingHistory = useCallback(() => {
    // Typing and focus expansion resize the viewport; they must never collapse the editor.
    if (collapseComposerOnScroll && !composer.current?.contains(document.activeElement))
      setComposerCollapsed(true)
  }, [collapseComposerOnScroll])
  const [managePullTask, setManagePullTask] = useState<string | null>(null)
  const [pending, setPending] = useApplicationState<(PendingMessage & { scope: string })[]>([])
  const { pendingMessages: savedMessages, connection, workspace } = useWorkspace()
  const project = workspace.repositories.find((repository) => repository.id === task.repositoryId)
  const pendingScope = JSON.stringify([connection?.address, connection?.token, task.id])
  const onPending = useCallback(
    (message: PendingMessage | null) => {
      setPending((items) =>
        message
          ? [
              ...items.filter(
                (item) => item.scope !== pendingScope || item.message.id !== message.message.id,
              ),
              { ...message, scope: pendingScope },
            ]
          : items,
      )
    },
    [pendingScope],
  )
  const { id, messages, queue, turns, status, compactions } = task
  const visiblePending = useMemo(
    () =>
      mergePendingMessages(
        task,
        savedMessages?.(task) ?? [],
        pending.filter((item) => item.scope === pendingScope),
      ),
    [id, messages, queue, pending, savedMessages, task, pendingScope],
  )
  useEffect(() => {
    setPending((items) => {
      const accepted = new Set([...messages, ...(queue ?? [])].map((item) => item.id))
      const next = items.filter(
        (item) => item.scope !== pendingScope || !accepted.has(item.message.id),
      )
      return next.length === items.length ? items : next
    })
  }, [id, messages, queue, pendingScope])
  const threadPending = visiblePending.filter((item) => item.destination !== 'queue')
  const startingMessage = startingConversationMessage(task)
  const queueTask = {
    ...task,
    queue: pendingMessageQueue(task, visiblePending).filter(
      (message) => message.id !== startingMessage?.id,
    ),
  }
  const displayedTask = useMemo(
    () => ({
      id,
      messages: [
        ...messages,
        ...(startingMessage ? [startingMessage] : []),
        ...threadPending.map((item) => item.message),
      ],
      queue,
      turns,
      status,
      compactions,
      archived: task.archived,
      autoProjectFallback: task.autoProjectFallback,
      historyBefore: task.historyBefore,
      historyRevision: task.historyRevision,
    }),
    [
      id,
      messages,
      queue,
      turns,
      status,
      compactions,
      threadPending,
      startingMessage,
      task.archived,
      task.autoProjectFallback,
      task.historyBefore,
      task.historyRevision,
    ],
  )
  const welcome =
    status === 'draft' &&
    !displayedTask.messages.length &&
    !queue?.length &&
    !turns?.length &&
    !task.historyBefore &&
    !compactions?.length &&
    !historyError
  const { snapshot } = useWorkspace()
  const loaded =
    historyLoaded ?? (!snapshot?.detailTaskIds || snapshot.detailTaskIds.includes(task.id))
  const viewed = useTaskViewed(task, visible && loaded && !temporary)
  const preparation = taskPreparation(task)
  const budget = taskBudgetUsage(task)
  const { request, connected } = useWorkspace()
  const [retrying, setRetrying] = useApplicationState(false)
  const [retryError, setRetryError] = useApplicationState('')
  const retry = () => {
    if (retrying) return
    setRetrying(true)
    setRetryError('')
    void request('/api/tasks/run', { id: task.id }, responses.ok)
      .catch((error: unknown) =>
        setRetryError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setRetrying(false))
  }
  if (!loaded)
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <LoaderCircle className="size-4 animate-spin" />
        {historyError ||
          (connected
            ? 'Loading conversation…'
            : 'This conversation is not cached. Connect its computer to load it.')}
      </div>
    )
  return (
    <ChatImageEditProvider
      key={task.id}
      disabled={!!task.archivedAt || !!task.example}
      onEdit={() => setComposerCollapsed(false)}
    >
      <div
        data-task-conversation={task.id}
        className={`flex h-full min-h-0 flex-col ${welcome ? 'overflow-y-auto' : ''}`}
      >
        {!welcome && !task.example && (
          <div className="flex justify-end px-4 py-1">
            <ThreadSharing taskId={task.id} title={task.title} />
          </div>
        )}
        {temporary ? (
          <TaskEmptyState
            welcome
            projectName={project?.kind !== 'scratch' ? project?.name : undefined}
          />
        ) : (
          <ArtifactOpenContext value={onArtifact}>
            <ChatThread
              emptyState={
                welcome ? (
                  <TaskEmptyState
                    welcome
                    projectName={project?.kind !== 'scratch' ? project?.name : undefined}
                  />
                ) : undefined
              }
              onUseTemplate={(text) =>
                setTemplateInsert({ id: crypto.randomUUID(), text, taskId: task.id })
              }
              footer={
                !task.example && (
                  <InlineThreadSuggestions
                    taskId={task.id}
                    active={visible}
                    onUseSuggestion={(text) => {
                      setTemplateInsert({ id: crypto.randomUUID(), text, taskId: task.id })
                      setComposerCollapsed(false)
                    }}
                  />
                )
              }
              active={visible}
              onReadingHistory={readingHistory}
              onManagePulls={() => setManagePullTask(task.id)}
              task={displayedTask}
              onTerminal={onTerminal}
              onBrowser={onBrowser}
              onPullLink={onPullLink}
              revealMessage={revealMessage}
              onRevealHandled={onRevealHandled}
              pending={threadPending}
            />
          </ArtifactOpenContext>
        )}
        {(budget.tokenExceeded || budget.timeExceeded) && (
          <p
            role="status"
            className="mx-auto w-full max-w-[var(--chat-max)] px-5 py-2 text-xs text-status-warning"
          >
            Task budget reached ·{' '}
            {budget.tokens !== undefined
              ? `${budget.tokens.toLocaleString()} tokens`
              : 'tokens unavailable'}{' '}
            · {Math.round(budget.minutes)} agent minutes. The agent can continue.
          </p>
        )}
        {viewed.error && (
          <div role="status" className="flex items-center gap-2 px-5 text-xs text-muted-foreground">
            <span title={viewed.error}>Couldn’t update read status.</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={viewed.retry}>
              Retry
            </Button>
          </div>
        )}
        {preparation ? (
          <PreparationProgress
            preparation={preparation}
            onRetry={connected ? retry : undefined}
            retrying={retrying}
            retryError={retryError}
          />
        ) : task.status === 'running' && task.runPhase === 'preparing' ? (
          <div
            role="status"
            className="mx-auto flex w-full max-w-[var(--chat-max)] items-center gap-2 px-5 py-2 text-xs text-muted-foreground"
          >
            {task.execution === 'worktree' ? (
              <GitFork className="size-4" />
            ) : (
              <Folder className="size-4" />
            )}
            <span className="flex-1">Starting agent…</span>
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          </div>
        ) : null}
        {task.quotaContinuation && (
          <div
            role="status"
            className="mx-auto flex w-full max-w-[var(--chat-max)] items-center gap-2 px-5 py-2 text-xs text-muted-foreground"
          >
            <span className="flex-1">
              {task.quotaContinuation.resume ? 'Scheduled to resume' : 'Snoozed'} at{' '}
              {formatDateTime(task.quotaContinuation.at)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!connected}
              onClick={() => {
                void request('/api/tasks/quota/cancel', { id: task.id }, responses.ok).catch(
                  (cause) => setRetryError(String(cause)),
                )
              }}
            >
              Cancel continuation
            </Button>
            {retryError && <span role="alert">{retryError}</span>}
          </div>
        )}
        <TaskQuestions taskId={task.id} />
        <RunControls task={task} />
        <PlanApproval task={task} />
        {onCodeReview && <CodeReviewCard task={task} onOpen={onCodeReview} visible={visible} />}
        <ReviewFindings task={task} className="px-5 pb-2" onOpen={onReview} />
        <ReviewCommentsTray task={task} className="px-5 pb-2" />
        <div
          ref={composer}
          className={welcome ? 'mb-auto w-full shrink-0 pb-8' : undefined}
          onFocusCapture={() => setComposerCollapsed(false)}
        >
          <Composer
            collapsed={collapseComposerOnScroll && composerCollapsed}
            key={task.id}
            task={task}
            temporary={temporary}
            workspaceControls={workspaceControls}
            queuedMessages={
              <ComposerActivity key={task.id} task={queueTask} pending={visiblePending} />
            }
            onPending={onPending}
            onAside={onAside}
            composerInsert={pendingTemplate ?? composerInsert}
            onComposerInsertApplied={
              pendingTemplate ? () => setTemplateInsert(null) : onComposerInsertApplied
            }
          />
        </div>
        {managePullTask === task.id && (
          <TaskPullLinkDialog key={task.id} task={task} onClose={() => setManagePullTask(null)} />
        )}
      </div>
    </ChatImageEditProvider>
  )
}
