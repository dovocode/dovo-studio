import { taskBudgetUsage } from '../tasks/task-budget.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { messageSchema, turnSchema, type Task } from '../workspace.js'
export const conversationPageSchema = mutableStruct({
  messages: mutableArray(messageSchema),
  turns: mutableArray(turnSchema),
  before: Schema.optional(Schema.String),
})
export type ConversationPage = Schema.Schema.Type<typeof conversationPageSchema>
const encodedSizes = new WeakMap<object, number>()
const encodedSize = (value: object) => {
  let size = encodedSizes.get(value)
  if (size === undefined) {
    size = JSON.stringify(value).length * 3
    encodedSizes.set(value, size)
  }
  return size
}
/** Whole messages, bounded by requests, item count and approximate encoded bytes. */
export function conversationPage(
  task: Pick<Task, 'messages' | 'turns'>,
  before?: string,
): ConversationPage {
  const end =
    before === undefined
      ? task.messages.length
      : task.messages.findIndex((message) => message.id === before)
  if (end < 0) throw new Error('This history cursor no longer exists. Reload the conversation.')
  const turnsByMessage = new Map<string, number>()
  for (const turn of task.turns ?? [])
    turnsByMessage.set(
      turn.assistantId,
      (turnsByMessage.get(turn.assistantId) ?? 0) + encodedSize(turn),
    )
  let start = end,
    requests = 0,
    bytes = 0
  while (start > 0 && end - start < 75 && requests < 10) {
    const message = task.messages[start - 1]!
    const size = encodedSize(message) + (turnsByMessage.get(message.id) ?? 0)
    // A large individual message remains intact and accessible.
    if (start < end && bytes + size > 1024 * 1024) break
    bytes += size
    start--
    if (message.role === 'user') requests++
  }
  const messages = task.messages.slice(start, end)
  const ids = new Set(messages.map((message) => message.id))
  return {
    messages,
    turns: task.turns?.filter((turn) => ids.has(turn.assistantId)) ?? [],
    ...(start > 0 ? { before: messages[0]!.id } : {}),
  }
}
/** Loaded history lives outside the authoritative live snapshot and its editable draft. */
export function mergeConversationHistory<
  T extends Pick<Task, 'messages' | 'turns' | 'historyTotals'>,
>(live: T, pages: readonly ConversationPage[]): T {
  if (!pages.length) return live
  const messages = new Map(
    pages.flatMap((page) => page.messages.map((message) => [message.id, message] as const)),
  )
  const turns = new Map(pages.flatMap((page) => page.turns.map((turn) => [turn.id, turn] as const)))
  for (const message of live.messages) messages.set(message.id, message)
  for (const turn of live.turns ?? []) turns.set(turn.id, turn)
  const liveTurns = new Set(live.turns?.map((turn) => turn.id))
  const added = [...turns.values()].filter((turn) => !liveTurns.has(turn.id))
  const loadedUsage = taskBudgetUsage({ turns: added })
  return {
    ...live,
    messages: [...messages.values()],
    turns: [...turns.values()],
    ...(live.historyTotals
      ? {
          historyTotals: {
            ...live.historyTotals,
            tokens:
              live.historyTotals.tokens === undefined
                ? undefined
                : Math.max(0, live.historyTotals.tokens - (loadedUsage.tokens ?? 0)),
            milliseconds: Math.max(
              0,
              live.historyTotals.milliseconds - loadedUsage.minutes * 60000,
            ),
          },
        }
      : {}),
  }
}
