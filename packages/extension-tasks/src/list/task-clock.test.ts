import { expect, it } from 'vite-plus/test'
import { readFileSync } from 'node:fs'
import { threadWorkingSince } from '@dovo/protocol'
import { createTask, type Task } from '@dovo/studio-core'
import { taskClockInterval } from './task-clock'

const now = Date.parse('2026-10-13T12:00:00Z')
const task = createTask({ title: 'Clock', repositoryId: 'repo', agentId: '', objective: '' })
const turn = (startedAt: string, finishedAt?: string): NonNullable<Task['turns']>[number] => ({
  id: 'turn',
  assistantId: 'assistant',
  agentId: '',
  provider: 'codex',
  model: '',
  status: finishedAt ? 'completed' : 'running',
  startedAt,
  ...(finishedAt ? { finishedAt } : {}),
})

it('counts seconds throughout running work', () => {
  expect(
    taskClockInterval({ ...task, status: 'running', turns: [turn('2026-10-13T11:59:30Z')] }, now),
  ).toBe(1000)
  expect(
    taskClockInterval({ ...task, status: 'running', turns: [turn('2026-10-13T11:58:00Z')] }, now),
  ).toBe(1000)
  expect(
    taskClockInterval(
      { ...task, status: 'running', turns: [turn('2026-10-13T11:58:00Z')] },
      now,
      true,
    ),
  ).toBe(60000)
  expect(
    taskClockInterval(
      {
        ...task,
        status: 'running',
        runPhase: 'finalizing',
        turns: [turn('2026-10-13T11:59:30Z')],
      },
      now,
    ),
  ).toBe(60000)
})

it('updates finished and snoozed labels per minute and leaves timeless rows without a clock', () => {
  expect(
    taskClockInterval(
      { ...task, status: 'running', turns: [turn('2026-10-13T11:58:00Z')] },
      now,
      false,
      false,
    ),
  ).toBe(60000)
  expect(
    taskClockInterval(
      { ...task, status: 'done', turns: [turn('2026-10-13T11:00:00Z', '2026-10-13T11:05:00Z')] },
      now,
    ),
  ).toBe(60000)
  expect(taskClockInterval({ ...task, snoozedUntil: '2026-10-13T13:00:00Z' }, now)).toBe(60000)
  expect(taskClockInterval(task, now)).toBeNull()
})

it('keeps a completed parent on the working cadence until its child finishes', () => {
  const parent: Task = {
    ...task,
    status: 'review',
    turns: [turn('2026-10-13T11:59:30Z', '2026-10-13T11:59:45Z')],
    subagents: [
      {
        id: 'child',
        name: 'Child',
        provider: 'codex',
        source: 'dovo',
        status: 'working',
        sessionLive: true,
        startedAt: '2026-10-13T11:59:40Z',
        updatedAt: '2026-10-13T11:59:40Z',
      },
    ],
  }
  expect(taskClockInterval(parent, now)).toBe(1000)
  expect(taskClockInterval(parent, now, false, false)).toBe(60000)
  expect(taskClockInterval({ ...parent, subagents: [] }, now)).toBe(60000)
})

it('matches Lean’s working-clock cases across parent and child states', () => {
  const cases = readFileSync(
    new URL('../../../../verification/bot-workflows-cases.jsonl', import.meta.url),
    'utf8',
  )
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          kind: string
          parent: 'running' | 'finalizing' | 'finished'
          child: 'none' | 'working' | 'pending' | 'background' | 'finished'
          startedAt: number | null
          workingSince: number | null
        },
    )
    .filter((entry) => entry.kind === 'timer')
  expect(cases).toHaveLength(30)
  const stamp = (value: number) => new Date(value).toISOString()
  for (const { parent, child, startedAt, workingSince } of cases) {
    const current: Task = {
      ...task,
      status: parent === 'finished' ? 'review' : 'running',
      runPhase: parent === 'finalizing' ? 'finalizing' : undefined,
      subagents:
        child === 'none'
          ? []
          : [
              {
                id: 'child',
                name: 'Child',
                provider: 'codex',
                source: 'dovo',
                kind: child === 'background' ? 'background' : undefined,
                status: child === 'finished' || child === 'pending' ? 'completed' : 'working',
                completion: child === 'pending' ? 'pending' : undefined,
                finishedAt: child === 'finished' || child === 'pending' ? stamp(2) : undefined,
                sessionLive: true,
                startedAt: stamp(1),
                updatedAt: stamp(2),
              },
            ],
    }
    expect(
      threadWorkingSince(current, startedAt === null ? undefined : { startedAt: stamp(startedAt) }),
    ).toBe(workingSince === null ? undefined : stamp(workingSince))
  }
})
