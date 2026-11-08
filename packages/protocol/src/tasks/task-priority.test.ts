import { decode } from '../shared/schema.js'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  taskSnoozeMenuChoices,
  defaultTaskSnoozeSchedule,
  parseTaskSnoozeSchedule,
  compareTasks,
  taskSortOptions,
  isSnoozed,
  taskSnoozeChoices,
  parseTaskSnoozeMinutes,
  formatTaskSnoozeMinutes,
} from './task-priority'
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

it('ends snoozing at its deadline and allows clearing it early', () => {
  const deadline = Date.parse('2026-10-03T12:00:00Z')
  const snoozed = { ...a, snoozedUntil: new Date(deadline).toISOString() }
  expect(isSnoozed(snoozed, deadline - 1)).toBe(true)
  expect(isSnoozed(snoozed, deadline)).toBe(false)
  expect(isSnoozed(snoozed, deadline + 1)).toBe(false)
  expect(isSnoozed({ ...snoozed, snoozedUntil: undefined }, deadline - 1)).toBe(false)
})

it('preserves numeric, case-insensitive name sorting and activity ties', () => {
  const tasks = ['Item 10', 'item 2', 'ITEM 2', 'Éclair', 'Alpha'].map((title, i) => ({
    ...task(String(i), `2026-09-0${i + 1}T00:00:00Z`),
    title,
  }))
  const projectNames = new Map(tasks.map((entry) => [entry.repositoryId, entry.title]))
  for (const sort of ['title', 'project']) {
    const expected = [...tasks].sort(
      (a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) ||
        compareTasks(a, b, 'activity', new Set(), projectNames),
    )
    expect([...tasks].sort((a, b) => compareTasks(a, b, sort, new Set(), projectNames))).toEqual(
      expected,
    )
  }
})

describe('Configurable snooze durations', () => {
  it('preserves existing defaults and menu order, including minute-sized durations', () => {
    expect(taskSnoozeChoices()).toEqual([
      { hours: 1, label: 'For 1 hour' },
      { hours: 4, label: 'For 4 hours' },
      { hours: 24, label: 'For 24 hours' },
      { hours: 48, label: 'For 2 days' },
      { hours: 72, label: 'For 3 days' },
      { hours: 168, label: 'For 7 days' },
    ])
    const custom = parseTaskSnoozeMinutes('2d, 15m, 1.5H, 1w')
    expect(custom).toEqual([2880, 15, 90, 10080])
    expect(parseTaskSnoozeMinutes(formatTaskSnoozeMinutes(custom))).toEqual(custom)
    expect(taskSnoozeChoices(custom)[1]).toEqual({ hours: 0.25, label: 'For 15 minutes' })
  })

  it.each([
    '',
    '0m',
    '-1h',
    'tomorrow',
    '1',
    '1h, 60m',
    '0.1m',
    '366d',
    'Infinityh',
    '1h,',
    Array.from({ length: 13 }, (_, i) => `${i + 1}m`).join(','),
  ])('rejects invalid duration lists: %s', (text) => {
    expect(() => parseTaskSnoozeMinutes(text)).toThrow(/durations/)
  })
})

// Calendar dates must stay local across month/year and daylight-saving boundaries.
describe('Calendar snoozes', () => {
  afterEach(() => vi.useRealTimers())
  it('orders and disables shortcuts and resolves durations when selected', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 11, 31, 10))
    const choices = taskSnoozeMenuChoices([15], {
      ...defaultTaskSnoozeSchedule,
      presets: ['next-week', 'tomorrow-morning'],
    })
    expect(choices.map((choice) => choice.id)).toEqual([
      'next-week',
      'tomorrow-morning',
      'duration-0.25',
    ])
    expect(choices[1]!.until()).toBe(new Date(2027, 0, 1, 9).toISOString())
    vi.setSystemTime(new Date(2026, 11, 31, 11))
    expect(choices[2]!.until()).toBe(new Date(2026, 11, 31, 11, 15).toISOString())
  })
  it('uses the next chosen weekday and hides Later today after cutoff', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 2, 18)) // Monday
    const choices = taskSnoozeMenuChoices([])
    expect(choices.some((choice) => choice.id === 'later-today')).toBe(false)
    expect(choices.find((choice) => choice.id === 'next-week')!.until()).toBe(
      new Date(2026, 10, 9, 9).toISOString(),
    )
    expect(choices.find((choice) => choice.id === 'tomorrow-evening')!.until()).toBe(
      new Date(2026, 10, 3, 18).toISOString(),
    )
  })
  it('uses local calendar days across daylight saving time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 28, 10))
    expect(
      taskSnoozeMenuChoices([])
        .find((choice) => choice.id === 'tomorrow-morning')!
        .until(),
    ).toBe(new Date(2026, 2, 29, 9).toISOString())
  })
  it('validates times, weekdays and unique enabled shortcuts, allowing all disabled', () => {
    expect(parseTaskSnoozeSchedule({ ...defaultTaskSnoozeSchedule, presets: [] })).toMatchObject({
      presets: [],
    })
    for (const invalid of [
      { morningTime: '25:00' },
      { eveningTime: '9:00' },
      { weekStartsOn: 7 },
      { presets: ['next-week', 'next-week'] },
      { presets: ['unknown'] },
    ])
      expect(() => parseTaskSnoozeSchedule({ ...defaultTaskSnoozeSchedule, ...invalid })).toThrow(
        'Use 24-hour times',
      )
  })
})
