import { conversationTurns, conversationTurnLabel } from './conversation-turns'
import { useMemo } from 'react'
import { TurnCheckpoint } from './turn-checkpoint'
import { MessageAttachments } from './message-attachments'
import { MessageCopy } from './message-copy'
import { TaskActivity, useTaskActivity } from './task-activity'
import { CheckCheck, FileDiff } from 'lucide-react'
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
export function ChatThread({ task, onReview }: { task: Task; onReview: () => void }) {
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
      <ConversationContent className="mx-auto w-full max-w-3xl gap-12 px-5 py-6 md:pl-10 md:pr-6">
        {!task.messages.length && !task.queue?.length && (
          <div className="py-10 text-center">
            <h2 className="text-lg font-medium">What would you like to work on?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Describe a change or ask a question.
            </p>
          </div>
        )}
        {groups.map((group) => (
          <section
            key={group.id}
            id={`turn-${task.id}-${group.id}`}
            aria-label={`User request · ${conversationTurnLabel(group.status)}`}
            className="flex min-w-0 flex-col gap-5"
          >
            {group.messages.map((message) => {
              const turn = turns.get(message.id)
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
                      {message.file && (
                        <span className="mb-1 font-mono text-[11px] text-muted-foreground">
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
                            : message.attachments?.length
                              ? ''
                              : 'No response text'}
                        </span>
                      )}
                    </MessageContent>
                  )}
                  {!!message.text && <MessageCopy text={message.text} />}
                  {turn?.error && (
                    <p role="alert" className="text-xs text-destructive">
                      {turn.error}
                    </p>
                  )}
                  {turn && <TurnCheckpoint turn={turn} />}
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
