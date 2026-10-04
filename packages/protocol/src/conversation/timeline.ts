import type { Task, TaskTurn } from '../workspace.js'
import type { recentTools } from '../automation/activity.js'

type Conversation = Pick<Task, 'messages' | 'turns'>
type Tool = ReturnType<typeof recentTools>[number]
type Compaction = NonNullable<Task['compactions']>[number]

/** Explicit ownership survives steering. Timestamps recover older stored executions. */
export function conversationMessageTurns(task: Conversation) {
  const byId = new Map(task.turns?.map((turn) => [turn.id, turn]))
  const result = new Map<string, TaskTurn>()
  const positions = new Map(task.messages.map((message, index) => [message.id, index]))
  for (const turn of task.turns ?? []) {
    const end = positions.get(turn.assistantId)
    if (end === undefined) continue
    result.set(turn.assistantId, turn)
    const start = Date.parse(turn.startedAt)
    if (!Number.isFinite(start)) continue
    for (let index = end - 1; index >= 0; index--) {
      const message = task.messages[index]!
      const time = Date.parse(message.createdAt ?? '')
      if (!Number.isFinite(time) || time < start) break
      if (!message.turnId && !result.has(message.id)) result.set(message.id, turn)
    }
  }
  for (const message of task.messages) {
    const turn = message.turnId ? byId.get(message.turnId) : undefined
    if (turn) result.set(message.id, turn)
  }
  return result
}

export type ConversationTurn = {
  id: string
  messages: Task['messages']
  status: TaskTurn['status'] | 'waiting'
  turn?: TaskTurn
}

/** A request owns resumed executions and steering inputs until the next request. */
export function conversationTurns(task: Conversation): ConversationTurn[] {
  const owners = conversationMessageTurns(task)
  const runs = new Map<string, string>()
  let nextRun: string | undefined
  for (const message of [...task.messages].reverse()) {
    const turn = owners.get(message.id)
    if (turn) nextRun = turn.runId ?? turn.id
    if (message.role === 'user') {
      if (nextRun) runs.set(message.id, nextRun)
      nextRun = undefined
    }
  }
  const groups: ConversationTurn[] = []
  let currentRun: string | undefined
  for (const message of task.messages) {
    const owner = owners.get(message.id)
    const run = message.role === 'user' ? runs.get(message.id) : owner?.runId
    if (
      !groups.length ||
      (message.role === 'user' && (!run || run !== currentRun)) ||
      (message.role === 'assistant' && run && currentRun && run !== currentRun)
    ) {
      currentRun = run
      groups.push({ id: message.id, messages: [], status: 'waiting' })
    }
    if (run) currentRun = run
    const group = groups[groups.length - 1]!
    group.messages.push(message)
    const turn = owners.get(message.id)
    if (turn) {
      group.status = turn.status
      group.turn =
        group.turn && group.turn.startedAt < turn.startedAt
          ? { ...turn, startedAt: group.turn.startedAt }
          : turn
    } else if (!group.turn && message.role === 'assistant' && message.text.trim())
      group.status = 'completed'
  }
  return groups
}

export const conversationTurnLabel = (status: ConversationTurn['status']) =>
  ({
    waiting: 'Awaiting response',
    running: 'Working',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Stopped',
  })[status]

/** Shared presentation metadata lets native virtualized cells fold one logical response. */
export function conversationPresentation(task: Conversation) {
  const owners = conversationMessageTurns(task)
  const result = new Map<
    string,
    {
      groupId: string
      header: boolean
      final: boolean
      footer: boolean
      turn?: TaskTurn
      groupTurn?: TaskTurn
    }
  >()
  for (const group of conversationTurns(task)) {
    const assistants = group.messages.filter((message) => message.role === 'assistant')
    const final = assistants.at(-1)
    for (const message of group.messages)
      result.set(message.id, {
        groupId: group.id,
        header: assistants[0]?.id === message.id,
        final: final?.id === message.id,
        footer: assistants.at(-1)?.id === message.id,
        turn: owners.get(message.id),
        groupTurn: group.turn,
      })
  }
  return result
}

/** Old events use their start time; new events name their original assistant message. */
export function conversationToolsByMessage(task: Conversation, tools: Tool[]) {
  const owners = conversationMessageTurns(task)
  const assistants = task.messages.filter((message) => message.role === 'assistant')
  const byTurn = new Map<string, typeof assistants>()
  for (const message of assistants) {
    const turn = owners.get(message.id)
    if (!turn) continue
    const messages = byTurn.get(turn.id) ?? []
    messages.push(message)
    byTurn.set(turn.id, messages)
  }
  const result = new Map<string, Tool[]>()
  for (const tool of [...tools].reverse()) {
    const candidates = tool.turnId ? byTurn.get(tool.turnId) : undefined
    const messageId =
      tool.messageId ??
      candidates
        ?.slice()
        .reverse()
        .find(
          (message) => !!message.createdAt && message.createdAt <= (tool.startedAt ?? tool.time),
        )?.id ??
      candidates?.at(-1)?.id
    if (!messageId) continue
    const group = result.get(messageId) ?? []
    group.push(tool)
    result.set(messageId, group)
  }
  return result
}

export type ThreadBlock =
  | { kind: 'activity'; key: string; offset: number; tools: Tool[] }
  | { kind: 'compaction'; offset: number; event: Compaction }
  | { kind: 'text'; offset: number; text: string }

/** Tools attach to provider message boundaries, never arbitrary streaming character offsets. */
export function threadTimeline(
  text: string,
  tools: Tool[],
  compactions: Compaction[] = [],
  textBreaks: readonly number[] = [],
): ThreadBlock[] {
  const boundaries = [
    ...new Set(
      [0, ...textBreaks, text.length].map((offset) => Math.min(text.length, Math.max(0, offset))),
    ),
  ].sort((a, b) => a - b)
  const boundary = (raw: number) => boundaries.find((offset) => offset >= raw) ?? text.length
  const at = new Map<
    number,
    Array<{ kind: 'tool'; tool: Tool } | { kind: 'compaction'; event: Compaction }>
  >()
  for (const tool of tools) {
    const offset = boundary(Math.max(0, tool.textOffset ?? text.length))
    const entries = at.get(offset) ?? []
    entries.push({ kind: 'tool', tool })
    at.set(offset, entries)
  }
  for (const event of compactions) {
    const offset = boundary(Math.max(0, event.textOffset ?? text.length))
    const entries = at.get(offset) ?? []
    entries.push({ kind: 'compaction', event })
    at.set(offset, entries)
  }
  const blocks: ThreadBlock[] = []
  let cursor = 0
  for (const offset of boundaries) {
    if (offset > cursor)
      blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor, offset) })
    const entries = (at.get(offset) ?? []).sort((left, right) => {
      const time = (entry: typeof left) =>
        entry.kind === 'tool' ? (entry.tool.startedAt ?? entry.tool.time) : entry.event.at
      return time(left).localeCompare(time(right))
    })
    let current: Tool[] = []
    let segment = 'start'
    let sequence = 0
    const flush = () => {
      if (current.length)
        blocks.push({
          kind: 'activity',
          key: `activity:${Math.min(...current.map((tool) => tool.textOffset ?? offset))}:${segment}:${sequence++}`,
          offset,
          tools: current,
        })
      current = []
    }
    for (const entry of entries) {
      if (entry.kind === 'tool') {
        const failed = ['failed', 'error', 'cancelled', 'interrupted'].includes(entry.tool.status)
        if (failed || (current.length && current[0]?.turnId !== entry.tool.turnId)) flush()
        current.push(entry.tool)
        if (failed) {
          flush()
        }
      } else {
        flush()
        blocks.push({ kind: 'compaction', offset, event: entry.event })
        segment = entry.event.at
      }
    }
    flush()
    cursor = offset
  }
  return blocks
}

export function finalReplyIndex(blocks: ThreadBlock[], running: boolean) {
  return running
    ? -1
    : blocks.reduce((last, block, index) => (block.kind === 'text' ? index : last), -1)
}
