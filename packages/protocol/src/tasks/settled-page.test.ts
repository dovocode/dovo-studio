import { expect, it } from 'vite-plus/test'
import { settledSummaryPage } from './settled-page.js'
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
  draft: '',
  example: false,
  messages: [],
  files: [],
})
it('bounds settled rows in deterministic date/id order while preserving selected, live and protected rows', () => {
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
