import { afterEach, expect, test, vi } from 'vite-plus/test'
import {
  composerCaretRecoveryKey,
  composerRecoveryKey,
  createComposerRecovery,
} from './composer-recovery'
import { createComposerDraft } from '../../../extension-tasks/src/chat/composer/composer-draft'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function disk() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
  return data
}
test('a reload before debounce restores the exact offline draft', () => {
  vi.useFakeTimers()
  disk()
  const recovery = createComposerRecovery('thread')
  const write = vi.fn<(text: string) => void>()
  const draft = createComposerDraft('', write, vi.fn(), recovery.protect)
  draft.update('Offline\nunsent text')
  expect(write).not.toHaveBeenCalled()
  expect(createComposerRecovery('thread').text).toBe('Offline\nunsent text')
  draft.flush()
})
test('delayed acknowledgements cannot clear newer or identical remounted edits', () => {
  disk()
  const old = createComposerRecovery('thread')
  old.protect('Submitted')
  const reopened = createComposerRecovery('thread')
  reopened.protect('Submitted')
  old.protect('', 'Submitted')
  expect(createComposerRecovery('thread').text).toBe('Submitted')
  const checkpoint = reopened.checkpoint()
  reopened.protect('New text')
  reopened.retire(checkpoint)
  expect(createComposerRecovery('thread').text).toBe('New text')
})
test('storage failure reports an error while text remains in the controller', () => {
  disk()
  const recovery = createComposerRecovery('thread')
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new Error('quota')
    },
  })
  const error = vi.fn<(cause: unknown) => void>()
  const draft = createComposerDraft('', vi.fn(), error, recovery.protect)
  draft.update('Keep me')
  expect(draft.text).toBe('Keep me')
  expect(error).toHaveBeenCalled()
  expect(() => draft.flush()).toThrow('quota')
  disk()
  draft.flush()
  expect(createComposerRecovery('thread').text).toBe('Keep me')
})
test('keys isolate credentials, computers and thread identities without plaintext tokens', () => {
  const connection = { address: 'http://lan:3000', token: 'secret' }
  const key = composerRecoveryKey(connection, 'thread')
  expect(key).not.toContain('secret')
  expect(composerRecoveryKey({ ...connection, token: 'replacement' }, 'thread')).not.toBe(key)
  expect(composerRecoveryKey({ ...connection, address: 'http://vpn:3000' }, 'thread')).not.toBe(key)
  expect(composerRecoveryKey(connection, 'other')).not.toBe(key)
})

test('retired records keep revision identity without replaying already synced text', () => {
  disk()
  const old = createComposerRecovery('thread')
  old.protect('Submitted')
  const reopened = createComposerRecovery('thread')
  reopened.protect('Submitted')
  reopened.retire(reopened.checkpoint())
  expect(createComposerRecovery('thread').text).toBeNull()
  expect(createComposerRecovery('thread').backup).toBe('Submitted')
  expect(old.protect('', 'Submitted')).toBe(false)
})

test('an unflushed old send cannot replace a remounted composer', () => {
  disk()
  const oldRecovery = createComposerRecovery('thread')
  const write = vi.fn<(text: string) => void>()
  const old = createComposerDraft('', write, vi.fn(), oldRecovery.protect)
  old.update('Sent')
  const newRecovery = createComposerRecovery('thread')
  const current = createComposerDraft('Sent', write, vi.fn(), newRecovery.protect)
  current.update('New typing')
  old.accept('Sent')
  expect(write).not.toHaveBeenCalled()
  expect(createComposerRecovery('thread').text).toBe('New typing')
  current.flush()
})

test('caret scope includes the thread and does not expose credential-bearing history scope', () => {
  const scope = JSON.stringify(['runtime', 'http://lan:3000', 'secret-token'])
  expect(composerCaretRecoveryKey(scope, 'a')).not.toContain('secret-token')
  expect(composerCaretRecoveryKey(scope, 'a')).not.toBe(composerCaretRecoveryKey(scope, 'b'))
})
