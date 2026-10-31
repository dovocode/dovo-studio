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
  enqueueTaskNotices,
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

function fixture() {
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
  return { runtime, snapshot, profile }
}

it('notifies in the main conversation for child approvals and waits for question escalation', () => {
  const { runtime, snapshot, profile } = fixture()
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

it('notifies separately for new approvals and questions while earlier requests still wait', () => {
  const { runtime, snapshot } = fixture()
  snapshot.approvals.push({
    id: 'approval-1',
    taskId: 'child',
    title: 'First',
    detail: '',
    createdAt: '',
  })
  const before = taskNotificationStates([runtime])
  snapshot.approvals.push({
    id: 'approval-2',
    taskId: 'parent',
    title: 'Second',
    detail: '',
    createdAt: '',
  })
  snapshot.questions.push(
    decode(pendingQuestionSchema, {
      id: 'approval-2',
      taskId: 'child',
      createdAt: '',
      prompt: {
        title: 'Question',
        questions: [{ id: 'choice', header: 'Choice', question: 'Which?' }],
      },
    }),
  )
  const current = taskNotificationStates([runtime])
  const events = taskNotificationEvents(before, current)
  expect(events).toHaveLength(2)
  expect(new Set(events.map((event) => event.key)).size).toBe(2)
  expect(events.every((event) => event.target.entityId === 'parent')).toBe(true)
  expect(taskNotificationEvents(current, current)).toEqual([])
  snapshot.approvals.shift()
  expect(taskNotificationEvents(current, taskNotificationStates([runtime]))).toEqual([])
  const disconnected = taskNotificationStates([{ ...runtime, connected: false }])
  expect(taskNotificationEvents(current, disconnected)).toEqual([])
  expect(taskNotificationEvents(disconnected, taskNotificationStates([runtime]))).toEqual([])
})

it('retains individual delegated request identities and gates unavailable watches', () => {
  const { runtime, snapshot } = fixture()
  const input = {
    id: 'request',
    runtimeId: 'remote',
    taskId: 'remote-child',
    threadTitle: 'Worker',
    title: 'Review',
    kind: 'approval' as const,
  }
  const watch = {
    runtimeId: 'paired',
    threadId: 'child',
    computerName: 'Remote',
    relation: 'spawned' as const,
    delegated: true,
    status: 'watching' as const,
    offline: false,
    paused: false,
    snapshot: {
      title: 'Worker',
      revision: '1',
      phase: 'needs-input' as const,
      attention: ['approval'],
      watches: { pipelines: 0, pullRequests: 0, failures: 0 },
      humanInputs: [input],
    },
  }
  snapshot.workspace.tasks[1]!.threadWatches = [watch]
  const before = taskNotificationStates([runtime])
  watch.snapshot.humanInputs.push({ ...input, id: 'second' })
  const current = taskNotificationStates([runtime])
  expect(taskNotificationEvents(before, current)).toEqual([
    expect.objectContaining({
      kind: 'input',
      target: expect.objectContaining({ entityId: 'parent' }),
    }),
  ])
  const parentKey = JSON.stringify([runtime.profile.id, 'parent'])
  expect(current.get(parentKey)?.inputIds).toHaveLength(2)
  for (const gate of ['offline', 'paused'] as const) {
    watch[gate] = true
    expect(taskNotificationStates([runtime]).get(parentKey)?.needsInput).toBe(false)
    watch[gate] = false
  }
})

it('queues all attention events in order, suppresses the active destination and bounds retention', () => {
  const states = (running: boolean) =>
    new Map(
      ['one', 'two', 'three'].map((id) => [
        id,
        state({
          title: id,
          running,
          target: { runtimeId: 'computer', viewId: 'tasks', entityId: id },
        }),
      ]),
    )
  const events = taskNotificationEvents(states(true), states(false))
  const queue = enqueueTaskNotices([], events, events[1]!.target)
  expect(queue.map((notice) => notice.title)).toEqual(['one · Finished', 'three · Finished'])
  const more = enqueueTaskNotices(queue, [events[1]!])
  expect(more[0]).toBe(queue[0])
  expect(more.map((notice) => notice.target.entityId)).toEqual(['one', 'three', 'two'])
  expect(
    enqueueTaskNotices(more, [], events[0]!.target).map((notice) => notice.target.entityId),
  ).toEqual(['three', 'two'])
  expect(
    enqueueTaskNotices(
      [],
      Array.from({ length: 70 }, () => events[0]!),
    ),
  ).toHaveLength(50)
})
