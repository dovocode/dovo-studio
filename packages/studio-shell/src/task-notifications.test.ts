import { expect, it } from 'vite-plus/test'
import {
  decode,
  runtimeProfile,
  snapshotSchema,
  pendingQuestionSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import {
  taskNotificationEvents,
  taskNotificationStates,
  type TaskState,
} from './task-notifications'

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

it('notifies in the main conversation for child approvals and waits for question escalation', () => {
  const profile = runtimeProfile(
    { address: 'http://server.lan:8787', token: 'notification-test-device-token' },
    'Server',
  )
  const task = {
    id: 'parent',
    title: 'Main conversation',
    repositoryId: '',
    agentId: '',
    status: 'running',
    createdAt: '',
    draft: '',
    files: [],
    messages: [],
    example: false,
  }
  const snapshot = decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      automations: [],
      repositories: [],
      tasks: [
        task,
        {
          ...task,
          id: 'child',
          title: 'Worker',
          delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'worker' },
        },
      ],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const runtime: RuntimeOverview = {
    profile,
    snapshot,
    connected: true,
    error: null,
    lastSeen: '',
    pulls: null,
    pullError: null,
  }
  const before = taskNotificationStates([runtime])
  snapshot.questions.push(
    decode(pendingQuestionSchema, {
      id: 'question',
      taskId: 'child',
      routing: 'parent',
      createdAt: '',
      prompt: {
        title: 'Choose',
        questions: [{ id: 'choice', header: 'Choice', question: 'Which pattern?' }],
      },
    }),
  )
  expect(taskNotificationEvents(before, taskNotificationStates([runtime]))).toEqual([])
  snapshot.questions[0]!.routing = 'human'
  const escalated = taskNotificationEvents(before, taskNotificationStates([runtime]))
  expect(escalated).toEqual([
    expect.objectContaining({
      kind: 'input',
      target: { runtimeId: profile.id, viewId: 'tasks', entityId: 'parent' },
    }),
  ])
  snapshot.questions = []
  snapshot.approvals.push({
    id: 'approval',
    taskId: 'child',
    title: 'Deploy',
    detail: '',
    createdAt: '',
  })
  expect(
    taskNotificationEvents(before, taskNotificationStates([runtime])).map(
      (event) => event.target.entityId,
    ),
  ).toEqual(['parent'])
})
