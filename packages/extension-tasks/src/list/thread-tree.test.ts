import type { Task, ThreadWatchSummary } from '@dovo/protocol'
import { decode, snapshotSchema } from '@dovo/protocol'
import { createTask } from '@dovo/studio-core'
import { expect, it } from 'vite-plus/test'
import { collectTasks, taskCollectionKey, type TaskSource } from './task-collection'
import { buildThreadTree, threadDescendants } from './thread-tree'

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...createTask({ title: id, repositoryId: '', agentId: '', objective: '' }),
  id,
  ...extra,
})
const source = (runtimeId: string, tasks: Task[], online = true): TaskSource => ({
  runtimeId,
  name: runtimeId,
  online,
  snapshot: null,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    automations: [],
    tasks,
  },
})
const watch = (extra: Partial<ThreadWatchSummary> = {}): ThreadWatchSummary => ({
  runtimeId: 'server',
  threadId: 'child',
  computerName: 'Server',
  relation: 'spawned',
  status: 'watching',
  offline: false,
  snapshot: {
    title: 'Remote work',
    phase: 'running',
    revision: 'one',
    attention: [],
    watches: { pipelines: 1, pullRequests: 2, failures: 0 },
  },
  ...extra,
})
const key = taskCollectionKey

it('nests all local generations and completed children without needing working-agent records', () => {
  const entries = collectTasks([
    source('desktop', [
      task('parent'),
      task('child', {
        delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'child' },
        status: 'done',
      }),
      task('nested', { delegation: { parentTaskId: 'child', parentRunId: 'run', key: 'nested' } }),
    ]),
  ])
  const tree = buildThreadTree(entries)
  expect(tree.roots.map((entry) => entry.task.id)).toEqual(['parent'])
  expect(
    threadDescendants(tree.nodes.get(key('desktop', 'parent'))!.children).map((node) => [
      node.threadId,
      node.phase,
    ]),
  ).toEqual([
    ['child', 'completed'],
    ['nested', 'draft'],
  ])
  expect(tree.rootKeys.get(key('desktop', 'nested'))).toBe(key('desktop', 'parent'))
})

it('deduplicates a paired remote child and keeps unrelated identical IDs and linked work at the top level', () => {
  const entries = collectTasks([
    source('desktop', [
      task('parent', {
        threadWatches: [watch(), watch({ threadId: 'related', relation: 'linked' })],
      }),
    ]),
    source('server', [task('child'), task('related')]),
    source('laptop', [task('child')]),
  ])
  const tree = buildThreadTree(entries)
  expect(tree.roots.map((entry) => entry.key)).toEqual([
    key('desktop', 'parent'),
    key('server', 'related'),
    key('laptop', 'child'),
  ])
  expect(tree.nodes.get(key('desktop', 'parent'))!.children.map((node) => node.key)).toEqual([
    key('server', 'child'),
  ])
})

it('retains offline and stopped spawned work and its last known state', () => {
  const tree = buildThreadTree(
    collectTasks([
      source('desktop', [
        task('parent', {
          threadWatches: [
            watch({ status: 'stopped', offline: true, lastSuccessAt: '2026-10-19T08:00:00Z' }),
          ],
        }),
      ]),
    ]),
  )
  expect(tree.nodes.get(key('desktop', 'parent'))!.children[0]).toMatchObject({
    title: 'Remote work',
    phase: 'running',
    online: false,
    paused: true,
    lastSuccessAt: '2026-10-19T08:00:00Z',
  })
})

it('does not hide or duplicate threads when relationships contain cycles or missing parents', () => {
  const entries = collectTasks([
    source('desktop', [
      task('a', { threadWatches: [watch({ runtimeId: 'local', threadId: 'b' })] }),
      task('b', {
        threadWatches: [
          watch({ runtimeId: 'local', threadId: 'a' }),
          watch({ runtimeId: 'local', threadId: 'b' }),
        ],
      }),
      task('orphan', {
        delegation: { parentTaskId: 'missing', parentRunId: 'run', key: 'orphan' },
      }),
    ]),
  ])
  const tree = buildThreadTree(entries)
  expect(tree.roots.map((entry) => entry.task.id)).toEqual(['a', 'orphan'])
  expect(tree.nodes.get(key('desktop', 'a'))!.children.map((node) => node.threadId)).toEqual(['b'])
  expect(tree.nodes.get(key('desktop', 'b'))!.children).toEqual([])
})

it('surfaces remote input on the parent while ignoring stale or paused requests', () => {
  const inputWatch = watch({ snapshot: { ...watch().snapshot!, phase: 'needs-input' } })
  const build = (remote: ThreadWatchSummary) =>
    buildThreadTree(
      collectTasks([source('desktop', [task('parent', { threadWatches: [remote] })])]),
    )
  expect(build(inputWatch).roots[0]!.needsInput).toBe(true)
  expect(build({ ...inputWatch, offline: true }).roots[0]!.needsInput).toBe(false)
  expect(build({ ...inputWatch, paused: true }).roots[0]!.needsInput).toBe(false)
})

it('keeps unrelated tree objects stable as another thread streams', () => {
  const entries = collectTasks([
    source('desktop', [task('parent', { threadWatches: [watch()] }), task('other')]),
  ])
  const before = buildThreadTree(entries)
  const after = buildThreadTree(
    entries.map((entry) =>
      entry.task.id === 'other' ? { ...entry, task: { ...entry.task, title: 'Streaming' } } : entry,
    ),
    before.nodes,
  )
  expect(after.nodes.get(key('desktop', 'parent'))).toBe(before.nodes.get(key('desktop', 'parent')))
  expect(after.nodes.get(key('desktop', 'other'))).not.toBe(
    before.nodes.get(key('desktop', 'other')),
  )
})

it('uses a live background monitor instead of an older offline UI snapshot', () => {
  const tree = buildThreadTree(
    collectTasks([
      source('desktop', [task('parent', { threadWatches: [watch()] })]),
      source('server', [task('child', { title: 'Old title', status: 'done' })], false),
    ]),
  )
  expect(tree.nodes.get(key('desktop', 'parent'))!.children[0]).toMatchObject({
    title: 'Remote work',
    phase: 'running',
    online: true,
  })
})

it('keeps remote work discoverable after its parent is archived', () => {
  const tree = buildThreadTree(
    collectTasks([
      source('desktop', [
        task('parent', { archivedAt: '2026-10-19T09:00:00Z', threadWatches: [watch()] }),
      ]),
      source('server', [task('child', { status: 'running' })]),
    ]),
  )
  expect(tree.roots.map((entry) => entry.task.id)).toEqual(['parent', 'child'])
})

it('resolves foreign profile IDs by computer identity and uses live input without counting ancestors twice', () => {
  const server = source('my-server-profile', [
    task('child'),
    task('nested', { delegation: { parentTaskId: 'child', parentRunId: 'run', key: 'nested' } }),
  ])
  server.snapshot = decode(snapshotSchema, {
    runtimeId: 'server-identity',
    revision: 1,
    owner: false,
    workspace: server.workspace,
    approvals: [
      {
        id: 'input',
        taskId: 'nested',
        title: 'Choose',
        detail: 'Choose a path',
        createdAt: '2026-10-19T08:00:00Z',
      },
    ],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const tree = buildThreadTree(
    collectTasks([
      source('desktop', [
        task('parent', {
          threadWatches: [
            watch({
              runtimeId: 'someone-elses-server-profile',
              snapshot: { ...watch().snapshot!, runtimeId: 'server-identity' },
            }),
          ],
        }),
      ]),
      server,
    ]),
  )
  expect(tree.roots.map((entry) => entry.task.id)).toEqual(['parent'])
  expect(tree.roots[0]!.needsInput).toBe(true)
  const children = tree.nodes.get(key('desktop', 'parent'))!.children
  expect(
    threadDescendants(children)
      .filter((node) => node.phase === 'needs-input')
      .map((node) => node.threadId),
  ).toEqual(['nested'])
  expect(children[0]).toMatchObject({
    runtimeId: 'my-server-profile',
    runtimeIdentity: 'server-identity',
  })
})
