import { describe, expect, it } from 'vite-plus/test'
import type { Task, TaskTurn } from '@dovo/protocol'
import { conversationMessages, type ToolEvents } from './messages'
const startedAt = '2026-09-13T10:00:00Z'
const turn = (id: string, assistantId: string, status: TaskTurn['status']): TaskTurn => ({
  id,
  assistantId,
  status,
  startedAt,
  agentId: 'agent',
  provider: 'codex',
  model: 'test',
})
const task: Task = {
  id: 'task',
  title: 'Test',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'running',
  createdAt: startedAt,
  example: false,
  draft: '',
  files: [],
  messages: [
    { id: 'user', role: 'user', text: 'Fix it' },
    { id: 'a1', role: 'assistant', text: 'First answer' },
    { id: 'a2', role: 'assistant', text: 'Second answer' },
  ],
  turns: [turn('t1', 'a1', 'completed'), turn('t2', 'a2', 'running')],
}
const event = (id: string, turnId: string, status: string): ToolEvents[number] => ({
  id,
  time: startedAt,
  scope: task.id,
  kind: 'tool',
  summary: 'Read file',
  payload: JSON.stringify({ turnId, toolId: 'same-provider-id', status }),
})
describe('Dovo conversation adapter', () => {
  it('keeps adjacent assistant turns separate and associates tools by turn, not provider ID', () => {
    const messages = conversationMessages(task, [
      event('latest', 't2', 'running'),
      event('older', 't1', 'completed'),
    ])
    expect(messages.map((m) => m.id)).toEqual(['user', 'a1', 'a2'])
    expect(messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool-call', toolCallId: 't1:same-provider-id' }),
      ]),
    )
    expect(messages[2].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool-call', toolCallId: 't2:same-provider-id' }),
      ]),
    )
    expect(messages[1].status).toEqual({ type: 'complete', reason: 'stop' })
    expect(messages[2].status).toEqual({ type: 'running' })
  })
  it('keeps the existing order of multiple tools within each turn', () => {
    const result = conversationMessages(task, [
      {
        ...event('newest', 't2', 'completed'),
        payload: JSON.stringify({ turnId: 't2', toolId: 'newest', status: 'completed' }),
      },
      event('another-turn', 't1', 'completed'),
      {
        ...event('older', 't2', 'completed'),
        payload: JSON.stringify({ turnId: 't2', toolId: 'older', status: 'completed' }),
      },
    ])[2]
    const toolIds =
      typeof result.content === 'string'
        ? []
        : result.content.flatMap((part) => (part.type === 'tool-call' ? [part.toolCallId] : []))
    expect(toolIds).toEqual(['t2:older', 't2:newest'])
  })
  it('deduplicates tool updates without changing the invocation identity', () => {
    const before = conversationMessages(task, [event('start', 't2', 'running')])[2]
    const after = conversationMessages(task, [
      event('finish', 't2', 'completed'),
      event('start', 't2', 'running'),
    ])[2]
    expect(before.content).toHaveLength(2)
    expect(after.content).toHaveLength(2)
    expect(after.content[1]).toMatchObject({
      toolCallId: 't2:same-provider-id',
      artifact: { status: 'completed' },
    })
    expect(before.content[1]).toMatchObject({ toolCallId: 't2:same-provider-id' })
  })
  it('ends pending tool display when the turn is cancelled', () => {
    const result = conversationMessages(
      { ...task, status: 'cancelled', turns: [turn('t2', 'a2', 'cancelled')] },
      [event('start', 't2', 'running')],
    )[2]
    expect(result.status).toEqual({ type: 'incomplete', reason: 'cancelled' })
    expect(result.content[1]).toMatchObject({ artifact: { status: 'cancelled' } })
  })
  it('preserves attachments and checkpoint identity without exposing file bodies in the transcript', () => {
    const file = { id: 'attachment', name: 'note.txt', mime: 'text/plain', size: 5 }
    const result = conversationMessages(
      {
        ...task,
        messages: [{ id: 'a1', role: 'assistant', text: '', attachments: [file] }],
        turns: [
          {
            ...turn('t1', 'a1', 'completed'),
            checkpoint: { before: 'before', after: 'after', files: [], omitted: ['large.bin'] },
          },
        ],
      },
      [],
    )
    expect(result[0].content).toEqual([
      { type: 'data', name: 'dovo.attachments', data: [file] },
      {
        type: 'data',
        name: 'dovo.checkpoint',
        data: { turnId: 't1', files: 0, pending: false, omitted: 1, error: undefined },
      },
    ])
  })
  it('does not attribute legacy or unknown-turn events to the latest reply', () => {
    const messages = conversationMessages(task, [
      event('other', 'unrelated-turn', 'running'),
      { ...event('old', '', 'running'), payload: 'old log text' },
    ])
    expect(messages[2].content).toEqual([{ type: 'text', text: 'Second answer' }])
  })
})

it('puts provider reasoning summaries in a separate disclosure instead of counting them as tools', () => {
  const result = conversationMessages(task, [
    {
      ...event('reasoning', 't2', 'running'),
      kind: 'reasoning',
      summary: 'Reasoning',
      payload: JSON.stringify({
        turnId: 't2',
        toolId: 'reasoning-1',
        status: 'running',
        reasoning: { text: 'Check the **current branch** first.' },
      }),
    },
    event('command', 't2', 'running'),
  ])[2]
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'data',
        name: 'dovo.reasoning',
        data: [expect.objectContaining({ kind: 'reasoning', status: 'running' })],
      }),
      expect.objectContaining({ type: 'tool-call', toolCallId: 't2:same-provider-id' }),
    ]),
  )
  expect(result.content).toHaveLength(3)
})
it('rejects events from a different task even when provider turn IDs match', () => {
  const result = conversationMessages(task, [
    { ...event('other-task', 't2', 'running'), scope: 'another-task' },
  ])[2]
  expect(result.content).toEqual([{ type: 'text', text: 'Second answer' }])
})
it.each(['completed', 'failed'] as const)(
  'marks missing tool completions interrupted when a turn becomes %s',
  (status) => {
    const result = conversationMessages({ ...task, turns: [turn('t2', 'a2', status)] }, [
      event('pending', 't2', 'running'),
    ])[2]
    expect(result.content[1]).toMatchObject({ artifact: { status: 'interrupted' }, isError: true })
  },
)
it('retains a completed tool failure rather than inheriting a successful turn result', () => {
  const result = conversationMessages(task, [event('failure', 't1', 'failed')])[1]
  expect(result.content[1]).toMatchObject({ artifact: { status: 'failed' }, isError: true })
})
it('keeps Claude command inputs when result updates have no command name', () => {
  const first = {
    ...event('start', 't2', 'running'),
    payload: JSON.stringify({
      turnId: 't2',
      toolId: 'cmd',
      status: 'running',
      event: {
        message: {
          content: [
            { type: 'tool_use', id: 'cmd', name: 'Bash', input: { command: 'rg Sidebar' } },
          ],
        },
      },
    }),
  }
  const last = {
    ...event('done', 't2', 'completed'),
    payload: JSON.stringify({
      turnId: 't2',
      toolId: 'cmd',
      status: 'completed',
      event: {
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'cmd', content: 'Found Sidebar.tsx' }],
        },
      },
    }),
  }
  const result = conversationMessages(task, [last, first])[2]
  expect(result.content[1]).toMatchObject({
    artifact: { status: 'completed', inputPayload: expect.stringContaining('rg Sidebar') },
  })
})

it('does not keep the assistant message streaming after the task stops before its turn updates', () => {
  const message = conversationMessages({ ...task, status: 'failed' }, [
    event('pending', 't2', 'running'),
  ])[2]
  expect(message.status).toEqual({ type: 'incomplete', reason: 'error' })
  expect(message.content[1]).toMatchObject({ artifact: { status: 'interrupted' } })
})
