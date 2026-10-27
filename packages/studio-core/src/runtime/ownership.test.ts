import {
  decode,
  runtimeProfile,
  snapshotSchema,
  verifyRuntimeReplacement,
  type RuntimeOverview,
} from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { createTask } from '../workspace/actions'
import type { TaskPreview } from '../workspace/task-previews'
import {
  currentRuntimeOverview,
  isActiveRuntime,
  replacedRuntimeConnection,
  visibleRuntimeOverviews,
} from './ownership'

const profile = runtimeProfile(
  { address: 'http://server.local:8787', token: 'fixture-token-1234567890' },
  'Server',
)
const overview: RuntimeOverview = {
  profile,
  snapshot: null,
  connected: true,
  lastSeen: '2026-10-01T12:00:00.000Z',
  error: null,
  pulls: null,
  pullError: null,
}
const moved = {
  ...profile,
  connection: { ...profile.connection, address: 'http://server.vpn:8787' },
}

it('relabels a cached view with the saved profile after routes are learned', () => {
  expect(currentRuntimeOverview(profile, overview)).toBe(overview)
  const learned = {
    ...profile,
    connection: {
      ...profile.connection,
      runtimeId: 'runtime-a',
      alternateAddresses: ['http://192.168.1.4:8787'],
    },
  }
  const current = currentRuntimeOverview(learned, overview)
  expect(current?.profile).toBe(learned)
  expect(current?.connected).toBe(true)
})

it('invalidates a cached view once its address or pairing is replaced', () => {
  expect(currentRuntimeOverview(moved, overview)).toBeUndefined()
  expect(
    currentRuntimeOverview(
      { ...profile, connection: { ...profile.connection, token: 'replacement-token-1234567890' } },
      overview,
    ),
  ).toBeUndefined()
  expect(currentRuntimeOverview(profile, undefined)).toBeUndefined()
  expect(
    currentRuntimeOverview(profile, { ...overview, profile: { ...profile, id: 'other' } }),
  ).toBeUndefined()
})

it('treats live workspace state as active only for the open address and pairing', () => {
  expect(isActiveRuntime(profile, profile.id, profile.connection)).toBe(true)
  expect(
    isActiveRuntime(profile, profile.id, { ...profile.connection, alternateAddresses: [] }),
  ).toBe(true)
  // Same token at another address is a replacement in progress, not the open connection.
  expect(isActiveRuntime(moved, profile.id, profile.connection)).toBe(false)
  expect(isActiveRuntime(profile, 'other', profile.connection)).toBe(false)
  expect(isActiveRuntime(profile, profile.id, null)).toBe(false)
})

it('projects saved computers through their current pairing and its own task previews', () => {
  const task = createTask({ title: 'Task', repositoryId: 'repo', agentId: '', objective: '' })
  const snapshot = decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      automations: [],
      tasks: [task],
      repositories: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const other = runtimeProfile(
    { address: 'http://other.local:8787', token: 'other-token-1234567890' },
    'Other',
  )
  const overviews = {
    [profile.id]: { ...overview, snapshot },
    [other.id]: { ...overview, profile: other, snapshot },
  }
  const pinned: TaskPreview = {
    id: Symbol(task.id),
    connection: profile.connection,
    taskId: task.id,
    changes: { pinned: true },
  }
  const learned = {
    ...profile,
    connection: { ...profile.connection, alternateAddresses: ['http://192.168.1.4:8787'] },
  }
  const [current, untouched] = visibleRuntimeOverviews([learned, other], overviews, [pinned])
  expect(current.profile).toBe(learned)
  expect(current.connected).toBe(true)
  expect(current.snapshot?.workspace.tasks[0]?.pinned).toBe(true)
  expect(untouched).toBe(overviews[other.id])
  // The registry names the new address before that address has been read.
  const [replaced, inactive] = visibleRuntimeOverviews([moved, other], overviews, [pinned])
  expect(replaced).toEqual({
    profile: moved,
    snapshot: null,
    connected: false,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
  })
  expect(inactive).toBe(overviews[other.id])
})

it('verifies an active replacement against the saved identity, not the stale open connection', () => {
  const snapshot = (runtimeId?: string) =>
    decode(snapshotSchema, {
      revision: 1,
      owner: false,
      ...(runtimeId ? { runtimeId } : {}),
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
  // The open connection was adopted before route learning saved its runtime ID.
  const open = profile.connection
  const saved = { ...profile.connection, runtimeId: 'runtime-a' }
  const candidate = { address: 'http://server.vpn:8787', token: 'new-pairing-token-1234567890' }
  const baseline = replacedRuntimeConnection(open, saved)
  expect(baseline).toEqual({ ...open, runtimeId: 'runtime-a' })
  expect(() => verifyRuntimeReplacement(baseline, candidate, snapshot('runtime-b'))).toThrow(
    'different computer',
  )
  expect(() => verifyRuntimeReplacement(baseline, candidate, snapshot())).toThrow(
    'Could not verify',
  )
  expect(verifyRuntimeReplacement(baseline, candidate, snapshot('runtime-a')).runtimeId).toBe(
    'runtime-a',
  )
  // The saved identity wins over a stale or differing open connection.
  expect(replacedRuntimeConnection({ ...open, runtimeId: 'stale' }, saved)?.runtimeId).toBe(
    'runtime-a',
  )
  // Before route learning is persisted, the old pairing's own snapshot supplies its identity.
  const read: RuntimeOverview = { ...overview, snapshot: snapshot('runtime-a') }
  expect(replacedRuntimeConnection(open, open, read)?.runtimeId).toBe('runtime-a')
  expect(
    replacedRuntimeConnection(open, open, { ...read, profile: moved })?.runtimeId,
  ).toBeUndefined()
  // A pairing that never reported an identity stays compatible.
  const legacy = replacedRuntimeConnection(open, open, overview)
  expect(legacy).toBe(open)
  const legacyCandidate = { ...candidate, address: 'http://server.lan:8787' }
  expect(verifyRuntimeReplacement(legacy, legacyCandidate, snapshot('runtime-b')).runtimeId).toBe(
    'runtime-b',
  )
  expect(replacedRuntimeConnection(null, saved)).toBe(saved)
  expect(replacedRuntimeConnection(null, undefined)).toBeUndefined()
})
