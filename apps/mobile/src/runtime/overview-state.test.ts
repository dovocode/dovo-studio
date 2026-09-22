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
const snapshot = snapshotSchema.parse({
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
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(value, { headers: tag ? { ETag: tag } : {} })),
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
  pulls: { total: 3, needsAttention: 1, reviewRequested: 1, partial: false },
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
    vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 304 })),
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
  const offline = { ...latest, connected: false, error: 'Cannot reach this computer' }
  expect(shouldPublishOverview(published, offline)).toBe(true)
  expect(offline.lastSeen).toBe(time(9))
  expect(shouldPublishOverview(offline, { ...offline })).toBe(false)
  expect(shouldPublishOverview(offline, { ...offline, error: 'Device revoked' })).toBe(true)
  expect(shouldPublishOverview(offline, { ...latest, lastSeen: time(10) })).toBe(true)
})

it('does not hide device, approval or question changes when the workspace revision is unchanged', async () => {
  const previous = overview(await readSnapshot())
  const changes = [
    snapshotSchema.parse({
      ...snapshot,
      devices: [{ id: 'phone', name: 'Phone', createdAt: time(1), revokedAt: null }],
    }),
    snapshotSchema.parse({
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
    snapshotSchema.parse({
      ...snapshot,
      questions: [
        {
          id: 'question',
          taskId: 'task',
          createdAt: time(1),
          prompt: {
            title: 'Choose a branch',
            questions: [{ id: 'branch', header: 'Branch', question: 'Which branch?' }],
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
    expect(next.snapshot).toBe(received)
    expect(next.snapshot?.revision).toBe(previous.snapshot?.revision)
    expect(shouldPublishOverview(previous, next)).toBe(true)
  }
})

it('never reuses snapshots without validators or across replaced credentials and hosts', async () => {
  const previous = overview(await readSnapshot())
  for (const next of [
    { ...previous, snapshot: await readSnapshot(snapshot, '') },
    {
      ...previous,
      profile: runtimeProfile({ ...profile.connection, token: 'replacement-credential-123' }),
      snapshot: await readSnapshot(),
    },
    {
      ...previous,
      profile: runtimeProfile({ ...profile.connection, address: 'http://other.local:51464' }),
      snapshot: await readSnapshot(),
    },
  ]) {
    expect(retainOverviewSnapshot(previous, next).snapshot).toBe(next.snapshot)
    expect(shouldPublishOverview(previous, next)).toBe(true)
  }
})

it('publishes PR counts, freshness and errors immediately without replacing an unchanged snapshot', async () => {
  const previous = overview(await readSnapshot())
  const counts = { total: 3, needsAttention: 1, reviewRequested: 1, partial: false }
  expect(
    shouldPublishOverview(previous, { ...previous, pulls: { ...counts }, lastSeen: time(1) }),
  ).toBe(false)
  for (const change of [
    { pulls: { ...counts, total: 4 } },
    { pulls: { ...counts, needsAttention: 2 } },
    { pulls: { ...counts, reviewRequested: 2 } },
    { pulls: { ...counts, partial: true } },
    { pulls: null },
    { pullError: 'GitHub unavailable' },
    { profile: { ...profile, name: 'Renamed computer' } },
  ])
    expect(shouldPublishOverview(previous, { ...previous, ...change, lastSeen: time(1) })).toBe(
      true,
    )
})
