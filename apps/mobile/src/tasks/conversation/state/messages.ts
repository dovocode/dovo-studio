import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import type { ThreadMessageLike } from '@assistant-ui/react-native'
import {
  toolPresentation,
  turnSummary,
  conversationMessageTurns,
  conversationToolsByMessage,
  threadTimeline,
  type Task,
} from '@dovo/protocol'
import {
  taskToolEvents,
  createTaskToolEvents,
  pendingActivity,
  type ToolEvents,
} from './tool-events'
export const convertConversationMessage = (message: ThreadMessageLike) => message
export type { ToolEvents } from './tool-events'
type ConversationTask = Pick<Task, 'id' | 'status' | 'messages' | 'turns' | 'compactions'>

/** Keep native list entries stable and avoid reparsing unchanged historical tool payloads. */
export function createConversationMessages() {
  const projectTools = createTaskToolEvents()
  const cache = new Map<
    string,
    {
      input: string
      text: string
      tools: string[]
      output: ThreadMessageLike
      message: Task['messages'][number]
      turn: NonNullable<Task['turns']>[number] | undefined
      events: ReturnType<typeof taskToolEvents>
      compactions: NonNullable<Task['compactions']>
      active: string | undefined
      status: Task['status'] | undefined
    }
  >()
  let taskId: string | undefined
  let previousMessages: ThreadMessageLike[] = []
  return (task: ConversationTask, events: ToolEvents) => {
    if (taskId !== task.id) cache.clear()
    taskId = task.id
    const retained = new Set(task.messages.map((message) => message.id))
    for (const id of cache.keys()) if (!retained.has(id)) cache.delete(id)
    const next = projectMessages(
      task,
      events,
      (message, turn, tools, compactions, activeTurnId, build) => {
        const previous = cache.get(message.id)
        const status = turn?.status === 'running' ? task.status : undefined
        const active = turn?.status === 'running' ? activeTurnId : undefined
        if (
          previous?.message === message &&
          previous.turn === turn &&
          previous.active === active &&
          previous.status === status &&
          previous.events.length === tools.length &&
          previous.events.every((tool, index) => tool === tools[index]) &&
          previous.compactions.length === compactions.length &&
          previous.compactions.every((event, index) => event === compactions[index])
        )
          return previous.output
        // Compare large text and payload strings directly; serialize only small metadata.
        const { text, ...metadata } = message
        const input = JSON.stringify([
          metadata,
          turn?.id,
          turn?.status,
          turn?.error,
          turn?.checkpoint && {
            after: Boolean(turn.checkpoint.after),
            files: turn.checkpoint.files.length,
            omitted: turn.checkpoint.omitted.length,
            error: turn.checkpoint.error,
            linked: turn.checkpoint.linked?.map((item) => [
              item.checkoutId,
              item.after,
              item.files.length,
              item.error,
            ]),
          },
          compactions,
          turn?.status === 'running' ? [activeTurnId, task.status] : null,
        ])
        const toolKeys = tools.flatMap(({ payload, inputPayload, ...metadata }) => [
          payload,
          inputPayload ?? '',
          JSON.stringify(metadata),
        ])
        if (
          previous?.input === input &&
          previous.text === text &&
          previous.tools.length === toolKeys.length &&
          previous.tools.every((key, index) => key === toolKeys[index])
        ) {
          cache.set(message.id, {
            ...previous,
            message,
            turn,
            events: tools,
            compactions,
            active,
            status,
          })
          return previous.output
        }
        const output = build()
        cache.set(message.id, {
          input,
          text,
          tools: toolKeys,
          output,
          message,
          turn,
          events: tools,
          compactions,
          active,
          status,
        })
        return output
      },
      projectTools(task, events),
    )
    if (
      next.length === previousMessages.length &&
      next.every((message, index) => message === previousMessages[index])
    )
      return previousMessages
    previousMessages = next
    return next
  }
}

export function conversationMessages(
  task: ConversationTask,
  events: ToolEvents,
): ThreadMessageLike[] {
  return projectMessages(task, events, (_message, _turn, _tools, _compactions, _active, build) =>
    build(),
  )
}

function projectMessages(
  task: ConversationTask,
  events: ToolEvents,
  project: (
    message: Task['messages'][number],
    turn: NonNullable<Task['turns']>[number] | undefined,
    tools: ReturnType<typeof taskToolEvents>,
    compactions: NonNullable<Task['compactions']>,
    activeTurnId: string | undefined,
    build: () => ThreadMessageLike,
  ) => ThreadMessageLike,
  tools = taskToolEvents(task, events),
): ThreadMessageLike[] {
  const turnsByAssistant = conversationMessageTurns(task)
  const toolsByMessage = conversationToolsByMessage(task, tools)
  const toolsByTurn = new Map<string, typeof tools>()
  for (const tool of tools) {
    if (!tool.turnId) continue
    const events = toolsByTurn.get(tool.turnId) ?? []
    events.push(tool)
    toolsByTurn.set(tool.turnId, events)
  }
  const compactionsByMessage = new Map<string, NonNullable<Task['compactions']>>()
  for (const event of task.compactions ?? []) {
    const messageId =
      event.messageId ?? task.turns?.find((turn) => turn.id === event.turnId)?.assistantId
    if (!messageId) continue
    const entries = compactionsByMessage.get(messageId) ?? []
    entries.push(event)
    compactionsByMessage.set(messageId, entries)
  }
  const activeTurnId =
    task.status === 'running'
      ? [...(task.turns ?? [])].reverse().find((turn) => turn.status === 'running')?.id
      : undefined
  return task.messages.map((message) => {
    const turn = turnsByAssistant.get(message.id)
    const turnEvents = toolsByMessage.get(message.id) ?? []
    const compactions = compactionsByMessage.get(message.id) ?? []
    const summaryTools = turn ? (toolsByTurn.get(turn.id) ?? []) : []
    const cacheTools = turn?.assistantId === message.id ? summaryTools : turnEvents
    return project(message, turn, cacheTools, compactions, activeTurnId, () => {
      const content: Exclude<ThreadMessageLike['content'], string>[number][] = []
      if (message.attachments?.length)
        content.push({
          type: 'data',
          name: 'dovo.attachments',
          data: message.attachments,
        })
      if (message.role === 'assistant') {
        for (const block of threadTimeline(
          message.text,
          turnEvents,
          compactions,
          message.textBreaks,
        )) {
          if (block.kind === 'text') content.push({ type: 'text', text: block.text })
          else if (block.kind === 'compaction')
            content.push({ type: 'data', name: 'dovo.compaction', data: block.event })
          else {
            const reasoning: typeof turnEvents = []
            const flushReasoning = () => {
              if (reasoning.length)
                content.push({ type: 'data', name: 'dovo.reasoning', data: reasoning.splice(0) })
            }
            for (const tool of block.tools) {
              if (
                tool.kind === 'reasoning' ||
                toolPresentation(tool.payload, tool.summary, tool.inputPayload).kind === 'reasoning'
              ) {
                reasoning.push(tool)
                continue
              }
              flushReasoning()
              const status = tool.status
              content.push({
                type: 'tool-call',
                toolCallId: `${tool.turnId ?? ''}:${toolIdentity(tool.payload) || tool.id}`,
                toolName: tool.summary,
                args: {},
                argsText: '',
                artifact: { ...tool, status },
                ...(!pendingActivity(status)
                  ? {
                      result: tool.payload,
                      isError: ['failed', 'error', 'cancelled', 'interrupted'].includes(status),
                    }
                  : {}),
              })
            }
            flushReasoning()
          }
        }
      }
      if (turn?.assistantId === message.id) {
        if (
          turn.checkpoint &&
          (turn.checkpoint.files.length ||
            turn.checkpoint.error ||
            turn.checkpoint.omitted.length ||
            turn.checkpoint.linked?.some(
              (item) => item.files.length || item.omitted.length || item.error,
            )) &&
          (turn.checkpoint.after ||
            turn.checkpoint.error ||
            turn.checkpoint.linked?.some((item) => item.after || item.error))
        )
          content.push({
            type: 'data',
            name: 'dovo.checkpoint',
            data: {
              turnId: turn.id,
              files:
                turn.checkpoint.files.length +
                turn.checkpoint.omitted.length +
                (turn.checkpoint.linked?.reduce(
                  (sum, item) => sum + item.files.length + item.omitted.length,
                  0,
                ) ?? 0),
              omitted: turn.checkpoint.omitted.length,
              error: turn.checkpoint.error,
            },
          })
        if (turn.status !== 'running')
          content.push({
            type: 'data',
            name: 'dovo.turn-summary',
            data: turnSummary(turn, summaryTools, false),
          })
      }
      if (message.role === 'user' && message.text)
        content.push({ type: 'text', text: message.text })
      if (!content.length)
        content.push({
          type: 'text',
          text:
            turn?.id === activeTurnId && turn?.status === 'running'
              ? 'Working…'
              : 'No response text',
        })
      return {
        id: message.id,
        role: message.role,
        content,
        ...(message.createdAt
          ? {
              createdAt: new Date(message.createdAt),
            }
          : {}),
        ...(message.role === 'assistant'
          ? {
              status:
                turn?.status === 'running' && turn.assistantId === message.id
                  ? turn.id === activeTurnId
                    ? {
                        type: 'running' as const,
                      }
                    : {
                        type: 'incomplete' as const,
                        reason:
                          task.status === 'cancelled'
                            ? ('cancelled' as const)
                            : task.status === 'failed'
                              ? ('error' as const)
                              : ('other' as const),
                      }
                  : turn?.status === 'failed'
                    ? {
                        type: 'incomplete' as const,
                        reason: 'error' as const,
                        error: turn.error,
                      }
                    : turn?.status === 'cancelled'
                      ? {
                          type: 'incomplete' as const,
                          reason: 'cancelled' as const,
                        }
                      : {
                          type: 'complete' as const,
                          reason: 'stop' as const,
                        },
            }
          : {}),
      }
    })
  })
}
function toolIdentity(payload: string) {
  try {
    return decodeResult(
      mutableStruct({
        toolId: Schema.String,
      }),
      JSON.parse(payload),
    ).data?.toolId
  } catch {
    return undefined
  }
}
