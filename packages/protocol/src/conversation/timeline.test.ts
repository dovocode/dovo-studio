import { expect, it } from 'vite-plus/test'
import type { Task, TaskTurn } from '../workspace'
import { recentTools } from '../automation/activity'
import {
  conversationTurns,
  conversationPresentation,
  conversationMessageTurns,
  conversationToolsByMessage,
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
