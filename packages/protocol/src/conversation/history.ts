import { taskBudgetUsage } from '../tasks/task-budget.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { messageSchema, turnSchema, type Task } from '../workspace.js'
export const conversationPageSchema = mutableStruct({
  messages: mutableArray(messageSchema),
  turns: mutableArray(turnSchema),
  before: Schema.optional(Schema.String),
  historyRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})
export type ConversationPage = Schema.Schema.Type<typeof conversationPageSchema>
/** Complete a captured transcript without mixing destructive history revisions or chasing bad cursors. */
export async function readConversationHistory<
  T extends Pick<Task, 'messages' | 'turns' | 'historyBefore' | 'historyRevision'>,
>(
  task: T,
  read: (before: string, signal: AbortSignal) => Promise<ConversationPage>,
  signal: AbortSignal,
): Promise<T> {
  const checkCancelled = () => {
    if (signal.aborted) throw new Error('Conversation copying was cancelled.')
  }
  checkCancelled()
  if (!task.historyBefore) return task
  let before: string | undefined = task.messages[0]?.id ?? task.historyBefore
  const cursors = new Set<string>()
  const pages: ConversationPage[] = []
  while (before) {
    checkCancelled()
    if (cursors.has(before))
      throw new Error('History did not advance. Reload the conversation before copying.')
    cursors.add(before)
    const page = await read(before, signal)
    checkCancelled()
    if ((page.historyRevision ?? 0) !== (task.historyRevision ?? 0))
      throw new Error('Conversation changed while copying. Try again with the latest history.')
    if ((!page.messages.length && page.before) || page.before === before)
      throw new Error('History did not advance. Reload the conversation before copying.')
    pages.push(page)
    before = page.before
  }
  return mergeConversationHistory(task, pages.reverse())
}
/** Retain each message/turn once per revision, with the newest captured version winning. */
export function compactConversationPages(pages: readonly ConversationPage[]): ConversationPage[] {
  const revisions = new Map<
    number,
    {
      page: ConversationPage
      messages: Map<string, Task['messages'][number]>
      turns: Map<string, NonNullable<Task['turns']>[number]>
    }
  >()
  for (const page of pages) {
    const revision = page.historyRevision ?? 0
    let group = revisions.get(revision)
    if (!group) {
      group = { page, messages: new Map(), turns: new Map() }
      revisions.set(revision, group)
    }
    for (const message of page.messages) group.messages.set(message.id, message)
    for (const turn of page.turns) group.turns.set(turn.id, turn)
  }
  return [...revisions.values()].map(({ page, messages, turns }) => ({
    ...page,
    messages: [...messages.values()],
    turns: [...turns.values()],
  }))
}
const encodedSizes = new WeakMap<object, number>()
const encodedSize = (value: object) => {
  let size = encodedSizes.get(value)
  if (size === undefined) {
    size = JSON.stringify(value).length * 3
    encodedSizes.set(value, size)
  }
  return size
}
/** A page never holds more messages than this; a source window holds one more to detect older history. */
export const conversationPageMessages = 75
/** The newest stored messages before a cursor, oldest first, with candidate turns in history order.
 * Hosts that keep history outside memory read `conversationPageMessages + 1` messages and only the
 * turns whose ID or assistant message is referenced by that window. */
export interface ConversationWindow {
  messages: readonly Task['messages'][number][]
  turns: readonly NonNullable<Task['turns']>[number][]
  historyRevision?: number
}
/** Whole messages, bounded by requests, item count and approximate encoded bytes. */
export function conversationPage(
  task: Pick<Task, 'messages' | 'turns' | 'historyRevision'>,
  before?: string,
): ConversationPage {
  const end =
    before === undefined
      ? task.messages.length
      : task.messages.findIndex((message) => message.id === before)
  if (end < 0) throw new Error('This history cursor no longer exists. Reload the conversation.')
  return conversationWindowPage({
    messages: task.messages.slice(Math.max(0, end - conversationPageMessages - 1), end),
    turns: task.turns ?? [],
    historyRevision: task.historyRevision,
  })
}
/** Pages a window exactly as `conversationPage` pages the complete history it was read from. */
export function conversationWindowPage(window: ConversationWindow): ConversationPage {
  const end = window.messages.length
  const turnsById = new Map(window.turns.map((turn) => [turn.id, turn]))
  const turnsByMessage = new Map(window.turns.map((turn) => [turn.assistantId, turn]))
  const includedTurns = new Set<string>()
  let start = end,
    requests = 0,
    bytes = 0
  while (start > 0 && end - start < conversationPageMessages && requests < 10) {
    const message = window.messages[start - 1]!
    const turn =
      (message.turnId ? turnsById.get(message.turnId) : undefined) ?? turnsByMessage.get(message.id)
    const size =
      encodedSize(message) + (turn && !includedTurns.has(turn.id) ? encodedSize(turn) : 0)
    // A large individual message remains intact and accessible.
    if (start < end && bytes + size > 1024 * 1024) break
    bytes += size
    if (turn) includedTurns.add(turn.id)
    start--
    if (message.role === 'user') requests++
  }
  const messages = window.messages.slice(start, end)
  const ids = new Set(messages.map((message) => message.id))
  const ownedTurns = new Set(
    messages.flatMap((message) => (message.turnId ? [message.turnId] : [])),
  )
  return {
    messages,
    turns: window.turns.filter((turn) => ids.has(turn.assistantId) || ownedTurns.has(turn.id)),
    ...(window.historyRevision !== undefined ? { historyRevision: window.historyRevision } : {}),
    ...(start > 0 ? { before: messages[0]!.id } : {}),
  }
}
/** Loaded history lives outside the authoritative live snapshot and its editable draft. */
export function mergeConversationHistory<
  T extends Pick<
    Task,
    'messages' | 'turns' | 'historyTotals' | 'historyBefore' | 'historyRevision'
  >,
>(live: T, pages: readonly ConversationPage[], authoritative = true): T {
  pages = pages.filter((page) =>
    authoritative
      ? (page.historyRevision ?? 0) === (live.historyRevision ?? 0)
      : (page.historyRevision ?? 0) >= (live.historyRevision ?? 0),
  )
  if (!pages.length) return live
  // A complete host window owns all membership. Offline mobile restores may have
  // no live window yet, so those explicitly retain their saved replica.
  if (authoritative && !live.historyBefore) return live
  const messages = new Map(
    pages.flatMap((page) => page.messages.map((message) => [message.id, message] as const)),
  )
  const cached = [...messages.values()]
  const boundary = cached.findIndex((message) => message.id === live.messages[0]?.id)
  if (authoritative && boundary < 0 && live.messages.some((message) => messages.has(message.id)))
    return live
  if (authoritative && boundary >= 0) {
    // Cached copies at/after the first live message cannot resurrect deletions
    // or rewind tails. Pages fetched strictly before it remain available.
    for (const message of cached.slice(boundary)) messages.delete(message.id)
  }
  const turns = new Map(pages.flatMap((page) => page.turns.map((turn) => [turn.id, turn] as const)))
  const ownedTurns = new Set(
    [...messages.values()].flatMap((message) => (message.turnId ? [message.turnId] : [])),
  )
  for (const [id, turn] of turns)
    if (!messages.has(turn.assistantId) && !ownedTurns.has(id)) turns.delete(id)
  for (const message of live.messages) messages.set(message.id, message)
  for (const turn of live.turns ?? []) turns.set(turn.id, turn)
  const liveTurns = new Set(live.turns?.map((turn) => turn.id))
  const added = [...turns.values()].filter((turn) => !liveTurns.has(turn.id))
  const loadedUsage = taskBudgetUsage({ turns: added })
  return {
    ...live,
    ...(!authoritative
      ? {
          historyRevision: Math.max(
            live.historyRevision ?? 0,
            ...pages.map((page) => page.historyRevision ?? 0),
          ),
        }
      : {}),
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
