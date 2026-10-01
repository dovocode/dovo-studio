import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import type { ThreadMessageLike } from '@assistant-ui/react-native'
import { toolPresentation, turnSummary, type Task } from '@dovo/protocol'
import { taskToolEvents, pendingActivity, type ToolEvents } from './tool-events'
export type { ToolEvents } from './tool-events'
type ConversationTask = Pick<Task, 'id' | 'status' | 'messages' | 'turns' | 'compactions'>

/** Keep native list entries stable and avoid reparsing unchanged historical tool payloads. */
export function createConversationMessages() {
  const cache = new Map<
    string,
    { input: string; text: string; tools: string[]; output: ThreadMessageLike }
  >()
  let taskId: string | undefined
  return (task: ConversationTask, events: ToolEvents) => {
    if (taskId !== task.id) cache.clear()
    taskId = task.id
    const retained = new Set(task.messages.map((message) => message.id))
    for (const id of cache.keys()) if (!retained.has(id)) cache.delete(id)
    return projectMessages(
      task,
      events,
      (message, turn, tools, compactions, activeTurnId, build) => {
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
          },
          compactions,
          turn?.status === 'running' ? [activeTurnId, task.status] : null,
        ])
        const toolKeys = tools.flatMap(({ payload, inputPayload, ...metadata }) => [
          payload,
          inputPayload ?? '',
          JSON.stringify(metadata),
        ])
        const previous = cache.get(message.id)
        if (
          previous?.input === input &&
          previous.text === text &&
          previous.tools.length === toolKeys.length &&
          previous.tools.every((key, index) => key === toolKeys[index])
        )
          return previous.output
        const output = build()
        cache.set(message.id, { input, text, tools: toolKeys, output })
        return output
      },
    )
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
): ThreadMessageLike[] {
  const tools = taskToolEvents(task, events)
  const turnsByAssistant = new Map(task.turns?.map((turn) => [turn.assistantId, turn]))
  const toolsByTurn = new Map<string, typeof tools>()
  for (const tool of tools) {
    if (!tool.turnId) continue
    const turnTools = toolsByTurn.get(tool.turnId) ?? []
    turnTools.push(tool)
    toolsByTurn.set(tool.turnId, turnTools)
  }
  const compactionsByTurn = new Map<string, NonNullable<Task['compactions']>>()
  for (const event of task.compactions ?? []) {
    const entries = compactionsByTurn.get(event.turnId) ?? []
    entries.push(event)
    compactionsByTurn.set(event.turnId, entries)
  }
  const activeTurnId =
    task.status === 'running'
      ? [...(task.turns ?? [])].reverse().find((turn) => turn.status === 'running')?.id
      : undefined
  return task.messages.map((message) => {
    const turn = turnsByAssistant.get(message.id)
    const turnEvents = [...(turn ? (toolsByTurn.get(turn.id) ?? []) : [])].reverse()
    const compactions = turn ? (compactionsByTurn.get(turn.id) ?? []) : []
    return project(message, turn, turnEvents, compactions, activeTurnId, () => {
      const content: Exclude<ThreadMessageLike['content'], string>[number][] = []
      if (message.attachments?.length)
        content.push({
          type: 'data',
          name: 'dovo.attachments',
          data: message.attachments,
        })
      if (turn) {
        const at = new Map<
          number,
          Array<
            | { kind: 'tool'; tool: (typeof turnEvents)[number] }
            | { kind: 'compaction'; event: NonNullable<Task['compactions']>[number] }
          >
        >()
        for (const tool of turnEvents) {
          // Older activity events have no offset; keep them after the reply text.
          const offset = Math.min(
            message.text.length,
            Math.max(0, tool.textOffset ?? message.text.length),
          )
          const group = at.get(offset) ?? []
          group.push({ kind: 'tool', tool })
          at.set(offset, group)
        }
        for (const event of compactions) {
          const offset = Math.min(
            message.text.length,
            Math.max(0, event.textOffset ?? message.text.length),
          )
          const group = at.get(offset) ?? []
          group.push({ kind: 'compaction', event })
          at.set(offset, group)
        }
        for (const boundary of message.textBreaks ?? []) {
          const offset = Math.max(0, Math.min(message.text.length, boundary))
          if (!at.has(offset)) at.set(offset, [])
        }
        let cursor = 0
        for (const offset of [...at.keys()].sort((a, b) => a - b)) {
          if (offset > cursor)
            content.push({ type: 'text', text: message.text.slice(cursor, offset) })
          const reasoning: typeof turnEvents = []
          const flushReasoning = () => {
            if (reasoning.length)
              content.push({ type: 'data', name: 'dovo.reasoning', data: reasoning.splice(0) })
          }
          const entries = at.get(offset)!.sort((left, right) => {
            const a = left.kind === 'tool' ? (left.tool.startedAt ?? left.tool.time) : left.event.at
            const b =
              right.kind === 'tool' ? (right.tool.startedAt ?? right.tool.time) : right.event.at
            return a.localeCompare(b)
          })
          for (const entry of entries) {
            if (entry.kind === 'compaction') {
              flushReasoning()
              content.push({ type: 'data', name: 'dovo.compaction', data: entry.event })
              continue
            }
            const tool = entry.tool
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
              toolCallId: `${turn.id}:${toolIdentity(tool.payload) || tool.id}`,
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
          cursor = offset
        }
        if (cursor < message.text.length)
          content.push({ type: 'text', text: message.text.slice(cursor) })
        if (
          turn.checkpoint &&
          (turn.checkpoint.files.length ||
            turn.checkpoint.error ||
            turn.checkpoint.omitted.length) &&
          (turn.checkpoint.after || turn.checkpoint.error)
        )
          content.push({
            type: 'data',
            name: 'dovo.checkpoint',
            data: {
              turnId: turn.id,
              files: turn.checkpoint.files.length + turn.checkpoint.omitted.length,
              omitted: turn.checkpoint.omitted.length,
              error: turn.checkpoint.error,
            },
          })
        if (turn.status !== 'running')
          content.push({
            type: 'data',
            name: 'dovo.turn-summary',
            data: turnSummary(turn, turnEvents, false),
          })
      } else if (message.text) content.push({ type: 'text', text: message.text })
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
                turn?.status === 'running'
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
