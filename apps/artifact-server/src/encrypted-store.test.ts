import { afterEach, expect, it } from 'vite-plus/test'
import {
  newSharingKey,
  sharingUUID,
  sharingHash,
  sharingSigningKey,
  encryptSharing,
  encryptSharedContent,
  sharingReaderKeys,
  decryptSharing,
  decryptSharedContent,
  sharingReaderKeysSchema,
  decode,
  encryptSuggestion,
  type ShareRecord,
  type SharingVault,
} from '@dovo/protocol'
import { ArtifactStore } from './store.js'
import { EncryptedShareStore } from './encrypted-store.js'
const close: Array<() => void> = []
afterEach(() => {
  for (const fn of close.splice(0)) fn()
})
function fixture() {
  let now = Date.now()
  const artifacts = new ArtifactStore(':memory:', () => now),
    store = new EncryptedShareStore(artifacts)
  close.push(() => artifacts.db.close())
  const id = sharingUUID(),
    link = sharingUUID(),
    invitation = sharingUUID(),
    linkKey = newSharingKey(),
    token = newSharingKey()
  const vault: SharingVault = {
    contentKey: newSharingKey(),
    signingSeed: newSharingKey(),
    suggestionSecret: newSharingKey(),
    grants: [],
  }
  const content = {
    kind: 'thread' as const,
    title: 'Hidden title',
    messages: [{ id: '1', role: 'user' as const, text: 'Hidden prompt' }],
  }
  const input: ShareRecord = {
    id,
    source: sharingHash('source'),
    kind: 'thread',
    version: 1,
    updatedAt: now,
    signingKey: sharingSigningKey(vault.signingSeed),
    packet: encryptSharedContent(id, sharingUUID(), content, vault),
    ownerBox: encryptSharing(vault, newSharingKey()),
    grants: [
      {
        id: link,
        tokenHash: sharingHash(token),
        expiresAt: now + 3600000,
        box: encryptSharing(sharingReaderKeys(vault), linkKey),
      },
      {
        id: invitation,
        userId: 'recipient',
        box: encryptSharing(sharingReaderKeys(vault), newSharingKey()),
      },
    ],
    paused: false,
    writerHash: sharingHash('writer'),
  }
  const saved = store.save('owner', 0, input)
  return {
    store,
    artifacts,
    saved,
    vault,
    content,
    id,
    link,
    invitation,
    linkKey,
    token,
    advance: (ms: number) => {
      now += ms
    },
  }
}
it('stores opaque ciphertext and keeps keys, titles and prompts out of hosting', () => {
  const f = fixture(),
    raw = JSON.stringify(f.artifacts.db.prepare('SELECT * FROM encrypted_shares').all())
  for (const secret of [
    f.content.title,
    f.content.messages[0]!.text,
    f.vault.contentKey,
    f.vault.suggestionSecret,
    f.linkKey,
    f.token,
  ])
    expect(raw).not.toContain(secret)
  const viewed = f.store.read(f.id, f.link, undefined, f.token)
  const keys = decode(sharingReaderKeysSchema, decryptSharing(viewed.box, f.linkKey))
  expect(decryptSharedContent(f.id, viewed.packet, keys)).toEqual(f.content)
  expect(f.store.list('owner')[0]).not.toHaveProperty('packet')
})
it('enforces invited identities, link tokens, expiry and owner-only management', () => {
  const f = fixture()
  expect(() => f.store.read(f.id, f.invitation)).toThrow('unavailable or access not granted')
  expect(() => f.store.read(f.id, f.invitation, 'stranger')).toThrow(
    'unavailable or access not granted',
  )
  expect(f.store.read(f.id, f.invitation, 'recipient').id).toBe(f.id)
  expect(() => f.store.read(f.id, f.link, undefined, 'wrong')).toThrow(
    'unavailable or access not granted',
  )
  expect(() => f.store.own(f.id, 'stranger')).toThrow('unavailable or access not granted')
  f.advance(3600001)
  expect(() => f.store.read(f.id, f.link, undefined, f.token)).toThrow(
    'unavailable or access not granted',
  )
})
it('rejects conflicting edits and revoked writers while preserving remaining access', () => {
  const f = fixture()
  expect(() => f.store.save('owner', 0, f.saved)).toThrow('changed')
  expect(() => f.store.update(f.id, 'wrong', 1, f.saved.packet)).toThrow('paused or revoked')
  const next = f.store.save('owner', 1, {
    ...f.saved,
    grants: f.saved.grants.filter((grant) => grant.id !== f.link),
    paused: true,
    writerHash: undefined,
  })
  expect(() => f.store.read(f.id, f.link, undefined, f.token)).toThrow(
    'unavailable or access not granted',
  )
  expect(f.store.read(f.id, f.invitation, 'recipient').version).toBe(next.version)
  expect(() => f.store.update(f.id, 'writer', next.version, f.saved.packet)).toThrow(
    'paused or revoked',
  )
  expect(() => f.store.save('stranger', next.version, next)).toThrow(
    'unavailable or access not granted',
  )
})
it('bounds and deduplicates encrypted suggestions and deletes them with the publication', () => {
  const f = fixture(),
    suggestion = encryptSuggestion(
      { shareId: f.id, revision: f.saved.packet.revision, text: 'Private suggestion', name: '' },
      sharingReaderKeys(f.vault).suggestionKey,
    )
  f.store.suggest(f.id, suggestion)
  f.store.suggest(f.id, suggestion)
  expect(f.store.suggestions(f.id, 'owner')).toHaveLength(1)
  expect(
    JSON.stringify(f.artifacts.db.prepare('SELECT * FROM encrypted_suggestions').all()),
  ).not.toContain('Private suggestion')
  expect(() => f.store.suggestions(f.id, 'recipient')).toThrow('unavailable or access not granted')
  f.store.remove(f.id, 'owner')
  expect(f.artifacts.db.prepare('SELECT * FROM encrypted_suggestions').all()).toHaveLength(0)
})

it('returns a conflict when two publications target the same owner and source', () => {
  const f = fixture(),
    id = sharingUUID()
  expect(() =>
    f.store.save('owner', 0, {
      ...f.saved,
      id,
      packet: encryptSharedContent(id, sharingUUID(), f.content, f.vault),
    }),
  ).toThrow('Sharing changed')
  expect(f.store.list('owner')).toHaveLength(1)
})

it('keeps expired links inaccessible while allowing the owner to manage other readers and resume updates', () => {
  const f = fixture()
  f.advance(3600001)
  expect(() => f.store.read(f.id, f.link, undefined, f.token)).toThrow('unavailable')
  const saved = f.store.save('owner', f.saved.version, { ...f.saved, paused: true })
  expect(saved.paused).toBe(true)
  expect(f.store.read(f.id, f.invitation, 'recipient').id).toBe(f.id)
  expect(() => f.store.read(f.id, f.link, undefined, f.token)).toThrow('unavailable')
})
