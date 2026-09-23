import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import type { ThreadMessageLike } from '@assistant-ui/react-native'
import { toolPresentation, type Task } from '@dovo/protocol'
import { taskToolEvents, pendingActivity, type ToolEvents } from './task-tool-events'
export type { ToolEvents } from './task-tool-events'
export function conversationMessages(task: Task, events: ToolEvents): ThreadMessageLike[] {
  const tools = taskToolEvents(task, events)
  const activeTurnId =
    task.status === 'running'
      ? [...(task.turns ?? [])].reverse().find((turn) => turn.status === 'running')?.id
      : undefined
  return task.messages.map((message) => {
    const turn = task.turns?.find((item) => item.assistantId === message.id)
    const content: Exclude<ThreadMessageLike['content'], string>[number][] = []
    if (message.attachments?.length)
      content.push({
        type: 'data',
        name: 'dovo.attachments',
        data: message.attachments,
      })
    if (message.text)
      content.push({
        type: 'text',
        text: message.text,
      })
    if (turn) {
      const turnEvents = tools.filter((item) => item.turnId === turn.id).reverse()
      const reasoning = turnEvents.filter(
        (tool) =>
          tool.kind === 'reasoning' ||
          toolPresentation(tool.payload, tool.summary, tool.inputPayload).kind === 'reasoning',
      )
      if (reasoning.length)
        content.push({
          type: 'data',
          name: 'dovo.reasoning',
          data: reasoning,
        })
      for (const tool of turnEvents.filter((tool) => !reasoning.includes(tool))) {
        const running = pendingActivity(tool.status)
        const status = tool.status
        content.push({
          type: 'tool-call',
          toolCallId: `${turn.id}:${toolIdentity(tool.payload) || tool.id}`,
          toolName: tool.summary,
          args: {},
          argsText: '',
          artifact: {
            ...tool,
            status,
          },
          ...(!running
            ? {
                result: tool.payload,
                isError: ['failed', 'error', 'cancelled', 'interrupted'].includes(status),
              }
            : {}),
        })
      }
      if (
        turn.checkpoint &&
        (turn.checkpoint.files.length || turn.checkpoint.error || turn.checkpoint.omitted.length)
      )
        content.push({
          type: 'data',
          name: 'dovo.checkpoint',
          data: {
            turnId: turn.id,
            files: turn.checkpoint.files.length,
            omitted: turn.checkpoint.omitted.length,
            pending: !turn.checkpoint.after && turn.status === 'running',
            error: turn.checkpoint.error,
          },
        })
    }
    if (!content.length)
      content.push({
        type: 'text',
        text:
          turn?.id === activeTurnId && turn?.status === 'running' ? 'Working…' : 'No response text',
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
