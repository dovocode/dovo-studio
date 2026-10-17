import { expect, it } from 'vite-plus/test'
import type { RuntimeProfile } from '@dovo/protocol'
import { doThreadOwner } from './thread-owner'

const origin: RuntimeProfile = {
  id: 'owner-profile',
  name: 'Workstation',
  connection: {
    address: 'http://workstation.demo:8080',
    token: 'owner-token',
    runtimeId: 'owner-runtime',
  },
}
const remote: RuntimeProfile = {
  id: 'remote-profile',
  name: 'Build computer',
  connection: {
    address: 'http://build.demo:8080',
    token: 'remote-token',
    runtimeId: 'build-runtime',
  },
}

it('resolves a stable remote runtime ID to this client’s distinct profile ID', () => {
  const owner = doThreadOwner(
    [
      { profile: origin, snapshot: { runtimeId: 'owner-runtime' } },
      { profile: remote, snapshot: { runtimeId: 'build-runtime' } },
    ],
    origin.id,
    'build-runtime',
  )
  expect(owner?.id).toBe('remote-profile')
})

it('uses the paired connection identity before a snapshot is available', () => {
  expect(doThreadOwner([{ profile: remote, snapshot: null }], origin.id, 'build-runtime')).toBe(
    remote,
  )
})

it('uses the snapshot identity before a stale paired identity or a colliding legacy profile ID', () => {
  const collision: RuntimeProfile = { ...origin, id: 'build-runtime' }
  const staleConnection: RuntimeProfile = {
    ...remote,
    connection: { ...remote.connection, runtimeId: 'old-runtime' },
  }
  const computers = [
    { profile: collision, snapshot: { runtimeId: 'owner-runtime' } },
    { profile: staleConnection, snapshot: { runtimeId: 'build-runtime' } },
  ]
  expect(doThreadOwner(computers, collision.id, 'build-runtime')).toBe(staleConnection)
})

it('resolves local to the plan owner and keeps legacy profile IDs as a fallback', () => {
  const computers = [{ profile: origin }, { profile: remote }]
  expect(doThreadOwner(computers, origin.id, 'local')).toBe(origin)
  expect(doThreadOwner(computers, origin.id, remote.id)).toBe(remote)
})

it('does not open an unknown runtime’s task on the currently selected computer', () => {
  expect(doThreadOwner([{ profile: origin }], origin.id, 'build-runtime')).toBeUndefined()
  expect(doThreadOwner([{ profile: remote }], origin.id, 'local')).toBeUndefined()
})
