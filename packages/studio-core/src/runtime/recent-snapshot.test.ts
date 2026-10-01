import { decode, runtimeProfile, snapshotSchema, type RuntimeOverview } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { recentSnapshot } from './recent-snapshot'

const now = Date.parse('2026-10-01T12:00:00Z')
const profile = runtimeProfile(
  { address: 'http://server.local:8787', token: 'fixture-token-1234567890' },
  'Server',
)
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
const overview: RuntimeOverview = {
  profile,
  snapshot,
  connected: true,
  lastSeen: new Date(now - 1000).toISOString(),
  error: null,
  pulls: null,
  pullError: null,
}

it('reuses a recent successful snapshot of the selected runtime', () => {
  expect(recentSnapshot(profile, overview, now)).toBe(snapshot)
})

it('requires an online snapshot with a valid recent timestamp', () => {
  for (const change of [
    { connected: false },
    { snapshot: null },
    { lastSeen: null },
    { lastSeen: 'invalid' },
    { lastSeen: new Date(now + 1).toISOString() },
    { lastSeen: new Date(now - 15_000).toISOString() },
  ])
    expect(recentSnapshot(profile, { ...overview, ...change }, now)).toBeNull()
  expect(recentSnapshot(profile, undefined, now)).toBeNull()
})

it('never reuses a snapshot after the address or credentials change', () => {
  for (const connection of [
    { ...profile.connection, address: 'http://server.local:8788' },
    { ...profile.connection, token: 'replacement-token-1234567890' },
  ])
    expect(recentSnapshot({ ...profile, connection }, overview, now)).toBeNull()
})
