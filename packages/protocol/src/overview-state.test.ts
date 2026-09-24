import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  clearRuntimeRequestCache,
  decode,
  runtimeProfile,
  runtimeRequest,
  snapshotSchema,
  type RuntimeConnection,
  type RuntimeOverview,
  type RuntimeSnapshot,
} from './index.js'
import {
  retainOverviewSnapshot,
  retainRuntimeSnapshot,
  shouldPublishOverview,
} from './overview-state.js'

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

async function taggedSnapshot(
  connection: RuntimeConnection,
  value: RuntimeSnapshot = snapshot,
  tag?: string,
) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(value, { headers: tag ? { ETag: tag } : {} })),
  )
  return runtimeRequest(
    connection,
    connection.address,
    '/api/snapshot',
    undefined,
    snapshotSchema,
    'GET',
  )
}

const overview = (value: RuntimeSnapshot, nextProfile = profile): RuntimeOverview => ({
  profile: nextProfile,
  snapshot: value,
  connected: true,
  lastSeen: time(0),
  error: null,
  pulls: null,
  pullError: null,
})

afterEach(() => {
  clearRuntimeRequestCache()
  vi.unstubAllGlobals()
})

it('retains an identical ETag across cloned credentials with the same address and token', async () => {
  const firstConnection = { ...profile.connection }
  const clonedConnection = { ...profile.connection }
  const previous = await taggedSnapshot(firstConnection, snapshot, 'W/"same"')
  const next = await taggedSnapshot(clonedConnection, snapshot, 'W/"same"')

  expect(next).not.toBe(previous)
  expect(retainRuntimeSnapshot(previous, firstConnection, next, clonedConnection)).toBe(previous)
})

it('never reuses an ETag when the address changes, even with the same profile id and token', async () => {
  const previous = await taggedSnapshot(profile.connection, snapshot, 'W/"same"')
  const movedProfile = {
    ...profile,
    connection: { ...profile.connection, address: 'http://other.local:51464' },
  }
  const next = await taggedSnapshot(movedProfile.connection, snapshot, 'W/"same"')

  expect(movedProfile.id).toBe(profile.id)
  expect(movedProfile.connection.token).toBe(profile.connection.token)
  expect(retainOverviewSnapshot(overview(previous), overview(next, movedProfile)).snapshot).toBe(
    next,
  )
})

it('never reuses an ETag after the device token changes', async () => {
  const previous = await taggedSnapshot(profile.connection, snapshot, 'W/"same"')
  const replacement = runtimeProfile({
    ...profile.connection,
    token: 'replacement-device-credential-456',
  })
  const next = await taggedSnapshot(replacement.connection, snapshot, 'W/"same"')

  expect(retainRuntimeSnapshot(previous, profile.connection, next, replacement.connection)).toBe(
    next,
  )
})

it('does not reuse snapshots when either response lacks a validator', async () => {
  const previous = await taggedSnapshot(profile.connection, snapshot, 'W/"same"')
  const untagged = await taggedSnapshot({ ...profile.connection }, snapshot)

  expect(
    retainRuntimeSnapshot(previous, profile.connection, untagged, { ...profile.connection }),
  ).toBe(untagged)

  const tagged = await taggedSnapshot(profile.connection, snapshot, 'W/"same"')
  const untaggedPrevious = await taggedSnapshot({ ...profile.connection }, snapshot)
  expect(
    retainRuntimeSnapshot(untaggedPrevious, { ...profile.connection }, tagged, profile.connection),
  ).toBe(tagged)
})

it('suppresses idle freshness while still publishing outages and approval changes with a new ETag', async () => {
  const previousSnapshot = await taggedSnapshot(profile.connection, snapshot, 'W/"one"')
  const previous = overview(previousSnapshot)
  const idle = retainOverviewSnapshot(previous, {
    ...previous,
    snapshot: await taggedSnapshot({ ...profile.connection }, snapshot, 'W/"one"'),
    lastSeen: time(1),
  })
  expect(idle.snapshot).toBe(previousSnapshot)
  expect(shouldPublishOverview(previous, idle)).toBe(false)

  expect(shouldPublishOverview(idle, { ...idle, connected: false, error: 'Offline' })).toBe(true)

  const changed = decode(snapshotSchema, {
    ...snapshot,
    approvals: [
      {
        id: 'approval',
        taskId: 'task',
        title: 'Edit files',
        detail: 'Apply the proposed changes',
        createdAt: time(2),
      },
    ],
  })
  const changedSnapshot = await taggedSnapshot(
    { ...profile.connection },
    changed,
    'W/"approval-change"',
  )
  const withApproval = retainOverviewSnapshot(idle, {
    ...idle,
    snapshot: changedSnapshot,
    lastSeen: time(2),
  })
  expect(withApproval.snapshot).toBe(changedSnapshot)
  expect(withApproval.snapshot?.revision).toBe(previousSnapshot.revision)
  expect(shouldPublishOverview(idle, withApproval)).toBe(true)
})
