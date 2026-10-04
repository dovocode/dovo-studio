import { memo, useMemo, useState } from 'react'
import {
  formatDateTime,
  useAppPreferences,
  completedStreamingText,
  responses,
  type Task,
  type TaskTurn,
  type useWorkspace,
} from '@dovo/studio-core'
import { turnSummary, type PendingMessage, type recentTools } from '@dovo/protocol'
import { Message, MessageContent, MessageResponse, Button } from '@dovo/studio-ui'
import { Star } from 'lucide-react'
import { threadTimeline, finalReplyIndex } from './thread-timeline'
import { TurnCheckpoint } from './turn-checkpoint'
import { MessageAttachments } from '../composer/message-attachments'
import { MessageCopy } from './message-copy'
import { RunInTerminal } from '../actions/run-in-terminal'
import { ForkTurn } from '../actions/fork-turn'
import { RetryTurn } from '../actions/retry-turn'
import { TaskActivity } from './task-activity'

export const ChatMessage = memo(function ChatMessage({
  taskId,
  message,
  turn,
  tools,
  summaryTools = tools,
  compactions,
  highlighted,
  pending,
  taskRunning,
  latestTurnId,
  connected,
  request,
  onTerminal,
  onBookmark,
  workOpen = true,
  final = true,
  footer = true,
}: {
  taskId: string
  message: Task['messages'][number]
  turn?: TaskTurn
  tools: ReturnType<typeof recentTools>
  summaryTools?: ReturnType<typeof recentTools>
  compactions: NonNullable<Task['compactions']>
  highlighted: boolean
  pending: PendingMessage | null
  taskRunning: boolean
  latestTurnId?: string
  connected: boolean
  request: ReturnType<typeof useWorkspace>['request']
  onTerminal?: (terminalId: string) => void
  onBookmark?: (messageId: string, bookmarked: boolean) => void
  workOpen?: boolean
  final?: boolean
  footer?: boolean
}) {
  const { responseStreaming } = useAppPreferences()
  const [bookmarkError, setBookmarkError] = useState('')
  const timeline = useMemo(
    () =>
      message.role === 'assistant'
        ? threadTimeline(message.text, tools, compactions, message.textBreaks)
        : null,
    [message.role, message.text, message.textBreaks, tools, compactions],
  )
  const finalIndex = timeline ? finalReplyIndex(timeline, !final || turn?.status === 'running') : -1
  const hasFailure = tools.some((tool) =>
    ['failed', 'error', 'cancelled', 'interrupted'].includes(tool.status),
  )
  if (message.role === 'assistant' && !workOpen && !final && !footer && !hasFailure) return null
  const ownsFooter = turn?.assistantId === message.id && (workOpen || footer)
  const showContent =
    !!message.text ||
    !!message.file ||
    !!message.attachments?.length ||
    (turn?.status !== 'running' && !compactions.length)
  return (
    <Message
      id={`message-${taskId}-${message.id}`}
      from={message.role}
      className={
        highlighted
          ? 'rounded-md ring-1 ring-primary/50 ring-offset-4 ring-offset-background'
          : undefined
      }
    >
      {!!bookmarkError && (
        <p role="alert" className="text-xs text-destructive">
          {bookmarkError}
        </p>
      )}
      <div className="group/message flex min-w-0 flex-col gap-2">
        {timeline ? (
          <>
            {(message.file || message.attachments?.length || message.review || message.plan) && (
              <MessageContent>
                <MessageAttachments taskId={taskId} files={message.attachments} />
                {message.review && (
                  <span className="mb-1 w-fit rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
                    Review
                  </span>
                )}
                {message.plan && (
                  <span className="mb-1 w-fit rounded bg-primary/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">
                    Plan mode
                  </span>
                )}
                {message.file && (
                  <span className="mb-1 font-mono text-[0.6875rem] text-muted-foreground">
                    {message.file}
                  </span>
                )}
              </MessageContent>
            )}
            {timeline.map((block, index) =>
              !workOpen &&
              index !== finalIndex &&
              !(
                block.kind === 'activity' &&
                block.tools.some((tool) =>
                  ['failed', 'error', 'cancelled', 'interrupted'].includes(tool.status),
                )
              ) ? null : block.kind === 'activity' ? (
                <TaskActivity key={block.key} status={turn?.status} tools={block.tools} />
              ) : block.kind === 'compaction' ? (
                <p
                  key={`compaction-${block.event.at}`}
                  role="status"
                  className="text-[0.6875rem] text-muted-foreground"
                >
                  Context compacted {new Date(block.event.at).toLocaleString()} ·{' '}
                  {block.event.trigger === 'auto' ? 'Automatic' : 'Manual'}
                </p>
              ) : (
                <MessageContent key={`text-${block.offset}`}>
                  <MessageResponse
                    isStreaming={
                      turn?.status === 'running' &&
                      turn.assistantId === message.id &&
                      index === timeline.length - 1
                    }
                  >
                    {responseStreaming === 'paragraphs' &&
                    turn?.status === 'running' &&
                    index === timeline.length - 1
                      ? completedStreamingText(block.text)
                      : block.text}
                  </MessageResponse>
                </MessageContent>
              ),
            )}
            {workOpen && !message.text && turn?.status !== 'running' && !compactions.length && (
              <MessageContent>
                <span className="text-xs text-muted-foreground">
                  {message.attachments?.length ? '' : 'No response text'}
                </span>
              </MessageContent>
            )}
          </>
        ) : (
          showContent && (
            <MessageContent>
              <MessageAttachments taskId={taskId} files={message.attachments} />
              {message.review && (
                <span className="mb-1 w-fit rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
                  Review
                </span>
              )}
              {message.plan && (
                <span className="mb-1 w-fit rounded bg-primary/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">
                  Plan mode
                </span>
              )}
              {message.file && (
                <span className="mb-1 font-mono text-[0.6875rem] text-muted-foreground">
                  {message.file}
                </span>
              )}
              {message.text ? (
                <MessageResponse>{message.text}</MessageResponse>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {message.attachments?.length ? '' : 'No response text'}
                </span>
              )}
            </MessageContent>
          )
        )}
        {pending?.message.id === message.id && (
          <p role="status" className="text-[0.6875rem] text-muted-foreground">
            {pending.state === 'failed' ? 'Not confirmed · retry from the composer' : 'Sending…'}
          </p>
        )}
        {(!!message.text || !!message.createdAt) && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100 group-[.is-user]:ml-auto">
            {message.createdAt && (
              <time dateTime={message.createdAt} className="text-[0.625rem] text-muted-foreground">
                {formatDateTime(message.createdAt, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            )}
            {!!message.text && <MessageCopy text={message.text} />}
            {message.role === 'assistant' && turn?.status !== 'running' && (
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label={message.bookmarked ? 'Remove bookmark' : 'Bookmark reply'}
                aria-pressed={!!message.bookmarked}
                disabled={!connected}
                onClick={() =>
                  void request(
                    '/api/tasks/message/bookmark',
                    {
                      id: taskId,
                      messageId: message.id,
                      bookmarked: !message.bookmarked,
                    },
                    responses.ok,
                  )
                    .then(() => {
                      onBookmark?.(message.id, !message.bookmarked)
                      setBookmarkError('')
                    })
                    .catch((cause: unknown) =>
                      setBookmarkError(cause instanceof Error ? cause.message : String(cause)),
                    )
                }
              >
                <Star className={`size-3.5 ${message.bookmarked ? 'fill-current' : ''}`} />
              </Button>
            )}
            {message.role === 'assistant' && turn?.status !== 'running' && onTerminal && (
              <RunInTerminal taskId={taskId} text={message.text} onRan={onTerminal} />
            )}
            {ownsFooter && turn && turn.status !== 'running' && (
              <ForkTurn taskId={taskId} turnId={turn.id} />
            )}
            {ownsFooter &&
              turn &&
              turn.status !== 'running' &&
              !taskRunning &&
              latestTurnId === turn.id && <RetryTurn taskId={taskId} turnId={turn.id} />}
          </div>
        )}
      </div>
      {ownsFooter && turn?.error && (
        <p role="alert" className="text-xs text-destructive">
          {turn.error}
        </p>
      )}
      {ownsFooter && turn && (
        <TurnCheckpoint turn={turn} taskId={taskId} taskRunning={taskRunning} />
      )}
      {ownsFooter &&
        turn?.checkpoint?.linked?.map((linked) => (
          <TurnCheckpoint
            key={linked.checkoutId}
            turn={{ ...turn, checkpoint: linked }}
            taskId={taskId}
            taskRunning={taskRunning}
            checkoutId={linked.checkoutId}
            projectName={`${linked.repositoryName ?? linked.repositoryId} · ${linked.branch ?? 'Linked checkout'}`}
          />
        ))}
      {ownsFooter && turn && turn.status !== 'running' && (
        <p className="text-[0.6875rem] text-muted-foreground" aria-label="Turn summary">
          {turnSummary(turn, summaryTools, false)}
        </p>
      )}
    </Message>
  )
})
