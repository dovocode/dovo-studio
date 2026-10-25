import { afterEach, expect, it } from 'vite-plus/test'
import { AccountStore } from './store.js'
const stores: AccountStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close()
})
function fixture() {
  const store = new AccountStore(':memory:')
  stores.push(store)
  const tokens = new Map<string, string>()
  for (const id of ['owner', 'alice', 'bob']) {
    const { login, token } = store.createLogin()
    store.approve(login, { id, name: id })
    tokens.set(id, token)
  }
  return { store, people: store.people, tokens }
}
it('requires recipient consent, isolates friendship requests and removes both sides without granting computer access', () => {
  const { store, people } = fixture()
  expect(() => people.mutate('owner', { action: 'requestFriend', userId: 'missing' })).toThrow(
    'No account',
  )
  expect(() => people.mutate('owner', { action: 'requestFriend', userId: 'owner' })).toThrow(
    'yourself',
  )
  people.mutate('owner', { action: 'requestFriend', userId: 'alice' })
  expect(people.directory('alice').friends).toEqual([
    { id: 'owner', name: 'owner', status: 'incoming' },
  ])
  expect(people.directory('owner').friends[0]?.status).toBe('outgoing')
  expect(people.directory('bob').friends).toEqual([])
  expect(() => people.mutate('owner', { action: 'acceptFriend', userId: 'alice' })).toThrow(
    'unavailable',
  )
  people.mutate('alice', { action: 'acceptFriend', userId: 'owner' })
  expect(people.directory('owner').friends[0]?.status).toBe('accepted')
  people.mutate('alice', { action: 'removeFriend', userId: 'owner' })
  expect(people.directory('owner').friends).toEqual([])
  expect(store.db.prepare('SELECT * FROM servers').all()).toEqual([])
})
it('enforces organisation invitations and owner rights; membership changes apply to existing scoped sessions immediately', () => {
  const { store, people, tokens } = fixture()
  people.mutate('owner', { action: 'createOrganization', name: '  Dovo  ' })
  const org = people.directory('owner').organizations[0]!
  expect(org.name).toBe('Dovo')
  expect(() =>
    people.mutate('bob', { action: 'inviteMember', organizationId: org.id, userId: 'alice' }),
  ).toThrow('Only')
  expect(() =>
    people.mutate('bob', { action: 'acceptOrganization', organizationId: org.id }),
  ).toThrow('unavailable')
  people.mutate('owner', { action: 'inviteMember', organizationId: org.id, userId: 'alice' })
  const grant = store.artifactGrant(tokens.get('alice')!, 'https://share.test')!
  expect(store.artifactSession(grant.token)?.sharingOrganizations).toEqual([])
  expect(people.directory('alice').organizations[0]?.members.map((member) => member.id)).toEqual([
    'owner',
  ])
  people.mutate('alice', { action: 'acceptOrganization', organizationId: org.id })
  expect(store.artifactSession(grant.token)?.sharingOrganizations).toEqual([org.id])
  expect(() =>
    people.mutate('alice', { action: 'deleteOrganization', organizationId: org.id }),
  ).toThrow('Only')
  expect(() =>
    people.mutate('alice', { action: 'removeMember', organizationId: org.id, userId: 'owner' }),
  ).toThrow('Only the owner')
  people.mutate('owner', { action: 'removeMember', organizationId: org.id, userId: 'alice' })
  expect(store.artifactSession(grant.token)?.sharingOrganizations).toEqual([])
  expect(people.directory('alice').organizations).toEqual([])
  people.mutate('owner', { action: 'deleteOrganization', organizationId: org.id })
  expect(people.memberships('owner')).toEqual([])
})
it('cleans friendships, invitations and owned organisations when deleting an account', () => {
  const { store, people } = fixture()
  people.mutate('owner', { action: 'createOrganization', name: 'Dovo' })
  const org = people.directory('owner').organizations[0]!
  people.mutate('owner', { action: 'inviteMember', organizationId: org.id, userId: 'alice' })
  people.mutate('alice', { action: 'acceptOrganization', organizationId: org.id })
  people.mutate('owner', { action: 'requestFriend', userId: 'alice' })
  store.deleteAccount('owner')
  expect(people.directory('alice')).toEqual({ friends: [], organizations: [] })
  expect(people.memberships('alice')).toEqual([])
})
