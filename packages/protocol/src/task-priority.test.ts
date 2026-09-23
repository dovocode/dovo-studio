import { decode } from './schema.js'
import { describe, expect, it } from 'vitest'
import { compareTasks, taskSortOptions } from './task-priority'
import { taskSchema } from './workspace'
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
      'Alpha',
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
