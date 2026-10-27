import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { runtimeProfile } from './runtime-fleet.js'
import { snapshotSchema } from './runtime.js'
import {
  resolveRuntimeTarget,
  runtimeResourceKey,
  verifyRuntimeReplacement,
} from './runtime-target.js'

const profile = runtimeProfile({
  address: 'http://computer.local:51464',
  token: 'test-device-credential-123',
})
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

it('resolves the captured computer only while its address and pairing remain saved', () => {
  const renamed = {
    ...profile,
    name: 'New name',
    connection: { ...profile.connection, alternateAddresses: ['http://100.64.0.1:51464'] },
  }
  expect(resolveRuntimeTarget([renamed], profile)).toBe(renamed)
  expect(resolveRuntimeTarget([], profile)).toBeUndefined()
  expect(resolveRuntimeTarget([{ ...profile, id: 'another-profile' }], profile)).toBeUndefined()
  expect(
    resolveRuntimeTarget(
      [{ ...profile, connection: { ...profile.connection, address: 'http://other.local:51464' } }],
      profile,
    ),
  ).toBeUndefined()
  expect(
    resolveRuntimeTarget(
      [{ ...profile, connection: { ...profile.connection, token: 'replacement-credential' } }],
      profile,
    ),
  ).toBeUndefined()
})

it('keeps same-named resources on different computers distinct without changing persisted keys', () => {
  expect(runtimeResourceKey(profile.id, 'thread-a')).toBe(JSON.stringify([profile.id, 'thread-a']))
  expect(runtimeResourceKey('a:b', 'c')).not.toBe(runtimeResourceKey('a', 'b:c'))
  expect(runtimeResourceKey('mac', 'same-id')).not.toBe(runtimeResourceKey('linux', 'same-id'))
})

it('verifies a replacement before learning routes and accepts a restart of the same server', () => {
  const previous = { ...profile.connection, runtimeId: 'server-a' }
  const candidate = {
    ...profile.connection,
    address: 'http://new-address.local:51464',
    token: 'new-paired-credential-123',
  }
  const verified = verifyRuntimeReplacement(previous, candidate, {
    ...snapshot,
    runtimeId: 'server-a',
    runtimeInstanceId: 'new-process',
    runtimeAddresses: ['http://100.64.0.2:51464'],
  })
  expect(verified).toEqual({
    ...candidate,
    runtimeId: 'server-a',
    alternateAddresses: ['http://100.64.0.2:51464'],
  })
  expect(() =>
    verifyRuntimeReplacement(previous, candidate, { ...snapshot, runtimeId: 'server-b' }),
  ).toThrow('different computer')
  expect(() => verifyRuntimeReplacement(previous, candidate, snapshot)).toThrow('Could not verify')
  expect(previous.runtimeId).toBe('server-a')
  expect(candidate).not.toHaveProperty('runtimeId')
})

it('keeps legacy unpinned pairings usable and learns identity when the runtime supports it', () => {
  expect(verifyRuntimeReplacement(profile.connection, profile.connection, snapshot)).toBe(
    profile.connection,
  )
  expect(
    verifyRuntimeReplacement(null, profile.connection, {
      ...snapshot,
      runtimeId: 'legacy-upgraded',
    }),
  ).toMatchObject({ runtimeId: 'legacy-upgraded' })
})
