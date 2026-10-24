import { expect, it } from 'vite-plus/test'
import {
  decode,
  mergeAccountInternetConnection,
  peerAddress,
  snapshotSchema,
  type RuntimeConnection,
  type RuntimeOverview,
  type RuntimeRegistry,
} from '@dovo/protocol'
import {
  accountRecoveryTarget,
  renewedAccountConnection,
  saveRecoveredAccountConnection,
} from './account-recovery'

const session = 'signed-in-session'
const peer = { origin: 'https://connect.test', secret: '8'.repeat(64), relay: 'dovo' as const }
const incoming = {
  address: peerAddress(peer),
  token: 'new-internet-device-token-long',
  runtimeId: 'studio',
  peer,
  accountSession: session,
}
const profile = {
  id: 'saved-studio',
  name: 'My custom Studio',
  nameIsCustom: true,
  connection: {
    address: 'http://studio.local:51464',
    token: 'lan-pairing-device-token-long',
    runtimeId: 'studio',
  },
}
const directory = {
  user: { id: 'person', name: 'Dominic' },
  servers: [
    { id: 'studio', name: 'Studio', address: '', internet: { publicKey: 'key', online: true } },
  ],
}
const overview = (
  connection: RuntimeConnection = profile.connection,
  connected = false,
): RuntimeOverview => ({
  profile: { ...profile, connection },
  connected,
  snapshot: null,
  error: 'Cannot connect',
  lastSeen: null,
  pulls: null,
  pullError: null,
})
const registry: RuntimeRegistry = {
  version: 1,
  activeId: 'another-computer',
  profiles: [
    profile,
    {
      ...profile,
      id: 'another-computer',
      connection: { ...profile.connection, address: 'http://other.local' },
    },
  ],
}

it('prepares missing account fallback even for a healthy LAN computer, using stable identity', () => {
  expect(accountRecoveryTarget(overview(profile.connection, true), directory, session)?.id).toBe(
    'studio',
  )
  expect(
    accountRecoveryTarget(
      overview({ ...profile.connection, runtimeId: 'another' }),
      directory,
      session,
    ),
  ).toBeUndefined()
  expect(accountRecoveryTarget(overview(), { ...directory, servers: [] }, session)).toBeUndefined()
  expect(
    accountRecoveryTarget(
      overview(),
      {
        ...directory,
        servers: [{ ...directory.servers[0]!, internet: { publicKey: 'key', online: false } }],
      },
      session,
    ),
  ).toBeUndefined()
})
it('renews failed saved account credentials, without replacing healthy or pending connections', () => {
  const entry = overview(mergeAccountInternetConnection(profile.connection, incoming))
  expect(accountRecoveryTarget(entry, directory, session)?.id).toBe('studio')
  expect(accountRecoveryTarget({ ...entry, connected: true }, directory, session)).toBeUndefined()
  expect(accountRecoveryTarget({ ...entry, error: null }, directory, session)).toBeUndefined()
  expect(accountRecoveryTarget(entry, directory, 'different-session')).toBeUndefined()
})
it('respects manual WebRTC pairing and LAN-only mode', () => {
  expect(
    accountRecoveryTarget(overview({ ...incoming, accountSession: undefined }), directory, session),
  ).toBeUndefined()
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
    relaySettings: { mode: 'default', configured: false, urls: [], connectionMode: 'lan' },
  })
  expect(accountRecoveryTarget({ ...overview(), snapshot }, directory, session)).toBeUndefined()
})
it('retains relay consent, including a previous choice to use no TURN', () => {
  expect(
    renewedAccountConnection({ ...incoming, peer: { ...peer, relay: undefined } }, incoming).peer
      ?.relay,
  ).toBeUndefined()
  expect(
    renewedAccountConnection(
      mergeAccountInternetConnection(profile.connection, {
        ...incoming,
        peer: { ...peer, relay: 'custom' },
      }),
      incoming,
    ).peer?.relay,
  ).toBe('custom')
})
it('preserves LAN credentials, custom name, saved identity and selected computer', () => {
  const next = saveRecoveredAccountConnection(registry, profile, incoming, session)
  expect(next.activeId).toBe(registry.activeId)
  expect(next.profiles[0]).toMatchObject(profile)
  expect(next.profiles[0]?.connection.internet?.token).toBe(incoming.token)
  const accountProfile = { ...profile, connection: { ...incoming, token: 'expired-token' } }
  const accountRegistry = { ...registry, profiles: [accountProfile], activeId: accountProfile.id }
  expect(
    saveRecoveredAccountConnection(accountRegistry, accountProfile, incoming, session),
  ).toMatchObject({ activeId: profile.id, profiles: [{ ...profile, connection: incoming }] })
})
it('rejects stale results after forgetting, changing accounts, credentials or relay consent', () => {
  for (const changed of [
    { ...registry, profiles: [] },
    {
      ...registry,
      profiles: [{ ...profile, connection: { ...profile.connection, token: 're-paired' } }],
    },
    {
      ...registry,
      profiles: [
        { ...profile, connection: mergeAccountInternetConnection(profile.connection, incoming) },
      ],
    },
  ])
    expect(() => saveRecoveredAccountConnection(changed, profile, incoming, session)).toThrow(
      'changed',
    )
  expect(() => saveRecoveredAccountConnection(registry, profile, incoming, null)).toThrow('changed')
  expect(() => saveRecoveredAccountConnection(registry, profile, incoming, 'other')).toThrow(
    'changed',
  )
  expect(() =>
    saveRecoveredAccountConnection(registry, profile, { ...incoming, runtimeId: 'other' }, session),
  ).toThrow('changed')
})
it('preserves names and discovered alternate addresses learned during recovery', () => {
  const renamed = {
    ...profile,
    name: 'New name',
    connection: { ...profile.connection, alternateAddresses: ['http://vpn:51464'] },
  }
  const next = saveRecoveredAccountConnection(
    { ...registry, profiles: [renamed] },
    profile,
    incoming,
    session,
  )
  expect(next.profiles[0]).toMatchObject(renamed)
})
