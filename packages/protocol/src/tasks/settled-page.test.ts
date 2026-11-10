import { expect, it } from 'vite-plus/test'
import {
  omittedSettledCount,
  settledThreadKey,
  settledSummaryPage,
  supportsSettledSummaryPaging,
} from './settled-page.js'
import { compareTasks, taskSortOptions } from './task-priority.js'
import type { Task } from '../workspace.js'
const task = (id: string): Task => ({
  id,
  title: id,
  agentId: '',
  repositoryId: '',
  status: 'review',
  archived: true,
  createdAt: '2026-10-25T00:00:00Z',
  settledAt: `2026-10-25T${id.padStart(2, '0')}:00:00Z`,
  lastPromptAt: `2026-10-25T${id.padStart(2, '0')}:00:00Z`,
  draft: '',
  example: false,
  messages: [],
  files: [],
})
it('bounds settled rows in deterministic prompt/id order while preserving selected, live and protected rows', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => task(String(i)))
  tasks[0] = { ...task('0'), status: 'running' }
  tasks[1] = { ...task('1'), pinned: true }
  tasks[2] = { ...task('2'), archivedAt: '2026-10-25T00:00:00Z' }
  const page = settledSummaryPage(tasks, 3, ['3'])
  expect(page.omitted).toBe(13)
  expect(page.tasks.map((task) => task.id)).toEqual(['0', '1', '2', '3', '17', '18', '19'])
  expect(settledSummaryPage(tasks, 6, ['3']).tasks).toHaveLength(10)
  expect(settledSummaryPage(tasks, 100).omitted).toBe(0)
  expect(tasks).toHaveLength(20)
})

it.each(taskSortOptions)(
  'keeps the first $name row available across page boundaries',
  ({ id: sort }) => {
    const tasks = [
      {
        ...task('1'),
        title: 'Zebra',
        lastPromptAt: '2026-10-25T12:00:00Z',
        createdAt: '2026-10-24T00:00:00Z',
        repositoryId: 'z',
      },
      {
        ...task('2'),
        title: 'Apple',
        lastPromptAt: '2026-10-25T10:00:00Z',
        createdAt: '2026-10-20T00:00:00Z',
        repositoryId: 'a',
      },
      {
        ...task('3'),
        title: 'Pear',
        lastPromptAt: '2026-10-25T11:00:00Z',
        createdAt: '2026-10-25T00:00:00Z',
        status: 'done' as const,
      },
    ]
    const compare = (a: Task, b: Task) =>
      compareTasks(
        a,
        b,
        sort,
        new Set(),
        new Map([
          ['a', 'A'],
          ['z', 'Z'],
        ]),
      )
    const visible = supportsSettledSummaryPaging(sort) ? settledSummaryPage(tasks, 1).tasks : tasks
    expect([...visible].sort(compare)[0]).toEqual([...tasks].sort(compare)[0])
    expect(supportsSettledSummaryPaging(sort)).toBe(sort === 'priority' || sort === 'activity')
  },
)

it('matches the list fallback for legacy prompt timestamps, with deterministic ties', () => {
  const tasks = [
    {
      ...task('1'),
      lastPromptAt: undefined,
      messages: [
        {
          id: 'prompt',
          role: 'user' as const,
          text: 'Old request',
          createdAt: '2026-10-25T03:00:00Z',
        },
      ],
    },
    {
      ...task('2'),
      lastPromptAt: undefined,
      queue: [
        {
          id: 'queued',
          role: 'user' as const,
          text: 'New request',
          createdAt: '2026-10-25T04:00:00Z',
        },
      ],
    },
    { ...task('3'), lastPromptAt: '2026-10-25T04:00:00Z' },
  ]
  expect(settledSummaryPage(tasks, 1).tasks.map((task) => task.id)).toEqual(['2'])
})

it('keeps feedback, snoozes and subagent families available across page boundaries', () => {
  const tasks: Task[] = [
    { ...task('0'), waitingForFeedback: true },
    { ...task('1'), snoozedUntil: '2026-10-26T00:00:00Z' },
    {
      ...task('2'),
      subagents: [
        {
          id: 'agent',
          taskId: '3',
          provider: 'test',
          name: 'Child',
          status: 'completed',
          startedAt: '2026-10-25T00:00:00Z',
          updatedAt: '2026-10-25T00:00:00Z',
        },
      ],
    },
    task('3'),
    task('4'),
    task('5'),
  ]
  const page = settledSummaryPage(tasks, 1, [], Date.parse('2026-10-25T00:00:00Z'))
  expect(page.tasks.map((task) => task.id)).toEqual(['0', '1', '2', '3', '5'])
  expect(page.omitted).toBe(1)
  expect(
    settledSummaryPage(tasks, 1, [], Date.parse('2026-10-27T00:00:00Z')).tasks.map(
      (task) => task.id,
    ),
  ).toEqual(['0', '2', '3', '5'])
})

it('matches complete sorting for shuffled pages, ties and boundary limits', () => {
  const tasks = Array.from({ length: 257 }, (_, i) => ({
    ...task(`id-${i}`),
    createdAt: new Date(1700000000000 + ((i * 73) % 31) * 1000).toISOString(),
    lastPromptAt: undefined,
  }))
  for (const limit of [0, 1, 25, 256, 257, 500]) {
    const expected = new Set(
      [...tasks]
        .sort((a, b) => compareTasks(a, b, 'priority', new Set(), new Map()))
        .slice(0, limit)
        .map((task) => task.id),
    )
    const page = settledSummaryPage(tasks, limit)
    expect(page.tasks).toEqual(tasks.filter((task) => expected.has(task.id)))
    expect(page.omitted).toBe(Math.max(0, tasks.length - limit))
  }
})

it('keeps hidden samples, side chats and explicit thread families out of the omitted root count', () => {
  const tasks: Task[] = [
    task('0'),
    { ...task('1'), example: true },
    {
      ...task('2'),
      status: 'draft',
      sideThread: {
        parentTaskId: '0',
        contextMessageCount: 0,
        objective: '',
        parentHistoryRevision: 0,
        contextHash: '',
        source: 'head',
        permissionCeiling: { provider: 'codex', permission: 'full-access' },
      },
    },
    task('3'),
    { ...task('4'), delegation: { parentTaskId: '3', parentRunId: 'run', key: 'child' } },
    task('5'),
    { ...task('6'), spawnParent: { runtimeId: 'owner', threadId: '5' } },
    task('7'),
    task('8'),
  ]
  const page = settledSummaryPage(tasks, 1)
  expect(page.tasks.map((task) => task.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '8'])
  expect(page.omittedTasks.map((task) => task.id)).toEqual(['7'])
  expect(page.omitted).toBe(1)
})

it('keeps spawned watch targets with their parent, including replica targets', () => {
  const tasks: Task[] = [
    {
      ...task('0'),
      threadWatches: [
        {
          runtimeId: 'remote',
          threadId: 'child',
          computerName: 'Remote',
          relation: 'spawned',
          delegated: true,
          status: 'watching',
          offline: false,
        },
      ],
    },
    {
      ...task('1'),
      replica: {
        ownerRuntimeId: 'remote',
        threadId: 'child',
        ownerName: 'Remote',
        projectName: 'Project',
      },
    },
    task('2'),
    task('3'),
  ]
  expect(settledSummaryPage(tasks, 1).tasks.map((task) => task.id)).toEqual(['0', '1', '3'])
  expect(settledSummaryPage(tasks, 1).omitted).toBe(1)
})

it('counts omitted logical threads once across owners, replicas, selected rows and different page sizes', () => {
  const tasks = Array.from({ length: 40 }, (_, i) => task(`thread-${i}`))
  const copies = tasks.map((original) => ({
    ...original,
    id: `replica-${original.id}`,
    replica: {
      ownerRuntimeId: 'owner',
      threadId: original.id,
      ownerName: 'Owner',
      projectName: 'Project',
    },
  }))
  const source = (runtimeId: string, tasks: Task[], limit: number, selected: string[] = []) => {
    const page = settledSummaryPage(tasks, limit, selected)
    return {
      runtimeId,
      tasks: page.tasks,
      page: {
        omitted: page.omitted,
        threadKeys: page.omittedTasks.map((task) => settledThreadKey(task, runtimeId)),
      },
    }
  }
  for (const limit of [1, 25, 40, 50]) {
    const sources = [
      source('owner', tasks, limit),
      source('replica-host', copies, 10, ['replica-thread-0']),
      source('owner', tasks, 5),
    ]
    const loaded = new Set(
      sources.flatMap((source) =>
        source.tasks.map((task) => settledThreadKey(task, source.runtimeId)),
      ),
    )
    expect(loaded.size + omittedSettledCount(sources)).toBe(40)
  }
})

it('accepts scalar counts from older runtimes without double counting connection aliases', () => {
  expect(
    omittedSettledCount([
      { runtimeId: 'one', tasks: [], page: { omitted: 15 } },
      { runtimeId: 'one', tasks: [], page: { omitted: 15 } },
      { runtimeId: 'two', tasks: [], page: { omitted: 5 } },
    ]),
  ).toBe(20)
})

it('excludes a spawned remote child from omitted roots when its parent is on another computer', () => {
  const parent: Task = {
    ...task('parent'),
    threadWatches: [
      {
        runtimeId: 'remote',
        threadId: 'child',
        computerName: 'Remote',
        relation: 'spawned',
        delegated: true,
        status: 'watching',
        offline: false,
      },
    ],
  }
  expect(
    omittedSettledCount([
      { runtimeId: 'owner', tasks: [parent] },
      {
        runtimeId: 'remote',
        tasks: [],
        page: {
          omitted: 2,
          threadKeys: [JSON.stringify(['remote', 'child']), JSON.stringify(['remote', 'other'])],
        },
      },
    ]),
  ).toBe(1)
})

it('counts only omitted parents while retaining settled children and local parent context', () => {
  const tasks: Task[] = Array.from({ length: 12 }, (_, index) => task(String(index)))
  tasks.push(
    ...Array.from({ length: 40 }, (_, index) => ({
      ...task(`child-${index}`),
      delegation: { parentTaskId: '0', parentRunId: 'run', key: String(index) },
    })),
  )
  tasks.push({ ...task('remote-child'), spawnParent: { runtimeId: 'other', threadId: 'parent' } })
  const page = settledSummaryPage(tasks, 2)
  expect(page.omitted).toBe(9)
  expect(
    page.tasks.filter((item) => !item.delegation && !item.spawnParent).map((item) => item.id),
  ).toEqual(['0', '10', '11'])
  expect(page.tasks.filter((item) => !!item.delegation || !!item.spawnParent)).toHaveLength(41)
  expect(settledSummaryPage(tasks, 0).omitted).toBe(11)
  expect(settledSummaryPage(tasks, 100).omitted).toBe(0)
})
