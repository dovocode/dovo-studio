import { expect, it } from 'vite-plus/test'
import {
  newSharingKey,
  sharingUUID,
  encryptSharing,
  decryptSharing,
  encryptSharedContent,
  decryptSharedContent,
  sharingReaderKeys,
  encryptSuggestion,
  decryptSuggestion,
  sharedThreadContent,
  type SharingVault,
} from './encrypted-sharing.js'
const vault = (): SharingVault => ({
  contentKey: newSharingKey(),
  signingSeed: newSharingKey(),
  suggestionSecret: newSharingKey(),
  grants: [],
})
it('encrypts and authenticates thread content and binds signatures to the publication and revision', () => {
  const owner = vault(),
    id = sharingUUID(),
    generation = sharingUUID()
  const content = {
    kind: 'thread' as const,
    title: 'Secret title',
    messages: [{ id: '1', role: 'user' as const, text: 'Private prompt' }],
  }
  const packet = encryptSharedContent(id, generation, content, owner)
  expect(JSON.stringify(packet)).not.toContain('Private prompt')
  expect(decryptSharedContent(id, packet, sharingReaderKeys(owner))).toEqual(content)
  expect(() => decryptSharedContent(sharingUUID(), packet, sharingReaderKeys(owner))).toThrow(
    'signature',
  )
  expect(() =>
    decryptSharedContent(id, { ...packet, revision: sharingUUID() }, sharingReaderKeys(owner)),
  ).toThrow('signature')
  expect(() => decryptSharedContent(id, packet, sharingReaderKeys(vault()))).toThrow('signature')
  expect(() =>
    decryptSharedContent(id, packet, { ...sharingReaderKeys(owner), contentKey: newSharingKey() }),
  ).toThrow('decrypt')
})
it('uses fresh authenticated encryption nonces and rejects corrupted envelopes', () => {
  const key = newSharingKey(),
    a = encryptSharing({ title: 'Secret' }, key),
    b = encryptSharing({ title: 'Secret' }, key)
  expect(a.nonce).not.toBe(b.nonce)
  expect(a.ciphertext).not.toBe(b.ciphertext)
  expect(decryptSharing(a, key)).toEqual({ title: 'Secret' })
  expect(() =>
    decryptSharing(
      { ...a, ciphertext: a.ciphertext.slice(0, -2) + (a.ciphertext.endsWith('00') ? '01' : '00') },
      key,
    ),
  ).toThrow('decrypt')
})
it('encrypts suggestions only for the owner and binds them to the shared revision', () => {
  const owner = vault(),
    otherReader = vault(),
    id = sharingUUID()
  const input = {
    shareId: id,
    revision: sharingUUID(),
    name: 'Reader',
    text: 'Try investigating the cause',
  }
  const suggestion = encryptSuggestion(input, sharingReaderKeys(owner).suggestionKey)
  expect(JSON.stringify(suggestion)).not.toContain(input.text)
  expect(decryptSuggestion(id, suggestion, owner.suggestionSecret)).toEqual(input)
  expect(() => decryptSuggestion(id, suggestion, otherReader.suggestionSecret)).toThrow('decrypt')
  expect(() => decryptSuggestion(sharingUUID(), suggestion, owner.suggestionSecret)).toThrow(
    'another',
  )
  expect(() =>
    decryptSuggestion(id, { ...suggestion, revision: sharingUUID() }, owner.suggestionSecret),
  ).toThrow('another')
})
it('publishes only explicit conversation fields and excludes delegated system results', () => {
  const value = sharedThreadContent({
    title: 'Thread',
    messages: [
      { id: '1', role: 'user', text: 'Prompt' },
      { id: '2', role: 'assistant', text: 'Answer' },
      { id: '3', role: 'user', text: 'Private child report', subagentResultId: 'child' },
      { id: '4', role: 'assistant', text: '' },
    ],
  })
  expect(value.messages.map((message) => message.id)).toEqual(['1', '2'])
  expect(JSON.stringify(value)).not.toContain('Private child')
})
