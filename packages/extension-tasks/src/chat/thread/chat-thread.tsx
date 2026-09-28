import { turnSummary, type PendingMessage } from '@dovo/protocol'
import { conversationTurns, conversationTurnLabel } from './conversation-turns'
import { useMemo } from 'react'
import { TurnCheckpoint } from './turn-checkpoint'
import { MessageAttachments } from '../composer/message-attachments'
import { MessageCopy } from './message-copy'
import { RunInTerminal } from '../actions/run-in-terminal'
import { ForkTurn } from '../actions/fork-turn'
import { RetryTurn } from '../actions/retry-turn'
import { TaskActivity, useTaskActivity } from './task-activity'
import { CheckCheck, FileDiff, Star } from 'lucide-react'
import {
  Conversation,
  ConversationContent,
  ConversationRail,
  ConversationScrollButton,
  Message,
  MessageContent,
  MessageResponse,
  Button,
} from '@dovo/studio-ui'
import type { Task } from '@dovo/studio-core'
import { responses, useWorkspace } from '@dovo/studio-core'
export function ChatThread({
  task,
  onReview,
  onTerminal,
  pending,
}: {
  task: Pick<Task, 'id' | 'messages' | 'turns' | 'files' | 'status' | 'queue' | 'compactions'>
  onReview: () => void
  /** Shows the terminal after a chat command ran in it. */
  onTerminal?: (terminalId: string) => void
  pending?: PendingMessage | null
}) {
  const { request, connected } = useWorkspace()
  const bookmarks = task.messages.filter(
    (message) => message.role === 'assistant' && message.bookmarked,
  )
  const activity = useTaskActivity(task.id)
  const turns = useMemo(
    () => new Map(task.turns?.map((turn) => [turn.assistantId, turn])),
    [task.turns],
  )
  const activityGroups = useMemo(() => {
    const visibleTurns = new Set(
      task.messages.flatMap((message) => {
        const turn = turns.get(message.id)
        return turn ? [turn.id] : []
      }),
    )
    const byTurn = new Map<string, typeof activity.tools>()
    const unassigned: typeof activity.tools = []
    for (const tool of activity.tools) {
      if (!tool.turnId || !visibleTurns.has(tool.turnId)) {
        unassigned.push(tool)
        continue
      }
      const events = byTurn.get(tool.turnId) ?? []
      events.push(tool)
      byTurn.set(tool.turnId, events)
    }
    return { byTurn, unassigned }
  }, [activity.tools, task.messages, turns])
  const groups = useMemo(() => conversationTurns(task), [task.messages, task.turns])
  const markers = useMemo(
    () =>
      groups.map((group) => {
        const prompt =
          group.messages.find((message) => message.role === 'user') ?? group.messages[0]
        const response = group.messages
          .filter((message) => message.role === 'assistant' && message.text.trim())
          .at(-1)
        return {
          id: `turn-${task.id}-${group.id}`,
          label: (
            prompt?.text.trim() ||
            prompt?.attachments?.map((file) => file.name).join(', ') ||
            'Attached files'
          ).slice(0, 180),
          preview: response?.text.trim().slice(0, 320),
          status: group.status,
        }
      }),
    [task.id, groups],
  )
  return (
    <Conversation key={task.id}>
      <ConversationContent className="mx-auto w-full max-w-[var(--chat-max)] gap-5 px-4 py-4 md:pl-8 md:pr-5">
        {!!bookmarks.length && (
          <nav
            aria-label="Bookmarked replies"
            className="flex flex-wrap gap-1 rounded-md border p-2"
          >
            {bookmarks.map((message, index) => (
              <Button
                key={message.id}
                size="sm"
                variant="ghost"
                className="h-7 max-w-52 truncate text-xs"
                onClick={() =>
                  document
                    .getElementById(`message-${task.id}-${message.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
                title={message.text.slice(0, 180)}
              >
                <Star className="size-3 fill-current" /> {index + 1}. {message.text.slice(0, 32)}
              </Button>
            ))}
          </nav>
        )}
        {!task.messages.length && !task.queue?.length && (
          <div className="py-8 text-center">
            <h2 className="text-base font-medium">What would you like to work on?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Describe a change or ask a question.
            </p>
          </div>
        )}
        {groups.map((group) => (
          <section
            key={group.id}
            id={`turn-${task.id}-${group.id}`}
            aria-label={`User request · ${conversationTurnLabel(group.status)}`}
            className="flex min-w-0 flex-col gap-3"
          >
            {group.messages.map((message) => {
              const turn = turns.get(message.id)
              const compactions = turn
                ? (task.compactions ?? []).filter((item) => item.turnId === turn.id)
                : []
              const tools = turn ? (activityGroups.byTurn.get(turn.id) ?? []) : []
              const showContent =
                !!message.text ||
                !!message.file ||
                !!message.attachments?.length ||
                !(turn?.status === 'running' && tools.length)
              return (
                <Message
                  id={`message-${task.id}-${message.id}`}
                  key={message.id}
                  from={message.role}
                >
                  {turn && <TaskActivity turn={turn} tools={tools} />}
                  {showContent && (
                    <MessageContent>
                      <MessageAttachments taskId={task.id} files={message.attachments} />
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
                        <MessageResponse isStreaming={turn?.status === 'running'}>
                          {message.text}
                        </MessageResponse>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {turn?.status === 'running'
                            ? 'Working…'
                            : compactions.length
                              ? 'Context compacted'
                              : message.attachments?.length
                                ? ''
                                : 'No response text'}
                        </span>
                      )}
                    </MessageContent>
                  )}
                  {pending?.message.id === message.id && (
                    <p role="status" className="text-[0.6875rem] text-muted-foreground">
                      {pending.state === 'failed'
                        ? 'Not confirmed · retry from the composer'
                        : 'Sending…'}
                    </p>
                  )}
                  {!!message.text && (
                    <div className="flex items-center gap-1 group-[.is-user]:ml-auto">
                      <MessageCopy text={message.text} />
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
                                id: task.id,
                                messageId: message.id,
                                bookmarked: !message.bookmarked,
                              },
                              responses.ok,
                            )
                          }
                        >
                          <Star
                            className={`size-3.5 ${message.bookmarked ? 'fill-current' : ''}`}
                          />
                        </Button>
                      )}
                      {message.role === 'assistant' && turn?.status !== 'running' && onTerminal && (
                        <RunInTerminal taskId={task.id} text={message.text} onRan={onTerminal} />
                      )}
                      {turn && turn.status !== 'running' && (
                        <ForkTurn taskId={task.id} turnId={turn.id} />
                      )}
                      {turn &&
                        turn.status !== 'running' &&
                        task.status !== 'running' &&
                        task.turns?.at(-1)?.id === turn.id && (
                          <RetryTurn taskId={task.id} turnId={turn.id} />
                        )}
                    </div>
                  )}
                  {turn?.error && (
                    <p role="alert" className="text-xs text-destructive">
                      {turn.error}
                    </p>
                  )}
                  {compactions.map((item) => (
                    <p
                      key={item.at}
                      role="status"
                      className="text-[0.6875rem] text-muted-foreground"
                    >
                      Context compacted {new Date(item.at).toLocaleString()} ·{' '}
                      {item.trigger === 'auto' ? 'Automatic' : 'Manual'}
                    </p>
                  ))}
                  {turn && (
                    <TurnCheckpoint
                      turn={turn}
                      taskId={task.id}
                      taskRunning={task.status === 'running'}
                    />
                  )}
                  {turn && turn.status !== 'running' && (
                    <p className="text-[0.6875rem] text-muted-foreground" aria-label="Turn summary">
                      {turnSummary(turn, tools)}
                    </p>
                  )}
                </Message>
              )
            })}
          </section>
        ))}
        {task.files.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs">
            <CheckCheck size={15} className="text-emerald-400" />
            <span>
              {task.files.length} changed {task.files.length === 1 ? 'file' : 'files'}
            </span>
            <span className="text-muted-foreground">
              {task.files.filter((f) => f.viewed).length} viewed
            </span>
            <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={onReview}>
              <FileDiff size={13} />
              Open diff
            </Button>
          </div>
        )}
        <TaskActivity
          tools={activityGroups.unassigned}
          status={
            task.status === 'running'
              ? 'running'
              : task.status === 'failed'
                ? 'failed'
                : task.status === 'cancelled'
                  ? 'cancelled'
                  : 'completed'
          }
          error={activity.error}
        />
      </ConversationContent>
      <ConversationRail items={markers} />
      <ConversationScrollButton />
    </Conversation>
  )
}
