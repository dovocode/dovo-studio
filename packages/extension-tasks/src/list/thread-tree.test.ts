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

it('shows pending cancellation and failed outcomes without treating unwatch as cancellation', () => {
  const parent = task('parent', {
    threadWatches: [watch({ stopRequested: true, delegated: true })],
  })
  let tree = buildThreadTree(collectTasks([source('desktop', [parent])]))
  expect(tree.nodes.get(key('desktop', 'parent'))!.children[0].phase).toBe('stopping')
  const failed = watch({
    snapshot: {
      ...watch().snapshot!,
      phase: 'completed',
      status: 'failed',
      error: 'Provider failed',
    },
  })
  tree = buildThreadTree(
    collectTasks([source('desktop', [task('parent', { threadWatches: [failed] })])]),
  )
  expect(tree.nodes.get(key('desktop', 'parent'))!.children[0].phase).toBe('failed')
})

it('preserves General/project context and offline failures in summaries', async () => {
  const { threadTreeSummary } = await import('@dovo/protocol')
  const entries = collectTasks([
    source('desktop', [
      task('general', {
        threadWatches: [
          watch({
            offline: true,
            snapshot: {
              ...watch().snapshot!,
              projectName: 'Client project',
              status: 'failed',
              phase: 'completed',
            },
          }),
        ],
      }),
    ]),
  ]).map((entry) => ({ ...entry, projectName: 'General' }))
  const tree = buildThreadTree(entries)
  const root = tree.nodes.get(key('desktop', 'general'))!
  expect(root.projectName).toBe('General')
  expect(root.children[0]).toMatchObject({
    projectName: 'Client project',
    phase: 'failed',
    online: false,
  })
  expect(threadTreeSummary(root.children)).toMatchObject({
    total: 1,
    failed: 1,
    offline: 1,
    running: 0,
    attention: 0,
  })
})

it('shows a native session still working between parent turns', () => {
  const entries = collectTasks([
    source('desktop', [
      task('child', {
        status: 'done',
        subagents: [
          {
            id: 'native',
            name: 'Review',
            provider: 'codex',
            status: 'working',
            sessionLive: true,
            startedAt: '',
            updatedAt: '',
          },
        ],
      }),
    ]),
  ])
  expect(buildThreadTree(entries).nodes.get(key('desktop', 'child'))?.phase).toBe('running')
})

it('keeps local agent rows and finds remote children under their immediate owner', async () => {
  const { unlistedThreadBranches, visibleThreadChildren } = await import('@dovo/protocol')
  const entries = collectTasks([
    source('desktop', [
      task('parent'),
      task('child', {
        delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'child' },
        threadWatches: [watch()],
      }),
    ]),
  ])
  const root = buildThreadTree(entries).nodes.get(key('desktop', 'parent'))!
  const branches = unlistedThreadBranches(root, new Set(entries.map((entry) => entry.key)))
  expect(branches.map((branch) => branch.threadId)).toEqual(['child'])
  expect(branches[0]?.children.map((child) => child.threadId)).toEqual(['child'])
  const completed = { ...root, phase: 'completed' as const }
  expect(visibleThreadChildren([completed], true)).toHaveLength(1) // live descendant remains reachable
  expect(visibleThreadChildren([{ ...completed, children: [] }], true)).toEqual([])
})

it('includes targeted same-computer children even without native/Dovo agent records', async () => {
  const { unlistedThreadBranches } = await import('@dovo/protocol')
  const entries = collectTasks([
    source('desktop', [
      task('parent', {
        threadWatches: [watch({ runtimeId: 'local', threadId: 'targeted' })],
      }),
      task('targeted'),
    ]),
  ])
  const tree = buildThreadTree(entries)
  expect(tree.roots.map((entry) => entry.task.id)).toEqual(['parent'])
  const branches = unlistedThreadBranches(
    tree.nodes.get(key('desktop', 'parent'))!,
    new Set([key('desktop', 'parent')]),
  )
  expect(branches[0]?.children[0]).toMatchObject({ runtimeId: 'desktop', threadId: 'targeted' })
})

it('does not hide failed or stopped outcomes behind a saved feedback flag', () => {
  const entries = collectTasks([
    source('desktop', [
      task('failed', { status: 'failed', waitingForFeedback: true }),
      task('stopped', { status: 'cancelled', waitingForFeedback: true }),
    ]),
  ])
  const tree = buildThreadTree(entries)
  expect(tree.nodes.get(key('desktop', 'failed'))?.phase).toBe('failed')
  expect(tree.nodes.get(key('desktop', 'stopped'))?.phase).toBe('stopped')
})

it('promotes matching project/computer children when their parent is outside the scope', () => {
  const entries = collectTasks([
    source('desktop', [task('parent', { repositoryId: 'general', threadWatches: [watch()] })]),
    source('server', [
      task('child', { repositoryId: 'project' }),
      task('nested', {
        repositoryId: 'project',
        delegation: { parentTaskId: 'child', parentRunId: 'run', key: 'nested' },
      }),
    ]),
  ])
  for (const include of [
    (entry: (typeof entries)[number]) => entry.task.repositoryId === 'project',
    (entry: (typeof entries)[number]) => entry.source.runtimeId === 'server',
  ]) {
    const tree = buildThreadTree(entries, undefined, include)
    expect(tree.roots.filter(include).map((entry) => entry.task.id)).toEqual(['child'])
    expect(tree.nodes.get(key('server', 'child'))?.children.map((child) => child.threadId)).toEqual(
      ['nested'],
    )
  }
})

it('reconstructs bounded remote descendants while rejecting disconnected and cyclic facts', async () => {
  const { threadTreeSummary } = await import('@dovo/protocol')
  const fact = (id: string, parent: string, extra = {}) => ({
    runtimeId: 'server-id',
    threadId: id,
    title: id,
    parent: { runtimeId: 'server-id', threadId: parent },
    phase: 'completed' as const,
    revision: id,
    attention: [],
    watches: { pipelines: 0, pullRequests: 0, failures: 0 },
    ...extra,
  })
  const remote = watch({
    snapshot: {
      ...watch().snapshot!,
      runtimeId: 'server-id',
      status: 'failed',
      threads: [
        fact('grandchild', 'child', { phase: 'needs-input', attention: ['question'] }),
        fact('child', 'parent', { status: 'failed' }),
        fact('orphan', 'missing'),
        fact('cycle-a', 'cycle-b'),
        fact('cycle-b', 'cycle-a'),
      ],
    },
  })
  const entries = collectTasks([source('desktop', [task('parent', { threadWatches: [remote] })])])
  const tree = buildThreadTree(entries)
  const child = tree.nodes.get(key('server-id', 'child'))!
  expect(child.phase).toBe('failed')
  expect(child.children.map((node) => node.threadId)).toEqual(['grandchild'])
  expect(tree.roots[0].needsInput).toBe(true)
  expect(threadTreeSummary([child])).toMatchObject({ total: 2, failed: 1, attention: 1 })
  expect(
    [...tree.nodes.values()].some(
      (node) => node.threadId === 'orphan' || node.threadId === 'cycle-a',
    ),
  ).toBe(false)
  const stopped = buildThreadTree(
    collectTasks([
      source('desktop', [task('parent', { threadWatches: [{ ...remote, status: 'stopped' }] })]),
    ]),
  )
  expect(stopped.roots[0].needsInput).toBe(false)
  expect(threadTreeSummary(stopped.nodes.get(key('desktop', 'parent'))!.children).attention).toBe(0)
  expect(stopped.nodes.get(key('server-id', 'grandchild'))?.paused).toBe(true)
})

it('retains stopped monitor state even while the peer has a live snapshot', () => {
  const server = source('server', [task('child')])
  server.snapshot = decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: server.workspace,
    questions: [],
    approvals: [{ id: 'q', taskId: 'child', title: 'Choose', detail: '', createdAt: '' }],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const tree = buildThreadTree(
    collectTasks([
      source('desktop', [task('parent', { threadWatches: [watch({ status: 'stopped' })] })]),
      server,
    ]),
  )
  expect(tree.nodes.get(key('server', 'child'))).toMatchObject({ paused: true, needsInput: true })
  expect(tree.roots[0].needsInput).toBe(false)
})

it('keeps failed branches until acknowledgement and reveals a new failed attempt', async () => {
  const { visibleThreadChildren, threadTreeSummary } = await import('@dovo/protocol')
  const build = (runAttempt: number) =>
    buildThreadTree(
      collectTasks([
        source('desktop', [
          task('parent'),
          task('child', {
            delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'child' },
            status: 'failed',
            runAttempt: { runId: String(runAttempt), inputMessageIds: [], promptAccepted: true },
            error: 'Provider failed',
          }),
        ]),
      ]),
    ).nodes.get(key('desktop', 'parent'))!.children
  const before = build(1),
    acknowledged = [before[0].failureKey!]
  expect(visibleThreadChildren(before, true)).toHaveLength(1)
  expect(visibleThreadChildren(before, true, acknowledged)).toEqual([])
  expect(threadTreeSummary(before, acknowledged).failed).toBe(0)
  expect(visibleThreadChildren(build(2), true, acknowledged)).toHaveLength(1)
  expect(visibleThreadChildren(before, false, acknowledged)).toHaveLength(1)
})

it('updates and deduplicates an offline cached grandchild from its live background snapshot', () => {
  const server = source(
    'profile',
    [
      task('child'),
      task('grandchild', {
        status: 'done',
        delegation: { parentTaskId: 'child', parentRunId: 'run', key: 'grandchild' },
      }),
    ],
    false,
  )
  server.snapshot = decode(snapshotSchema, {
    runtimeId: 'server-id',
    revision: 1,
    owner: false,
    workspace: server.workspace,
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const remote = watch({
    snapshot: {
      ...watch().snapshot!,
      runtimeId: 'server-id',
      threads: [
        {
          runtimeId: 'server-id',
          threadId: 'grandchild',
          title: 'Fresh question',
          parent: { runtimeId: 'server-id', threadId: 'child' },
          phase: 'needs-input',
          revision: 'fresh',
          attention: ['question'],
          watches: { pipelines: 0, pullRequests: 0, failures: 0 },
        },
      ],
    },
  })
  const tree = buildThreadTree(
    collectTasks([source('desktop', [task('parent', { threadWatches: [remote] })]), server]),
  )
  const children = tree.nodes.get(key('desktop', 'parent'))!.children
  expect(threadDescendants(children).map((child) => child.threadId)).toEqual([
    'child',
    'grandchild',
  ])
  expect(children[0].children[0]).toMatchObject({
    title: 'Fresh question',
    online: true,
    needsInput: true,
  })
})

it('keeps an out-of-scope parent as context for background children on an empty paired computer', () => {
  const remote = watch({
    snapshot: {
      ...watch().snapshot!,
      runtimeId: 'server-identity',
      repositoryId: 'other-repo',
      projectIdentity: 'git.example/project',
      projectKind: 'project',
    },
  })
  const entries = collectTasks([source('desktop', [task('parent', { threadWatches: [remote] })])])
  const options = {
    runtimeIds: new Map([['server-identity', 'empty-profile']]),
    includeSnapshot: (child: { runtimeId: string | null; repositoryId?: string }) =>
      child.runtimeId === 'empty-profile' && child.repositoryId === 'other-repo',
  }
  const tree = buildThreadTree(
    entries,
    undefined,
    (entry) => entry.source.runtimeId === 'empty-profile',
    options,
  )
  expect([...tree.contextKeys]).toEqual([key('desktop', 'parent')])
  expect(tree.nodes.get(key('empty-profile', 'child'))).toMatchObject({
    repositoryId: 'other-repo',
    projectIdentity: 'git.example/project',
    runtimeIdentity: 'server-identity',
  })
  expect(
    buildThreadTree(entries, undefined, () => false, { ...options, includeSnapshot: () => false })
      .contextKeys.size,
  ).toBe(0)
  expect(
    buildThreadTree(
      collectTasks([
        source('desktop', [task('parent', { archivedAt: 'now', threadWatches: [remote] })]),
      ]),
      undefined,
      () => false,
      options,
    ).contextKeys.size,
  ).toBe(0)
})

it('hides a successful review child consistently with and without a live peer', async () => {
  const { visibleThreadChildren } = await import('@dovo/protocol')
  const parent = source('desktop', [
    task('parent', {
      threadWatches: [
        watch({ snapshot: { ...watch().snapshot!, status: 'review', phase: 'completed' } }),
      ],
    }),
  ])
  for (const sources of [
    [parent],
    [parent, source('server', [task('child', { status: 'review' })])],
  ]) {
    const tree = buildThreadTree(collectTasks(sources))
    const children = tree.nodes.get(key('desktop', 'parent'))!.children
    expect(children).toHaveLength(1)
    expect(visibleThreadChildren(children, true)).toEqual([])
    expect(visibleThreadChildren(children, false)).toHaveLength(1)
  }
})

it('keeps remote native failures visible until acknowledged, including when the owner succeeds', async () => {
  const { visibleThreadChildren, threadTreeSummary } = await import('@dovo/protocol')
  const agent = {
    key: 'a'.repeat(64),
    name: 'Native worker',
    status: 'failed' as const,
    working: false,
  }
  const remote = watch({
    snapshot: { ...watch().snapshot!, phase: 'completed', status: 'review', nativeAgents: [agent] },
  })
  const tree = buildThreadTree(
    collectTasks([source('desktop', [task('parent', { threadWatches: [remote] })])]),
  )
  const children = tree.nodes.get(key('desktop', 'parent'))!.children
  expect(threadTreeSummary(children).failed).toBe(1)
  expect(visibleThreadChildren(children, true)).toHaveLength(1)
  expect(visibleThreadChildren(children, true, [agent.key])).toEqual([])
  expect(threadTreeSummary(children, [agent.key]).failed).toBe(0)
  children[0].nativeAgents = [{ ...agent, key: 'b'.repeat(64) }]
  expect(visibleThreadChildren(children, true, [agent.key])).toHaveLength(1)
  children[0].nativeAgents = [{ ...agent, status: 'working', working: true }]
  expect(visibleThreadChildren(children, true, [agent.key])).toHaveLength(1)
})

it('uses canonical identities and immediate-owner facts regardless of source order or local profile IDs', () => {
  const counts = { pipelines: 0, pullRequests: 0, failures: 0 }
  const ancestor = source('laptop', [
    task('a', {
      threadWatches: [
        watch({
          runtimeId: 'host-local-b',
          threadId: 'b',
          lastSuccessAt: '2026-10-19T12:00:00Z',
          snapshot: {
            runtimeId: 'B',
            title: 'B',
            phase: 'completed',
            revision: 'b',
            attention: [],
            watches: counts,
            threads: [
              {
                runtimeId: 'C',
                threadId: 'c',
                title: 'Old C',
                parent: { runtimeId: 'B', threadId: 'b' },
                phase: 'completed',
                status: 'review',
                revision: 'old',
                attention: [],
                watches: counts,
              },
            ],
          },
        }),
      ],
    }),
  ])
  const owner = source('server-profile', [
    task('b', {
      threadWatches: [
        watch({
          runtimeId: 'server-local-c-profile',
          threadId: 'c',
          lastSuccessAt: '2026-10-19T11:00:00Z',
          snapshot: {
            runtimeId: 'C',
            title: 'Fresh C',
            phase: 'needs-input',
            revision: 'fresh',
            attention: ['q'],
            watches: counts,
          },
        }),
      ],
    }),
  ])
  const entries = collectTasks([ancestor, owner]).map((entry) => ({
    ...entry,
    source: {
      ...entry.source,
      snapshot: {
        runtimeId: entry.source.runtimeId === 'laptop' ? 'A' : 'B',
        questions: [],
        approvals: [],
      },
    },
  }))
  for (const items of [entries, [...entries].reverse()]) {
    for (const alias of ['paired-c', null, undefined]) {
      const tree = buildThreadTree(items, undefined, undefined, {
        runtimeIds: alias === undefined ? undefined : new Map([['C', alias]]),
      })
      const children = [...tree.nodes.values()].filter((node) => node.threadId === 'c')
      expect(children).toHaveLength(1)
      expect(children[0]).toMatchObject({
        runtimeId: alias === undefined ? 'C' : alias,
        title: 'Fresh C',
        phase: 'needs-input',
        needsInput: true,
      })
      expect(tree.nodes.get(key('server-profile', 'b'))?.children).toHaveLength(1)
    }
  }
})

it('uses the freshest equal-authority snapshot but keeps live workspace state authoritative', () => {
  const make = (title: string, lastSuccessAt: string) =>
    source(title, [
      task(title, {
        threadWatches: [
          watch({
            lastSuccessAt,
            snapshot: { ...watch().snapshot!, runtimeId: 'C', title },
          }),
        ],
      }),
    ])
  const entries = collectTasks([make('old', '2026-10-18'), make('new', '2026-10-19')])
  for (const items of [entries, [...entries].reverse()])
    expect(buildThreadTree(items).nodes.get(key('C', 'child'))?.title).toBe('new')
  const live = collectTasks([source('local-c', [task('child', { title: 'Live owner' })])]).map(
    (entry) => ({
      ...entry,
      source: { ...entry.source, snapshot: { runtimeId: 'C', questions: [], approvals: [] } },
    }),
  )
  expect(buildThreadTree([...entries, ...live]).nodes.get(key('local-c', 'child'))?.title).toBe(
    'Live owner',
  )
})

it('retains overflow failures after all detailed agents are acknowledged and clears only the acknowledged group', async () => {
  const {
    threadNativeAgents,
    threadNativeAgentOverflow,
    visibleThreadChildren,
    threadTreeSummary,
  } = await import('@dovo/protocol')
  const task = {
    id: 'owner',
    subagents: Array.from({ length: 41 }, (_, i) => ({
      id: String(i),
      name: String(i),
      provider: 'codex' as const,
      status: 'failed' as const,
      startedAt: 'start',
      updatedAt: 'end',
      finishedAt: 'end',
    })),
  }
  const nativeAgents = threadNativeAgents(task),
    nativeAgentOverflow = threadNativeAgentOverflow(task)
  const remote = watch({
    status: 'completed',
    snapshot: {
      ...watch().snapshot!,
      phase: 'completed',
      status: 'review',
      nativeAgents,
      nativeAgentOverflow,
    },
  })
  const children = buildThreadTree(collectTasks([source('desktop', [taskFactory()])])).nodes.get(
    key('desktop', 'parent'),
  )!.children
  function taskFactory() {
    return {
      ...createTask({ title: 'parent', repositoryId: '', agentId: '', objective: '' }),
      id: 'parent',
      threadWatches: [remote],
    }
  }
  const acknowledged = nativeAgents.map((agent) => agent.key)
  expect(visibleThreadChildren(children, true, acknowledged)).toHaveLength(1)
  expect(threadTreeSummary(children, acknowledged).failed).toBe(1)
  expect(children[0].paused).toBe(false)
  acknowledged.push(nativeAgentOverflow!.failureKey!)
  expect(visibleThreadChildren(children, true, acknowledged)).toEqual([])
  expect(threadTreeSummary(children, acknowledged).failed).toBe(0)
  task.subagents[40].finishedAt = 'new attempt'
  children[0].nativeAgentOverflow = threadNativeAgentOverflow(task)
  expect(visibleThreadChildren(children, true, acknowledged)).toHaveLength(1)
})

it('keeps a finished parent with active native workers Working', () => {
  const entries = collectTasks([
    source('desktop', [
      task('parent', {
        status: 'review',
        waitingForFeedback: true,
        subagents: [
          {
            id: 'native',
            name: 'Worker',
            provider: 'codex',
            status: 'working',
            sessionLive: true,
            startedAt: '',
            updatedAt: '',
          },
        ],
      }),
    ]),
  ])
  expect(buildThreadTree(entries).nodes.get(key('desktop', 'parent'))?.phase).toBe('running')
})

it('presents native providers and Studio children as the same rows without changing task ownership', async () => {
  const {
    threadChildRows,
    threadTreeSummary,
    visibleThreadChildren,
    nativeAgentKey,
    nativeFailureKey,
  } = await import('@dovo/protocol')
  const claude = {
    id: 'worker',
    provider: 'claude',
    name: 'Claude review',
    status: 'working' as const,
    sessionLive: true,
    sessionId: 'claude-session',
    startedAt: '2026-10-27T12:00:00Z',
    updatedAt: '',
  }
  const codex = {
    ...claude,
    provider: 'codex',
    name: 'Codex review',
    status: 'failed' as const,
    finishedAt: '2026-10-27T12:01:00Z',
  }
  const tree = buildThreadTree(
    collectTasks([
      source('desktop', [
        task('parent', { subagents: [claude] }),
        task('child', {
          delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'child' },
          subagents: [codex],
          status: 'done',
        }),
      ]),
    ]),
  )
  const parent = tree.nodes.get(key('desktop', 'parent'))!
  const rows = threadChildRows(parent)
  const many = task('many', {
    subagents: Array.from({ length: 45 }, (_, index) => ({ ...claude, id: String(index) })),
  })
  const manyTree = buildThreadTree(collectTasks([source('desktop', [many])]))
  expect(threadChildRows(manyTree.nodes.get(key('desktop', 'many'))!)).toHaveLength(45)
  const timestampTree = buildThreadTree(
    collectTasks([
      source('desktop', [
        task('timestamp', { subagents: [{ ...claude, finishedAt: 'finished' }] }),
      ]),
    ]),
  )
  const timestampRows = threadChildRows(timestampTree.nodes.get(key('desktop', 'timestamp'))!)
  expect(timestampRows[0]).toMatchObject({ phase: 'completed', activity: 'Finished' })
  expect(visibleThreadChildren(timestampRows, true)).toEqual([])
  expect(parent.children).toHaveLength(1)
  expect(tree.nodes.size).toBe(2)
  expect(rows.map((row) => row.title)).toEqual(['child', 'Claude review'])
  expect(rows[1]).toMatchObject({
    runtimeId: 'desktop',
    threadId: 'parent',
    nativeAgentKey: nativeAgentKey('parent', claude),
    computerName: 'desktop',
    phase: 'running',
    online: true,
  })
  const nativeChild = rows[0]!.children[0]!
  expect(nativeChild).toMatchObject({
    threadId: 'child',
    nativeAgentKey: nativeAgentKey('child', codex),
    phase: 'failed',
    failureKey: nativeFailureKey('child', codex),
  })
  expect(threadTreeSummary(rows)).toMatchObject({ total: 3, running: 1, failed: 1 })
  expect(visibleThreadChildren(rows, true)).toHaveLength(2)
  expect(
    visibleThreadChildren(rows, true, [nativeChild.failureKey!]).map((row) => row.title),
  ).toEqual(['Claude review'])
  expect(nativeAgentKey('parent', claude)).toBe(
    nativeAgentKey('parent', { ...claude, status: 'completed', finishedAt: 'later' }),
  )
  expect(nativeAgentKey('parent', claude)).not.toBe(nativeAgentKey('child', claude))
  expect(nativeAgentKey('parent', claude)).not.toBe(
    nativeAgentKey('parent', { ...claude, sessionId: 'other' }),
  )
  expect(threadChildRows({ ...parent, online: false })[1]).toMatchObject({ online: false })
})
