import { expect, it } from 'vite-plus/test'
import type { Task, TaskTurn } from '../workspace'
import { recentTools } from '../automation/activity'
import {
  conversationTurns,
  conversationPresentation,
  conversationMessageTurns,
  conversationToolsByMessage,
  unassignedConversationTools,
  threadTimeline,
} from './timeline'

const turn: TaskTurn = {
  id: 'attempt',
  runId: 'run',
  assistantId: 'after',
  status: 'completed',
  agentId: 'agent',
  provider: 'codex',
  model: '',
  startedAt: '2026-10-03T10:00:01Z',
  finishedAt: '2026-10-03T10:01:00Z',
}
const messages: Task['messages'] = [
  {
    id: 'request',
    turnId: 'attempt',
    role: 'user',
    text: 'Fix it',
    createdAt: '2026-10-03T10:00:00Z',
  },
  {
    id: 'before',
    turnId: 'attempt',
    role: 'assistant',
    text: 'First.Second.',
    textBreaks: [6, 13],
    createdAt: '2026-10-03T10:00:02Z',
  },
  {
    id: 'steer',
    turnId: 'attempt',
    role: 'user',
    text: 'Clarification',
    createdAt: '2026-10-03T10:00:10Z',
  },
  {
    id: 'after',
    turnId: 'attempt',
    role: 'assistant',
    text: 'Final answer.',
    createdAt: '2026-10-03T10:00:11Z',
  },
]
const task = { messages, turns: [turn] }

function legacyMessageTurns(input: Pick<Task, 'messages' | 'turns'>) {
  const byId = new Map(input.turns?.map((item) => [item.id, item]))
  const result = new Map<string, TaskTurn>()
  const positions = new Map(input.messages.map((message, index) => [message.id, index]))
  for (const item of input.turns ?? []) {
    const end = positions.get(item.assistantId)
    if (end === undefined) continue
    result.set(item.assistantId, item)
    const start = Date.parse(item.startedAt)
    if (!Number.isFinite(start)) continue
    for (let index = end - 1; index >= 0; index--) {
      const message = input.messages[index]!
      const time = Date.parse(message.createdAt ?? '')
      if (!Number.isFinite(time) || time < start) break
      if (!message.turnId && !result.has(message.id)) result.set(message.id, item)
    }
  }
  for (const message of input.messages) {
    const owner = message.turnId ? byId.get(message.turnId) : undefined
    if (owner) result.set(message.id, owner)
  }
  return result
}

it('matches legacy ownership for overlapping, unordered, invalid and duplicate histories', () => {
  let seed = 0x12345678
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed >>> 8) % limit
  }
  const times = [
    undefined,
    '',
    'invalid',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:01Z',
    '2025-01-01T00:00:00Z',
  ]
  for (let sample = 0; sample < 2000; sample++) {
    const input: Pick<Task, 'messages' | 'turns'> = {
      messages: Array.from({ length: random(30) }, () => ({
        id: `message-${random(12)}`,
        role: random(2) ? 'assistant' : 'user',
        text: '',
        createdAt: times[random(times.length)],
        turnId: [undefined, '', 'missing', `turn-${random(8)}`][random(4)],
      })),
      turns: Array.from({ length: random(15) }, () => ({
        ...turn,
        id: `turn-${random(8)}`,
        assistantId: `message-${random(14)}`,
        startedAt: times[random(times.length)] ?? '',
      })),
    }
    expect([...conversationMessageTurns(input)]).toEqual([...legacyMessageTurns(input)])
  }
})

it('preserves earlier timestamp ownership, later duplicate assistants and explicit overrides', () => {
  const first = { ...turn, id: 'first', assistantId: 'answer', startedAt: '2026-01-01T00:00:00Z' }
  const second = { ...first, id: 'second' }
  const input: Pick<Task, 'messages' | 'turns'> = {
    messages: [
      { id: 'implicit', role: 'user', text: '', createdAt: '2026-01-01T00:00:01Z' },
      {
        id: 'explicit',
        role: 'user',
        text: '',
        createdAt: '2026-01-01T00:00:01Z',
        turnId: 'second',
      },
      { id: 'answer', role: 'assistant', text: '', createdAt: '2026-01-01T00:00:01Z' },
    ],
    turns: [first, second],
  }
  expect([...conversationMessageTurns(input)]).toEqual([...legacyMessageTurns(input)])
  expect(conversationMessageTurns(input).get('implicit')).toBe(first)
  expect(conversationMessageTurns(input).get('explicit')).toBe(second)
  expect(conversationMessageTurns(input).get('answer')).toBe(second)
})

it('keeps native steering in one logical turn and marks exactly one header and final reply', () => {
  const groups = conversationTurns(task)
  expect(groups).toHaveLength(1)
  expect(groups[0]?.messages.map((message) => message.id)).toEqual([
    'request',
    'before',
    'steer',
    'after',
  ])
  const presentation = [...conversationPresentation(task).entries()]
  expect(presentation.filter(([, item]) => item.header).map(([id]) => id)).toEqual(['before'])
  expect(presentation.filter(([, item]) => item.final).map(([id]) => id)).toEqual(['after'])
  expect(conversationMessageTurns(task).get('before')).toBe(turn)
})

it('recovers native steering ownership in older timestamped conversations', () => {
  const legacy = {
    ...task,
    messages: messages.map((message) => ({ ...message, turnId: undefined })),
  }
  expect(conversationTurns(legacy)).toHaveLength(1)
  expect(conversationMessageTurns(legacy).get('before')).toBe(turn)
})

it('does not merge an independent request or change an imported message without turn records', () => {
  const next = {
    ...turn,
    id: 'next',
    runId: 'next',
    assistantId: 'next-answer',
    startedAt: '2026-10-03T10:02:00Z',
  }
  expect(
    conversationTurns({
      messages: [
        ...messages,
        { id: 'next-request', turnId: 'next', role: 'user', text: 'Different request' },
        { id: 'next-answer', turnId: 'next', role: 'assistant', text: 'Done' },
      ],
      turns: [turn, next],
    }),
  ).toHaveLength(2)
  expect(
    conversationTurns({ messages: [{ id: 'old', role: 'assistant', text: 'Imported' }] }),
  ).toMatchObject([{ id: 'old', status: 'completed' }])
})

it('keeps a late tool completion on the assistant message where the tool started', () => {
  const events = recentTools([
    {
      id: 'finished',
      time: '2026-10-03T10:00:20Z',
      scope: 'task',
      kind: 'tool',
      summary: 'Tool result',
      payload: JSON.stringify({
        turnId: 'attempt',
        messageId: 'after',
        toolId: 'command',
        status: 'completed',
        textOffset: 3,
      }),
    },
    {
      id: 'started',
      time: '2026-10-03T10:00:03Z',
      scope: 'task',
      kind: 'tool',
      summary: 'Command',
      payload: JSON.stringify({
        turnId: 'attempt',
        messageId: 'before',
        toolId: 'command',
        status: 'running',
        textOffset: 6,
      }),
    },
  ])
  expect(events[0]).toMatchObject({ messageId: 'before', textOffset: 6, status: 'completed' })
  const byMessage = conversationToolsByMessage(task, events)
  expect(byMessage.get('before')).toHaveLength(1)
  expect(byMessage.has('after')).toBe(false)
  expect(
    conversationToolsByMessage(
      task,
      events.map((event) => ({ ...event, messageId: undefined })),
    ).get('before'),
  ).toHaveLength(1)
})

it('never cuts a hyphenated word or unfinished prose when a tool event arrives', () => {
  const text = 'Linking will appear only on right-click or long-press.'
  const tools = recentTools([
    {
      id: 'command',
      time: turn.startedAt,
      kind: 'tool',
      scope: 'task',
      summary: 'Command',
      payload: JSON.stringify({
        turnId: turn.id,
        toolId: 'command',
        status: 'running',
        textOffset: text.indexOf('-press'),
      }),
    },
  ])
  const blocks = threadTimeline(text, tools)
  expect(blocks.filter((block) => block.kind === 'text')).toEqual([
    { kind: 'text', offset: 0, text },
  ])
})

it('keeps completed provider messages distinct even on old orphaned assistant messages', () => {
  expect(
    threadTimeline(messages[1]!.text, [], [], messages[1]!.textBreaks).map((block) =>
      block.kind === 'text' ? block.text : block.kind,
    ),
  ).toEqual(['First.', 'Second.'])
})

it('preserves the initiating time across replacement executions and opens failed work', () => {
  const replacement = {
    ...turn,
    id: 'replacement',
    assistantId: 'after',
    startedAt: '2026-10-03T10:00:15Z',
    status: 'failed' as const,
  }
  const result = conversationTurns({
    messages: messages.map((message) =>
      message.id === 'after' || message.id === 'steer'
        ? { ...message, turnId: 'replacement' }
        : message,
    ),
    turns: [{ ...turn, assistantId: 'before', status: 'cancelled' }, replacement],
  })
  expect(result).toHaveLength(1)
  expect(result[0]?.turn).toMatchObject({
    id: 'replacement',
    status: 'failed',
    startedAt: turn.startedAt,
  })
})

it('starts a new group for an independent promptless logical run, but retains resumed attempts', () => {
  const next = {
    ...turn,
    id: 'wake',
    runId: 'wake',
    assistantId: 'wake-reply',
    startedAt: '2026-10-03T11:00:00Z',
  }
  const task = {
    messages: [
      ...messages,
      { id: 'wake-reply', role: 'assistant' as const, turnId: 'wake', text: 'Background result' },
    ],
    turns: [turn, next],
  }
  expect(conversationTurns(task).map((group) => group.id)).toEqual(['request', 'wake-reply'])
  expect(conversationTurns({ ...task, turns: [turn, { ...next, runId: 'run' }] })).toHaveLength(1)
})

it('does not promote previous commentary when the terminal assistant message has no answer', () => {
  const task = {
    messages: messages.map((message) =>
      message.id === 'after' ? { ...message, text: '' } : message,
    ),
    turns: [turn],
  }
  expect(
    [...conversationPresentation(task)].filter(([, item]) => item.final).map(([id]) => id),
  ).toEqual(['after'])
})

it('groups failures with adjacent tools while preserving execution boundaries', () => {
  const tools = ['completed', 'failed', 'completed', 'completed'].map((status, index) => ({
    id: String(index),
    status,
    time: turn.startedAt,
    startedAt: turn.startedAt,
    kind: 'tool',
    scope: 'task',
    summary: 'Command',
    payload: '{}',
    turnId: index === 3 ? 'replacement' : 'attempt',
    textOffset: 0,
  }))
  const groups = threadTimeline('', tools).filter((block) => block.kind === 'activity')
  expect(groups.map((block) => block.tools.map((tool) => tool.id))).toEqual([
    ['0', '1', '2'],
    ['3'],
  ])
  expect(new Set(groups.map((block) => block.key)).size).toBe(2)
})

it('keeps a tool group disclosure stable when new activity events update the same tool', () => {
  const tool = {
    id: 'start-event',
    status: 'running',
    time: turn.startedAt,
    kind: 'tool',
    scope: 'task',
    summary: 'Command',
    payload: '{}',
    turnId: turn.id,
    textOffset: 0,
  }
  const before = threadTimeline('', [tool])
  const after = threadTimeline('', [{ ...tool, id: 'completion-event', status: 'completed' }])
  expect(before[0]?.kind === 'activity' && before[0].key).toBe(
    after[0]?.kind === 'activity' && after[0].key,
  )
})

it.each(['artifacts', 'images'])(
  'shows %s only at their owning message, never in the fallback when history is unloaded',
  (kind) => {
    const reference = {
      id: 'a2ecfb4a-d6c3-40bd-8695-f40a352fb612',
      taskId: 'task',
      title: 'Design',
      format: 'html',
      revision: 1,
    }
    const tools = recentTools([
      {
        id: 'artifact',
        time: '2026-10-03T10:00:05Z',
        kind: 'tool',
        scope: 'task',
        summary: 'Design',
        payload: JSON.stringify({
          turnId: turn.id,
          messageId: 'before',
          toolId: 'artifact',
          status: 'completed',
          ...(kind === 'artifacts'
            ? { artifacts: [reference] }
            : { toolImages: [{ eventId: 'image', index: 0 }] }),
        }),
      },
      {
        id: 'orphan',
        time: '2026-10-03T10:00:06Z',
        kind: 'tool',
        scope: 'task',
        summary: 'Legacy artifact',
        payload: JSON.stringify(
          kind === 'artifacts'
            ? { artifacts: [{ ...reference, revision: 2 }] }
            : { toolImages: [{ eventId: 'orphan-image', index: 0 }] },
        ),
      },
      {
        id: 'legacy',
        time: '2026-10-03T10:00:07Z',
        kind: 'tool',
        scope: 'task',
        summary: 'Legacy command',
        payload: '{}',
      },
    ])
    expect(
      conversationToolsByMessage(task, tools)
        .get('before')
        ?.map((tool) => tool.id),
    ).toEqual(['artifact'])
    expect(unassignedConversationTools(task, tools).map((tool) => tool.id)).toEqual(['legacy'])
    const partial = { ...task, messages: messages.filter((message) => message.id === 'after') }
    expect(unassignedConversationTools(partial, tools).map((tool) => tool.id)).toEqual(['legacy'])
  },
)

it('places events at the first completed message boundary across duplicate and out-of-range offsets', () => {
  const offsets = [-5, 0, 1, 10, 10.5, 20, 35, 40, 80]
  const tools = offsets.map((textOffset, index) => ({
    id: String(index),
    time: turn.startedAt,
    kind: 'tool',
    scope: 'task',
    summary: 'Tool',
    payload: '{}',
    status: 'completed',
    textOffset,
  }))
  const blocks = threadTimeline('x'.repeat(40), tools, [], [30, 10, 20, 10, -10, 80])
  const placed = new Map(
    blocks.flatMap((block) =>
      block.kind === 'activity' ? block.tools.map((tool) => [tool.id, block.offset] as const) : [],
    ),
  )
  expect(offsets.map((_, index) => placed.get(String(index)))).toEqual([
    0, 0, 10, 10, 20, 20, 40, 40, 40,
  ])
  expect(
    blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join(''),
  ).toBe('x'.repeat(40))
})
