import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  clearRuntimeRequestCache,
  runtimeProfile,
  runtimeRequest,
  snapshotSchema,
  type RuntimeOverview,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { retainOverviewSnapshot, shouldPublishOverview } from './overview-state'
const profile = runtimeProfile({
  address: 'http://computer.local:51464',
  token: 'test-device-credential-123',
})
const time = (seconds: number) => new Date(Date.UTC(2026, 8, 19, 10, 0, seconds)).toISOString()
const snapshot = decode(snapshotSchema, {
  revision: 1,
  owner: false,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    automations: [],
    tasks: [],
    repositories: [],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
})
async function readSnapshot(value: RuntimeSnapshot = snapshot, tag = 'W/"snapshot-one"') {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(value, {
        headers: tag
          ? {
              ETag: tag,
            }
          : {},
      }),
    ),
  )
  return runtimeRequest(
    profile.connection,
    profile.connection.address,
    '/api/snapshot',
    undefined,
    snapshotSchema,
    'GET',
  )
}
const overview = (value: RuntimeSnapshot): RuntimeOverview => ({
  profile,
  snapshot: value,
  connected: true,
  lastSeen: time(0),
  error: null,
  pulls: {
    total: 3,
    needsAttention: 1,
    reviewRequested: 1,
    partial: false,
  },
  pullError: null,
})
afterEach(() => {
  clearRuntimeRequestCache()
  vi.unstubAllGlobals()
})
it('retains the snapshot across conditional reads and publishes idle freshness every 30 seconds', async () => {
  const published = overview(await readSnapshot())
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(null, {
          status: 304,
        }),
    ),
  )
  let latest = published
  for (let seconds = 1; seconds <= 30; seconds++) {
    const received = await runtimeRequest(
      profile.connection,
      profile.connection.address,
      '/api/snapshot',
      undefined,
      snapshotSchema,
      'GET',
    )
    expect(received).not.toBe(published.snapshot)
    latest = retainOverviewSnapshot(latest, {
      ...latest,
      snapshot: received,
      lastSeen: time(seconds),
    })
    expect(latest.snapshot).toBe(published.snapshot)
    expect(shouldPublishOverview(published, latest)).toBe(seconds === 30)
  }
  expect(latest.lastSeen).toBe(time(30))
})
it('shows an outage immediately with the actual latest contact, and restores the same snapshot immediately', async () => {
  const published = overview(await readSnapshot())
  const latest = retainOverviewSnapshot(published, {
    ...published,
    snapshot: await readSnapshot(),
    lastSeen: time(9),
  })
  expect(shouldPublishOverview(published, latest)).toBe(false)
  const offline = {
    ...latest,
    connected: false,
    error: 'Cannot reach this computer',
  }
  expect(shouldPublishOverview(published, offline)).toBe(true)
  expect(offline.lastSeen).toBe(time(9))
  expect(
    shouldPublishOverview(offline, {
      ...offline,
    }),
  ).toBe(false)
  expect(
    shouldPublishOverview(offline, {
      ...offline,
      error: 'Device revoked',
    }),
  ).toBe(true)
  expect(
    shouldPublishOverview(offline, {
      ...latest,
      lastSeen: time(10),
    }),
  ).toBe(true)
})
it('does not hide device, approval or question changes when the workspace revision is unchanged', async () => {
  const previous = overview(await readSnapshot())
  const changes = [
    decode(snapshotSchema, {
      ...snapshot,
      devices: [
        {
          id: 'phone',
          name: 'Phone',
          createdAt: time(1),
          revokedAt: null,
        },
      ],
    }),
    decode(snapshotSchema, {
      ...snapshot,
      approvals: [
        {
          id: 'approval',
          taskId: 'task',
          title: 'Edit',
          detail: 'Apply change',
          createdAt: time(1),
        },
      ],
    }),
    decode(snapshotSchema, {
      ...snapshot,
      questions: [
        {
          id: 'question',
          taskId: 'task',
          createdAt: time(1),
          prompt: {
            title: 'Choose a branch',
            questions: [
              {
                id: 'branch',
                header: 'Branch',
                question: 'Which branch?',
              },
            ],
          },
        },
      ],
    }),
  ]
  for (const [index, changed] of changes.entries()) {
    const received = await readSnapshot(changed, `W/"snapshot-change-${index}"`)
    const next = retainOverviewSnapshot(previous, {
      ...previous,
      snapshot: received,
      lastSeen: time(1),
    })
    expect(next.snapshot).toEqual(received)
    expect(next.snapshot?.devices).toBe(received.devices)
    expect(next.snapshot?.approvals).toBe(received.approvals)
    expect(next.snapshot?.questions).toBe(received.questions)
    expect(next.snapshot?.workspace).toBe(previous.snapshot?.workspace)
    expect(next.snapshot?.revision).toBe(previous.snapshot?.revision)
    expect(shouldPublishOverview(previous, next)).toBe(true)
  }
})
it('never reuses snapshots without validators or across replaced credentials and hosts', async () => {
  const previous = overview(await readSnapshot())
  for (const next of [
    {
      ...previous,
      snapshot: await readSnapshot(snapshot, ''),
    },
    {
      ...previous,
      profile: runtimeProfile({
        ...profile.connection,
        token: 'replacement-credential-123',
      }),
      snapshot: await readSnapshot(),
    },
    {
      ...previous,
      profile: runtimeProfile({
        ...profile.connection,
        address: 'http://other.local:51464',
      }),
      snapshot: await readSnapshot(),
    },
  ]) {
    expect(retainOverviewSnapshot(previous, next).snapshot).toBe(next.snapshot)
    expect(shouldPublishOverview(previous, next)).toBe(true)
  }
})
it('publishes PR counts, freshness and errors immediately without replacing an unchanged snapshot', async () => {
  const previous = overview(await readSnapshot())
  const counts = {
    total: 3,
    needsAttention: 1,
    reviewRequested: 1,
    partial: false,
  }
  expect(
    shouldPublishOverview(previous, {
      ...previous,
      pulls: {
        ...counts,
      },
      lastSeen: time(1),
    }),
  ).toBe(false)
  for (const change of [
    {
      pulls: {
        ...counts,
        total: 4,
      },
    },
    {
      pulls: {
        ...counts,
        needsAttention: 2,
      },
    },
    {
      pulls: {
        ...counts,
        reviewRequested: 2,
      },
    },
    {
      pulls: {
        ...counts,
        partial: true,
      },
    },
    {
      pulls: null,
    },
    {
      pullError: 'GitHub unavailable',
    },
    {
      profile: {
        ...profile,
        name: 'Renamed computer',
      },
    },
  ])
    expect(
      shouldPublishOverview(previous, {
        ...previous,
        ...change,
        lastSeen: time(1),
      }),
    ).toBe(true)
})

it('keeps recent history before disk persistence, while respecting revision and computer boundaries', () => {
  const task = {
    id: 'recent',
    title: 'Recent',
    agentId: '',
    repositoryId: '',
    status: 'review' as const,
    createdAt: '2026-11-12',
    draft: '',
    example: false,
    historyRevision: 1,
    messages: [{ id: 'answer', role: 'assistant' as const, text: 'Recent reply' }],
    files: [],
  }
  const detailed = {
    ...snapshot,
    runtimeId: 'owner',
    runtimeInstanceId: 'process',
    detailTaskIds: [task.id],
    workspace: { ...snapshot.workspace, tasks: [task] },
  }
  const summary = {
    ...detailed,
    revision: 2,
    detailTaskIds: [],
    workspace: {
      ...detailed.workspace,
      tasks: [{ ...task, title: 'Fresh title', draft: 'Fresh draft', messages: [] }],
    },
  }
  const previous = overview(detailed)
  const next = retainOverviewSnapshot(previous, overview(summary))
  expect(next.snapshot?.detailTaskIds).toEqual(['recent'])
  expect(next.snapshot?.workspace.tasks[0]).toMatchObject({
    title: 'Fresh title',
    draft: 'Fresh draft',
    messages: task.messages,
  })
  for (const changed of [
    { ...summary, runtimeId: 'replacement' },
    { ...summary, runtimeInstanceId: 'restart' },
    {
      ...summary,
      workspace: {
        ...summary.workspace,
        tasks: [{ ...summary.workspace.tasks[0]!, historyRevision: 2 }],
      },
    },
    { ...summary, workspace: { ...summary.workspace, tasks: [] } },
  ]) {
    const received = overview(changed)
    expect(retainOverviewSnapshot(next, received).snapshot).toBe(changed)
  }
  const replaced = {
    ...overview(summary),
    profile: { ...profile, connection: { ...profile.connection, token: 'new-device-credential' } },
  }
  expect(retainOverviewSnapshot(previous, replaced).snapshot).toBe(summary)
})

it('keeps retained rows stable during live updates and preserves conditional-read validators', async () => {
  const task = {
    id: 'idle',
    title: 'Idle',
    agentId: '',
    repositoryId: '',
    status: 'review' as const,
    createdAt: '2026-11-12',
    draft: '',
    example: false,
    messages: [{ id: 'answer', role: 'assistant' as const, text: 'Recent reply' }],
    files: [],
  }
  const detailed = {
    ...snapshot,
    detailTaskIds: [task.id],
    workspace: { ...snapshot.workspace, tasks: [task] },
  }
  let previous = overview(await readSnapshot(detailed, 'detail'))
  const retainedRows: unknown[] = []
  for (let revision = 2; revision <= 31; revision++) {
    const received = await readSnapshot(
      {
        ...detailed,
        revision,
        detailTaskIds: [],
        workspace: { ...detailed.workspace, tasks: [{ ...task, messages: [] }] },
      },
      'summary-' + revision,
    )
    previous = retainOverviewSnapshot(previous, overview(received))
    retainedRows.push(previous.snapshot?.workspace.tasks[0])
    const unchanged = retainOverviewSnapshot(previous, overview(received))
    expect(unchanged.snapshot).toBe(previous.snapshot)
  }
  expect(new Set(retainedRows).size).toBe(1)
})
