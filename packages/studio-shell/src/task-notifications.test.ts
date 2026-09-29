import { expect, it } from 'vite-plus/test'
import { taskNotificationEvents, type TaskState } from './task-notifications'

const state = (changes: Partial<TaskState> = {}): TaskState => ({
  title: 'Fix login',
  target: { runtimeId: 'computer', viewId: 'tasks', entityId: 'task' },
  running: false,
  needsInput: false,
  failed: false,
  ...changes,
})

it('notifies when a task starts waiting, finishes or fails, but never for new tasks', () => {
  const before = new Map([
    ['a', state({ running: true })],
    ['b', state({ running: true })],
    ['c', state({ running: true })],
    ['d', state()],
  ])
  const after = new Map([
    ['a', state({ running: true, needsInput: true })],
    ['b', state()],
    ['c', state({ failed: true })],
    ['d', state()],
    ['new', state({ needsInput: true })],
  ])
  expect(
    taskNotificationEvents(before, after).map((event) => `${event.key}:${event.kind}`),
  ).toEqual(['a:input', 'b:done', 'c:failed'])
  const run = (changes: Partial<TaskState> = {}) => state({ automation: true, ...changes })
  expect(
    taskNotificationEvents(
      new Map([
        ['r1', run({ running: true })],
        ['r2', run({ running: true })],
        ['r3', run({ running: true })],
      ]),
      new Map([
        ['r1', run({ running: true, needsInput: true })],
        ['r2', run()],
        ['r3', run({ cancelled: true })],
      ]),
    ).map((event) => `${event.key}:${event.kind}:${event.automation}`),
  ).toEqual(['r1:input:true', 'r2:done:true'])
  // An unchanged snapshot repeats nothing.
  expect(taskNotificationEvents(after, after)).toEqual([])
})

it('retains the destination for task and automation notifications', () => {
  const task = state({ target: { runtimeId: 'computer-a', viewId: 'tasks', entityId: 'task-1' } })
  const run = state({
    automation: true,
    target: { runtimeId: 'computer-b', viewId: 'jobs', entityId: 'run-1' },
  })
  const events = taskNotificationEvents(
    new Map([
      ['task', { ...task, running: true }],
      ['run', { ...run, running: true }],
    ]),
    new Map([
      ['task', task],
      ['run', run],
    ]),
  )
  expect(events.map((event) => event.target)).toEqual([task.target, run.target])
})
