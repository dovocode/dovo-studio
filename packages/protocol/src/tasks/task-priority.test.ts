import { decode } from '../shared/schema.js'
import { describe, expect, it } from 'vitest'
import { compareTasks, taskSortOptions } from './task-priority'
import { taskSchema } from '../workspace'
const task = (id: string, createdAt: string) =>
  decode(taskSchema, {
    id,
    title: id,
    repositoryId: id,
    agentId: '',
    status: 'draft',
    createdAt,
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
const a = task('Alpha', '2026-09-01T00:00:00Z')
const b = {
  ...task('Beta', '2026-09-02T00:00:00Z'),
  updatedAt: '2026-09-03T00:00:00Z',
}
const projects = new Map([
  ['Alpha', 'Zebra'],
  ['Beta', 'Apple'],
])
const needsInput = new Set(['Alpha'])
describe('Thread sorting', () => {
  it('supports priority, activity, age, title and project orders', () => {
    const first = (sort: string) =>
      [a, b].sort((x, y) => compareTasks(x, y, sort, needsInput, projects))[0].id
    expect(taskSortOptions.map((option) => first(option.id))).toEqual([
      'Beta',
      'Beta',
      'Beta',
      'Beta',
      'Alpha',
      'Alpha',
      'Beta',
    ])
  })
  it('keeps pinned threads first for every sort', () => {
    for (const option of taskSortOptions)
      expect(
        compareTasks(
          {
            ...a,
            pinned: true,
          },
          b,
          option.id,
          needsInput,
          projects,
        ),
      ).toBeLessThan(0)
  })
  it('has deterministic ties and accepts deleted projects', () => {
    expect(
      compareTasks(
        a,
        {
          ...a,
          id: 'other',
        },
        'project',
        new Set(),
        new Map(),
      ),
    ).toBeLessThan(0)
    expect(compareTasks(a, a, 'activity', needsInput, projects)).toBe(0)
  })
})

it('keeps running threads ordered by their trigger time while output streams', () => {
  const running = (id: string, startedAt: string, updatedAt: string) =>
    decode(taskSchema, {
      ...task(id, '2026-09-01T00:00:00Z'),
      status: 'running',
      updatedAt,
      lastPromptAt: startedAt,
      turns: [
        {
          id: id + '-turn',
          assistantId: id + '-reply',
          agentId: '',
          provider: 'codex',
          model: '',
          startedAt,
          status: 'running',
        },
      ],
    })
  const first = running('first', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z')
  const last = running('last', '2026-10-01T10:01:00Z', '2026-10-01T10:02:00Z')
  for (const sort of ['priority', 'status', 'activity']) {
    expect(compareTasks(first, last, sort, new Set(), new Map())).toBeGreaterThan(0)
    expect(
      compareTasks(
        { ...first, updatedAt: '2026-10-01T10:20:00Z' },
        last,
        sort,
        new Set(),
        new Map(),
      ),
    ).toBeGreaterThan(0)
  }
})

it('ignores questions, tools, completion and restarts when ordering by real prompt input', () => {
  const older = { ...a, lastPromptAt: '2026-10-01T10:00:00Z', status: 'running' as const }
  const newer = { ...b, lastPromptAt: '2026-10-01T10:01:00Z', status: 'review' as const }
  expect(compareTasks(older, newer, 'priority', new Set([older.id]), projects)).toBeGreaterThan(0)
  expect(
    compareTasks(
      { ...older, updatedAt: '2026-10-01T12:00:00Z', status: 'failed' },
      newer,
      'priority',
      new Set(),
      projects,
    ),
  ).toBeGreaterThan(0)
})
it('uses legacy prompt timestamps including queued input but excludes answer and review messages', () => {
  const older = {
    ...a,
    messages: [
      { id: 'prompt', role: 'user' as const, text: 'Prompt', createdAt: '2026-10-01T10:00:00Z' },
      {
        id: 'answer:question',
        role: 'user' as const,
        text: 'Answer',
        createdAt: '2026-10-01T12:00:00Z',
      },
    ],
  }
  const newer = {
    ...b,
    queue: [
      { id: 'queued', role: 'user' as const, text: 'Next', createdAt: '2026-10-01T11:00:00Z' },
    ],
  }
  expect(compareTasks(older, newer, 'activity', new Set(), projects)).toBeGreaterThan(0)
})
