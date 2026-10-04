import { useMemo, useState } from 'react'
import { LoaderCircle, GitFork, Folder } from 'lucide-react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  taskBudgetUsage,
  taskPreparation,
  visiblePendingMessage,
  pendingMessageQueue,
  startingConversationMessage,
  type PendingMessage,
  type ArtifactReference,
} from '@dovo/protocol'
import { MessageQueue } from '../chat/thread/message-queue'
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
import type { CodeReference } from './code-reference'
import { PreparationProgress } from '../chat/thread/preparation-progress'
import { ReviewCommentsTray } from '../chat/thread/review-comments-tray'
import { PlanApproval } from '../chat/thread/plan-approval'
import { ReviewFindings } from '../chat/thread/review-findings'
import { useTaskViewed } from '../chat/thread/use-task-viewed'
import { Button } from '@dovo/studio-ui'
import { ArtifactOpenContext } from '../chat/artifact-open-context'
export function TaskConversation({
  task,
  historyLoaded,
  historyError,
  onReview,
  onTerminal,
  onBrowser,
  onPullLink,
  onArtifact,
  revealMessage,
  onRevealHandled,
  onAside,
  visible,
  codeReference,
  composerInsert,
  onComposerInsertApplied,
}: {
  task: Task
  historyLoaded?: boolean
  historyError?: string
  onReview: () => void
  onTerminal?: (terminalId: string) => void
  onBrowser?: (url: string) => void
  onPullLink?: (url: string) => boolean
  onArtifact?: (reference: ArtifactReference) => void
  revealMessage?: string
  onRevealHandled?: () => void
  /** Opens the side question dialog. */
  onAside?: () => void
  visible: boolean
  codeReference?: CodeReference | null
  composerInsert?: { id: string; text: string } | null
  onComposerInsertApplied?: () => void
}) {
  const { collapseComposerOnScroll } = useAppPreferences()
  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const [pending, setPending] = useApplicationState<PendingMessage | null>(null)
  const { id, messages, queue, turns, status, compactions } = task
  const visiblePending = useMemo(
    () => visiblePendingMessage({ id, messages, queue }, pending),
    [id, messages, queue, pending],
  )
  const threadPending = visiblePending?.destination === 'queue' ? null : visiblePending
  const startingMessage = startingConversationMessage(task)
  const queueTask = {
    ...task,
    queue: pendingMessageQueue(task, pending).filter(
      (message) => message.id !== startingMessage?.id,
    ),
  }
  const displayedTask = useMemo(
    () => ({
      id,
      messages: startingMessage
        ? [...messages, startingMessage]
        : threadPending
          ? [...messages, threadPending.message]
          : messages,
      queue,
      turns,
      status,
      compactions,
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
      task.historyBefore,
      task.historyRevision,
    ],
  )
  const { snapshot } = useWorkspace()
  const loaded =
    historyLoaded ?? (!snapshot?.detailTaskIds || snapshot.detailTaskIds.includes(task.id))
  const viewed = useTaskViewed(task, visible && loaded)
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
    <div
      data-task-conversation={task.id}
      className="flex h-full min-h-0 flex-col"
      onScrollCapture={(event) => {
        if (
          !collapseComposerOnScroll ||
          !(event.target instanceof HTMLElement) ||
          !event.target.closest('[role="log"]')
        )
          return
        const element = event.target
        if (element.scrollHeight - element.clientHeight - element.scrollTop > 120)
          setComposerCollapsed(true)
      }}
    >
      <ArtifactOpenContext value={onArtifact}>
        <ChatThread
          task={displayedTask}
          onTerminal={onTerminal}
          onBrowser={onBrowser}
          onPullLink={onPullLink}
          revealMessage={revealMessage}
          onRevealHandled={onRevealHandled}
          pending={threadPending}
        />
      </ArtifactOpenContext>
      {(budget.tokenExceeded || budget.timeExceeded) && (
        <p
          role="status"
          className="mx-auto w-full max-w-[var(--chat-max)] px-5 py-2 text-xs text-amber-500"
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
      <ReviewFindings task={task} className="px-5 pb-2" onOpen={onReview} />
      <ReviewCommentsTray task={task} className="px-5 pb-2" />
      <MessageQueue task={queueTask} pending={visiblePending} />
      <div onFocusCapture={() => setComposerCollapsed(false)}>
        <Composer
          collapsed={collapseComposerOnScroll && composerCollapsed}
          key={task.id}
          task={task}
          onPending={setPending}
          onAside={onAside}
          codeReference={codeReference}
          composerInsert={composerInsert}
          onComposerInsertApplied={onComposerInsertApplied}
        />
      </div>
    </div>
  )
}
