import { decode } from '@dovo/protocol'
import { describe, expect, it } from 'vite-plus/test'
import { taskSchema } from '@dovo/protocol'
import { taskToolEvents, type ToolEvents } from './tool-events'
const task = decode(taskSchema, {
  id: 'task',
  repositoryId: 'repo',
  agentId: 'agent',
  title: 'Task',
  messages: [],
  files: [],
  draft: '',
  example: false,
  status: 'running',
  createdAt: '2026-09-23T10:00:00Z',
  turns: [
    {
      id: 'live',
      assistantId: 'reply',
      status: 'running',
      startedAt: '2026-09-23T10:00:00Z',
      agentId: 'agent',
      provider: 'codex',
      model: 'test',
    },
  ],
})
const event = (scope: string, turnId: string): ToolEvents[number] => ({
  id: `${scope}-${turnId}`,
  kind: 'tool',
  scope,
  time: '2026-09-23T10:00:01Z',
  summary: 'Run command',
  payload: JSON.stringify({
    toolId: 'command',
    turnId,
    status: 'running',
  }),
})
describe('mobile task activity ownership and lifecycle', () => {
  it('only treats a matching active turn as running, including legacy activity', () => {
    expect(
      taskToolEvents(task, [
        event('task', 'live'),
        event('task', 'unknown'),
        event('other', 'live'),
      ]).map((value) => [value.turnId, value.status]),
    ).toEqual([
      ['live', 'running'],
      ['unknown', 'interrupted'],
    ])
  })
  it('does not report stale running activity after a cancelled turn', () => {
    const cancelled = {
      ...task,
      turns: task.turns!.map((turn) => ({
        ...turn,
        status: 'cancelled' as const,
      })),
    }
    expect(taskToolEvents(cancelled, [event('task', 'live')])[0].status).toBe('cancelled')
  })
  it('stops stale tool spinners when the task ends before its turn status updates', () => {
    expect(
      taskToolEvents(
        {
          ...task,
          status: 'failed',
        },
        [event('task', 'live')],
      )[0].status,
    ).toBe('interrupted')
    expect(
      taskToolEvents(
        {
          ...task,
          status: 'cancelled',
        },
        [event('task', 'live')],
      )[0].status,
    ).toBe('cancelled')
  })
  it('does not keep an older unfinished turn active after a new turn starts', () => {
    const next = {
      ...task,
      turns: [
        ...task.turns!,
        {
          ...task.turns![0],
          id: 'next',
        },
      ],
    }
    expect(
      taskToolEvents(next, [event('task', 'live'), event('task', 'next')]).map(
        (event) => event.status,
      ),
    ).toEqual(['interrupted', 'running'])
  })
})

it('cached projection retains settled events but updates cancellation and thread scope', async () => {
  const { createTaskToolEvents, taskToolEvents } = await import('./tool-events')
  const project = createTaskToolEvents()
  const thread = { id: 'one', status: 'running' as const, turns: [] }
  const events = [
    {
      id: 'tool',
      time: '2026-10-02T12:00:00Z',
      scope: 'one',
      kind: 'tool',
      summary: 'Command',
      payload: JSON.stringify({ turnId: 'turn', toolId: 'tool', status: 'running' }),
    },
    {
      id: 'other',
      time: '2026-10-02T12:00:00Z',
      scope: 'two',
      kind: 'tool',
      summary: 'Other command',
      payload: JSON.stringify({ turnId: 'turn', toolId: 'tool', status: 'completed' }),
    },
  ]
  const first = project(thread, events)
  expect(first).toEqual(taskToolEvents(thread, events))
  expect(first[0]!.status).toBe('interrupted')
  expect(project(thread, events)[0]).toBe(first[0])
  expect(project({ ...thread, id: 'two' }, events)).toEqual(
    taskToolEvents({ ...thread, id: 'two' }, events),
  )
  expect(project({ ...thread, id: 'two' }, events)[0]!.summary).toBe('Other command')
  const running = {
    ...task,
    id: 'one',
    turns: task.turns?.map((turn) => ({ ...turn, id: 'turn' })),
  }
  expect(project(running, events)[0]!.status).toBe('running')
  const cancelled = {
    ...running,
    status: 'cancelled' as const,
    turns: running.turns?.map((turn) => ({ ...turn, status: 'cancelled' as const })),
  }
  const stopped = project(cancelled, events)
  expect(stopped[0]!.status).toBe('cancelled')
  expect(project(cancelled, events)[0]).toBe(stopped[0])
})
