import { expect, it } from 'vite-plus/test'
import {
  decode,
  runtimeProfile,
  snapshotSchema,
  taskSchema,
  type RuntimeOverview,
  type RuntimeTask,
  type Subagent,
} from '@dovo/protocol'
import { taskListProjection } from './task-list-projection'

it('retains mobile pill data across native agent payload updates but refreshes visible activity', () => {
  const source = overview()
  const snapshot = source.snapshot!
  const native: Subagent = {
    id: 'native',
    provider: 'codex',
    name: 'Native agent',
    status: 'working' as const,
    sessionLive: true,
    startedAt: '',
    updatedAt: '',
    activity: 'Reading',
  }
  const publish = (record: Subagent) => ({
    ...source,
    snapshot: {
      ...snapshot,
      workspace: {
        ...snapshot.workspace,
        tasks: snapshot.workspace.tasks.map((task) =>
          task.id === 'running' ? { ...task, subagents: [record] } : task,
        ),
      },
    },
  })
  const key = JSON.stringify([source.profile.id, 'running'])
  const initial = taskListProjection([publish(native)], now)
  const payload = { ...native, updatedAt: 'later', result: 'large result'.repeat(10000) }
  const next = taskListProjection([publish(payload)], now, initial)
  expect(next.get(key)?.subagents).toBe(initial.get(key)?.subagents)
  expect(next.get(key)?.subagents[0]).not.toHaveProperty('result')
  const visible = taskListProjection([publish({ ...payload, activity: 'Testing' })], now, next)
  expect(visible.get(key)?.subagents).not.toBe(next.get(key)?.subagents)
  expect(visible.get(key)?.subagents[0]?.activity).toBe('Testing')
  const finished = taskListProjection([publish({ ...native, status: 'completed' })], now, visible)
  expect(finished.get(key)?.subagents).toEqual([])
})

const task = (id: string) =>
  decode(taskSchema, {
    id,
    title: id,
    repositoryId: 'repo',
    agentId: '',
    status: 'running',
    createdAt: '2026-10-13T12:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
function overview(): RuntimeOverview {
  return {
    profile: runtimeProfile(
      { address: 'http://owner.lan:8787', token: 'owner-private-token-at-least-32-characters' },
      'Owner',
    ),
    connected: true,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
    snapshot: decode(snapshotSchema, {
      revision: 1,
      owner: false,
      workspace: {
        version: 1,
        runtimeAddress: '',
        repositories: [{ id: 'repo', name: 'Project', path: '/project', branch: 'main' }],
        agents: [],
        automations: [],
        tasks: [task('running'), task('untouched')],
      },
      questions: [],
      approvals: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
      acpInstallations: [],
    }),
  }
}
const now = Date.parse('2026-10-13T12:00:01Z')
it('projects Undo capability per computer and updates it when a runtime changes', () => {
  const legacy = overview()
  const modern = {
    ...legacy,
    profile: runtimeProfile(
      { address: 'http://modern.lan:8787', token: 'modern-private-token-at-least-32-characters' },
      'Modern',
    ),
    snapshot: { ...legacy.snapshot!, taskListUndoSupported: true as const },
  }
  const key = (source: RuntimeOverview) => JSON.stringify([source.profile.id, 'untouched'])
  const first = taskListProjection([legacy, modern], now)
  expect(first.get(key(legacy))?.owner.taskListUndoSupported).toBe(false)
  expect(first.get(key(modern))?.owner.taskListUndoSupported).toBe(true)
  const changed = taskListProjection(
    [
      { ...legacy, snapshot: { ...legacy.snapshot!, taskListUndoSupported: true } },
      { ...modern, snapshot: legacy.snapshot },
    ],
    now,
    first,
  )
  expect(changed.get(key(legacy))?.owner.taskListUndoSupported).toBe(true)
  expect(changed.get(key(modern))?.owner.taskListUndoSupported).toBe(false)
  expect(changed.get(key(legacy))?.owner).not.toBe(first.get(key(legacy))?.owner)
})
it('retains unrelated rows and owner facts across streamed snapshots', () => {
  const source = overview()
  const initial = taskListProjection([source], now)
  const snapshot = source.snapshot!
  const next = taskListProjection(
    [
      {
        ...source,
        snapshot: {
          ...snapshot,
          revision: 2,
          acpInstallations: [],
          workspace: {
            ...snapshot.workspace,
            tasks: snapshot.workspace.tasks.map((task) =>
              task.id === 'running'
                ? { ...task, messages: [{ id: 'reply', role: 'assistant', text: 'chunk' }] }
                : task,
            ),
          },
        },
      },
    ],
    now,
    initial,
  )
  const key = (id: string) => JSON.stringify([source.profile.id, id])
  expect(next.get(key('untouched'))).toBe(initial.get(key('untouched')))
  expect(next.get(key('running'))?.row.task.messages[0].text).toBe('chunk')
  expect(next.get(key('running'))?.owner).toBe(initial.get(key('running'))?.owner)
})

it('updates owner metadata, input state and child pills without retaining removed tasks', () => {
  const source = overview(),
    snapshot = source.snapshot!
  const child = {
    ...task('child'),
    delegation: { parentTaskId: 'untouched', parentRunId: 'run', key: 'child' },
  }
  const record = {
    id: 'child',
    taskId: 'child',
    source: 'dovo' as const,
    name: 'Child',
    provider: 'codex' as const,
    status: 'working' as const,
    startedAt: '',
    updatedAt: '',
  }
  const tasks = snapshot.workspace.tasks.map((task) =>
    task.id === 'untouched' ? { ...task, subagents: [record] } : task,
  )
  const withChild = {
    ...source,
    snapshot: { ...snapshot, workspace: { ...snapshot.workspace, tasks: [...tasks, child] } },
  }
  const initial = taskListProjection([withChild], now)
  const next = taskListProjection(
    [
      {
        ...withChild,
        snapshot: {
          ...withChild.snapshot,
          approvals: [
            { id: 'approval', taskId: 'child', title: 'Allow', detail: '', createdAt: '' },
          ],
          workspace: {
            ...snapshot.workspace,
            repositories: [{ ...snapshot.workspace.repositories[0], branch: 'changed' }],
            tasks: [...tasks, child],
          },
        },
      },
    ],
    now,
    initial,
  )
  const key = JSON.stringify([source.profile.id, 'untouched'])
  expect(next.get(key)?.row.needsInput).toBe(true)
  expect(next.get(key)?.owner.repository?.branch).toBe('changed')
  expect(next.get(key)?.subagents).toBe(initial.get(key)?.subagents)
  const removed = taskListProjection([source], now, next)
  expect(removed.has(JSON.stringify([source.profile.id, 'child']))).toBe(false)
  expect(removed.get(key)?.subagents).toEqual([])
})

it('projects General parents, remote children and orphaned local children into the shared tree', async () => {
  const { mobileThreadTree } = await import('./task-list-projection')
  const source = overview()
  const snapshot = source.snapshot!
  const parent = {
    ...task('general'),
    repositoryId: 'general',
    threadWatches: [
      {
        runtimeId: 'server',
        threadId: 'remote',
        computerName: 'Server',
        relation: 'spawned' as const,
        status: 'watching' as const,
        offline: false,
        snapshot: {
          title: 'Remote project child',
          projectName: 'Project',
          phase: 'needs-input' as const,
          revision: 'one',
          attention: ['question'],
          watches: { pipelines: 0, pullRequests: 0, failures: 0 },
        },
      },
    ],
  }
  const child = {
    ...task('orphan'),
    delegation: { parentTaskId: 'missing', parentRunId: 'run', key: 'orphan' },
  }
  const next = {
    ...source,
    snapshot: {
      ...snapshot,
      workspace: {
        ...snapshot.workspace,
        repositories: [
          ...snapshot.workspace.repositories,
          {
            id: 'general',
            name: 'Hidden scratch name',
            kind: 'scratch' as const,
            path: '/general',
            branch: 'main',
          },
        ],
        tasks: [parent, child],
      },
    },
  }
  const rows = taskListProjection([next], now)
  const tree = mobileThreadTree(rows, [next])
  expect(tree.roots.map((entry) => entry.task.id)).toEqual(['general', 'orphan'])
  const root = tree.roots.find((entry) => entry.task.id === 'general')!
  expect(root.needsInput).toBe(true)
  expect(root.projectName).toBe('No Project')
  expect(tree.nodes.get(root.key)?.children[0]).toMatchObject({
    title: 'Remote project child',
    projectName: 'Project',
    phase: 'needs-input',
  })
  expect(rows.get(root.key)?.subagents).toEqual([])
})

it('keeps a child as a visible root when the selected project or computer excludes its coordinator', async () => {
  const { mobileThreadTree } = await import('./task-list-projection')
  const parent = overview(),
    child = overview()
  parent.profile = { ...parent.profile, id: 'parent-computer' }
  child.profile = { ...child.profile, id: 'child-computer' }
  const parentTask = {
    ...task('parent'),
    repositoryId: 'general',
    threadWatches: [
      {
        runtimeId: 'child-computer',
        threadId: 'child',
        computerName: 'Child computer',
        relation: 'spawned' as const,
        status: 'watching' as const,
        offline: false,
      },
    ],
  }
  const childTask = task('child')
  parent.snapshot = {
    ...parent.snapshot!,
    workspace: { ...parent.snapshot!.workspace, tasks: [parentTask] },
  }
  child.snapshot = {
    ...child.snapshot!,
    workspace: { ...child.snapshot!.workspace, tasks: [childTask] },
  }
  const overviews = [parent, child],
    rows = taskListProjection(overviews, now)
  for (const include of [
    (row: RuntimeTask) => row.runtimeId === 'child-computer',
    (row: { task: { repositoryId: string } }) => row.task.repositoryId === 'repo',
  ]) {
    const tree = mobileThreadTree(rows, overviews, undefined, include)
    expect(tree.roots.filter(include).map((row) => row.task.id)).toEqual(['child'])
  }
})

it('resolves background-only children to empty saved profiles and retains scoped parent context', async () => {
  const { mobileThreadTree } = await import('./task-list-projection')
  const parent = overview()
  const peer = {
    ...overview(),
    profile: runtimeProfile(
      {
        address: 'http://server.lan:8787',
        token: 'peer-private-token-at-least-32-characters',
        runtimeId: 'peer-identity',
      },
      'Server',
    ),
    snapshot: null,
  }
  const workspace = parent.snapshot!.workspace
  workspace.tasks = [
    {
      ...task('parent'),
      threadWatches: [
        {
          runtimeId: 'foreign-profile',
          threadId: 'remote',
          computerName: 'Server',
          relation: 'spawned',
          status: 'watching',
          offline: false,
          snapshot: {
            runtimeId: 'peer-identity',
            title: 'Remote',
            repositoryId: 'remote-repo',
            phase: 'running',
            revision: '1',
            attention: [],
            watches: { pipelines: 0, pullRequests: 0, failures: 0 },
          },
        },
      ],
    },
  ]
  const rows = taskListProjection([parent, peer], now)
  const tree = mobileThreadTree(
    rows,
    [parent, peer],
    undefined,
    (row) => row.runtimeId === peer.profile.id,
    (child) => child.runtimeId === peer.profile.id && child.repositoryId === 'remote-repo',
  )
  expect([...tree.contextKeys]).toEqual([JSON.stringify([parent.profile.id, 'parent'])])
  expect(tree.nodes.get(JSON.stringify([peer.profile.id, 'remote']))).toMatchObject({
    runtimeIdentity: 'peer-identity',
    repositoryId: 'remote-repo',
  })
})
