import { describe, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { runtimeProfile } from '@dovo/protocol'
import {
  computerDraftKey,
  computerIntegrationDraftKey,
  createDetailDrafts,
  detailDraftKey,
  detailDraftStorageLimit,
  deviceDraftKey,
  integrationDraftKey,
  type DetailDrafts,
  type DetailDraftStorage,
  type SavedDraftKey,
} from './detail-drafts'
vi.mock('react-native', () => ({ Alert: { alert: vi.fn<() => void>() } }))

const connection = { address: 'http://owner.local:8787', token: 'paired-device-secret' }
describe('native detail drafts', () => {
  it('separates owners, renewed pairings and entities while keeping HTTP supported', () => {
    const key = detailDraftKey(connection, 'repo', 7)
    expect(key).not.toBe(
      detailDraftKey({ ...connection, address: 'http://other.local' }, 'repo', 7),
    )
    expect(key).not.toBe(detailDraftKey({ ...connection, token: 'new-pairing' }, 'repo', 7))
    expect(key).not.toBe(detailDraftKey(connection, 'repo', 8))
    expect(integrationDraftKey(connection, null, 'repo', undefined, 'comment', 7)).not.toBe(
      integrationDraftKey(connection, null, 'other-repo', undefined, 'comment', 7),
    )
  })
  it('keeps unsaved text at capacity and admits a new draft after one is cleared', () => {
    const drafts = createDetailDrafts<{ body: string }>({ limit: 2 })
    drafts.write('a', { body: 'Unsent review' })
    drafts.write('b', { body: 'Other review' })
    expect(drafts.read('a')?.body).toBe('Unsent review')
    expect(drafts.write('c', { body: 'Third review' })).toBe(false)
    expect(drafts.read('b')?.body).toBe('Other review')
    expect(drafts.write('a', { body: 'Expanded unsent review' })).toBe(true)
    drafts.remove('b')
    expect(drafts.write('c', { body: 'Third review' })).toBe(true)
    drafts.remove('c')
    expect(drafts.read('c')).toBeUndefined()
    expect(drafts.read('a')?.body).toBe('Expanded unsent review')
  })
  it('evicts clean entries before unsaved text and never displaces text with an empty editor', () => {
    const drafts = createDetailDrafts<{ body: string }>({
      limit: 2,
      isClean: (draft) => !draft.body,
    })
    drafts.write('dirty', { body: 'Keep me' })
    drafts.write('empty', { body: '' })
    expect(drafts.write('next', { body: 'Also keep me' })).toBe(true)
    expect(drafts.read('empty')).toBeUndefined()
    expect(drafts.write('new-empty', { body: '' })).toBe(true)
    expect(drafts.read('new-empty')).toBeUndefined()
    expect(drafts.read('dirty')?.body).toBe('Keep me')
    expect(drafts.read('next')?.body).toBe('Also keep me')
  })
})

const commentSchema = Schema.Struct({ line: Schema.String, body: Schema.String })
type Comment = { line: string; body: string; attempt?: { id: string } }
const prefix = 'dovo.detail-drafts.v1.pull-line-comment:'
/** Device storage that outlives the JavaScript process, like AsyncStorage. */
function deviceStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const failures = { read: false, write: false }
  let reads: Promise<void> = Promise.resolve()
  const fail = (kind: keyof typeof failures) => {
    if (failures[kind]) throw new Error(`Storage ${kind} failed`)
  }
  return {
    values,
    failures,
    hold() {
      let release = () => {}
      reads = new Promise((resolve) => (release = resolve))
      return release
    },
    saved: (key: string) => {
      const raw = values.get(prefix + key)
      return raw === undefined ? undefined : (JSON.parse(raw) as unknown)
    },
    getAllKeys: vi.fn<DetailDraftStorage['getAllKeys']>(async () => {
      await reads
      fail('read')
      return [...values.keys()]
    }),
    getItem: vi.fn<DetailDraftStorage['getItem']>(async (key) => {
      fail('read')
      return values.get(key) ?? null
    }),
    setItem: vi.fn<DetailDraftStorage['setItem']>(async (key, value) => {
      fail('write')
      values.set(key, value)
    }),
    removeItem: vi.fn<DetailDraftStorage['removeItem']>(async (key) => {
      fail('write')
      values.delete(key)
    }),
  }
}
/** A new app process: a new in-memory store over the same device storage. */
const launch = (storage: DetailDraftStorage) =>
  createDetailDrafts<Comment>({
    isClean: (draft) => !draft.body,
    persist: { name: 'pull-line-comment', schema: commentSchema, storage },
  })
const settle = async () => {
  for (let count = 0; count < 10; count++) await new Promise((resolve) => setTimeout(resolve, 0))
}
/** Opens an editor the way `useDetailDraft` does, then waits for saved drafts to load. */
async function open<A>(drafts: DetailDrafts<A, SavedDraftKey>, key: SavedDraftKey) {
  const listener = vi.fn<() => void>()
  const unsubscribe = drafts.subscribe(key, listener)
  await settle()
  return { listener, unsubscribe }
}

describe('saved detail drafts', () => {
  const computer = runtimeProfile({ ...connection, runtimeId: 'runtime-a' })
  const review = computerIntegrationDraftKey(computer, null, 'repo', undefined, 'pull-line', 7)
  const other = computerIntegrationDraftKey(computer, null, 'repo', undefined, 'pull-line', 8)

  it('keeps unsent text after the app process ends and clears only the submitted draft', async () => {
    const storage = deviceStorage()
    const first = launch(storage)
    const empty = computerIntegrationDraftKey(computer, null, 'repo', undefined, 'pull-line', 9)
    await open(first, review)
    first.write(review, { line: '12', body: 'Unsent review', attempt: { id: 'receipt' } })
    first.write(other, { line: '3', body: 'Other review' })
    first.write(empty, { line: '4', body: '' })
    await settle()
    // The OS ends the process before submit. Empty editors and send receipts are not saved.
    expect(storage.saved(review)).toEqual({ line: '12', body: 'Unsent review' })
    expect(storage.saved(empty)).toBeUndefined()
    expect(JSON.stringify([...storage.values])).not.toContain(connection.token)

    const second = launch(storage)
    const { listener } = await open(second, review)
    expect(listener).toHaveBeenCalled()
    expect(second.read(review)).toEqual({ line: '12', body: 'Unsent review' })
    expect(second.storageStatus?.(review)).toBeUndefined()
    // Submitting removes that draft only.
    second.remove(review)
    await settle()
    const third = launch(storage)
    await open(third, review)
    expect(third.read(review)).toBeUndefined()
    expect(third.read(other)).toEqual({ line: '3', body: 'Other review' })
  })

  it('keeps a saved key for a renewed pairing of the same computer only', () => {
    const key = computerDraftKey(computer, 'repo', 7)
    expect(
      computerDraftKey(
        runtimeProfile({ ...computer.connection, token: 'renewed-pairing-token' }),
        'repo',
        7,
      ),
    ).toBe(key)
    expect(
      computerDraftKey(
        runtimeProfile({ ...computer.connection, runtimeId: 'runtime-b' }),
        'repo',
        7,
      ),
    ).not.toBe(key)
    expect(
      computerDraftKey(
        runtimeProfile({ ...computer.connection, address: 'http://other.local' }),
        'repo',
        7,
      ),
    ).not.toBe(key)
    expect(computerDraftKey(null, 'repo', 7)).not.toBe(key)
    expect(deviceDraftKey('repo', 7)).not.toBe(computerDraftKey(null, 'repo', 7))
    expect(key).not.toContain(connection.token)
    // HTTP stays a valid computer address for LAN and VPN pairings.
    expect(key).toContain('http://owner.local:8787')
  })

  it('keeps an edit made before saved drafts load and loads the others', async () => {
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '1', body: 'Older saved copy' }),
      [prefix + other]: JSON.stringify({ line: '2', body: 'Saved elsewhere' }),
    })
    const release = storage.hold()
    const drafts = launch(storage)
    drafts.read(review)
    drafts.write(review, { line: '1', body: 'Typed during startup' })
    release()
    await settle()
    expect(drafts.read(review)?.body).toBe('Typed during startup')
    expect(drafts.read(other)?.body).toBe('Saved elsewhere')
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Typed during startup' })
  })

  it('writes nothing over an unread saved draft while the first read is pending or fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '1', body: 'Saved, not read yet' }),
    })
    const release = storage.hold()
    const drafts = launch(storage)
    // No editor has read yet. The first change starts the read.
    drafts.write(review, { line: '1', body: 'Typed before the read' })
    expect(storage.getAllKeys).toHaveBeenCalledTimes(1)
    // A retry while the read is pending must not start a write or a second read.
    drafts.retryStorage?.()
    await settle()
    expect(storage.getAllKeys).toHaveBeenCalledTimes(1)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    // The pending read fails. The saved record stays as it was.
    storage.failures.read = true
    release()
    await settle()
    expect(drafts.storageStatus?.(review)).toBe('read-failed')
    expect(drafts.read(review)?.body).toBe('Typed before the read')
    drafts.retryStorage?.()
    drafts.write(review, { line: '1', body: 'Typed during the failure' })
    await settle()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Saved, not read yet' })
    // After a read works, the newer edit in memory is saved.
    storage.failures.read = false
    drafts.retryStorage?.()
    await settle()
    expect(drafts.storageStatus?.(review)).toBeUndefined()
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Typed during the failure' })
    warn.mockRestore()
  })

  it('lets a saved draft load over a default set before the read finishes', async () => {
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '9', body: 'Saved text' }),
    })
    const release = storage.hold()
    const drafts = launch(storage)
    // An editor effect fills a default before any editor reads. It is not an edit.
    drafts.initialize(review, { line: '1', body: '' })
    expect(drafts.read(review)?.line).toBe('1')
    release()
    await settle()
    expect(drafts.read(review)).toEqual({ line: '9', body: 'Saved text' })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(storage.saved(review)).toEqual({ line: '9', body: 'Saved text' })
  })

  it('keeps saved drafts when a default comes during a failed read, and restores them on retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '9', body: 'Saved text' }),
    })
    storage.failures.read = true
    const drafts = launch(storage)
    await open(drafts, review)
    drafts.initialize(review, { line: '1', body: '' })
    storage.failures.read = false
    drafts.retryStorage?.()
    await settle()
    expect(drafts.read(review)).toEqual({ line: '9', body: 'Saved text' })
    expect(storage.saved(review)).toEqual({ line: '9', body: 'Saved text' })
    warn.mockRestore()
  })

  it('keeps an edit typed during startup together with a default', async () => {
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '9', body: 'Older saved copy' }),
    })
    const release = storage.hold()
    const drafts = launch(storage)
    drafts.initialize(review, { line: '1', body: '' })
    drafts.write(review, { line: '1', body: 'Typed during startup' })
    release()
    await settle()
    expect(drafts.read(review)).toEqual({ line: '1', body: 'Typed during startup' })
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Typed during startup' })
  })

  it('keeps untouched saved fields when one field is edited before the read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const saved = { line: '9', body: 'Saved text' }
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify(saved),
      [prefix + other]: JSON.stringify(saved),
    })
    const release = storage.hold()
    const drafts = launch(storage)
    // The editor shows a blank form while the read is pending. The user edits one field.
    drafts.write(review, { line: '12', body: '' }, ['line'])
    drafts.write(other, { line: '', body: 'Typed during the failure' }, ['body'])
    storage.failures.read = true
    release()
    await settle()
    expect(drafts.storageStatus?.(review)).toBe('read-failed')
    storage.failures.read = false
    drafts.retryStorage?.()
    await settle()
    expect(drafts.read(review)).toEqual({ line: '12', body: 'Saved text' })
    expect(drafts.read(other)).toEqual({ line: '9', body: 'Typed during the failure' })
    expect(storage.saved(review)).toEqual({ line: '12', body: 'Saved text' })
    expect(storage.saved(other)).toEqual({ line: '9', body: 'Typed during the failure' })
    warn.mockRestore()
  })

  it('deletes a saved draft that is cleared before the read', async () => {
    const saved = JSON.stringify({ line: '9', body: 'Saved text' })
    const storage = deviceStorage({ [prefix + review]: saved, [prefix + other]: saved })
    const release = storage.hold()
    const drafts = launch(storage)
    drafts.write(review, { line: '12', body: '' }, ['line'])
    drafts.remove(review)
    // An edit after a clear starts a new draft. The cleared fields do not come back.
    drafts.remove(other)
    drafts.write(other, { line: '', body: 'New text' }, ['body'])
    release()
    await settle()
    expect(drafts.read(review)).toBeUndefined()
    expect(storage.saved(review)).toBeUndefined()
    expect(drafts.read(other)).toEqual({ line: '', body: 'New text' })
    expect(storage.saved(other)).toEqual({ line: '', body: 'New text' })
    const restarted = launch(storage)
    await open(restarted, review)
    expect(restarted.read(review)).toBeUndefined()
  })

  it('saves a default only with text, and never removes an unreadable record for it', async () => {
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: 3, body: { rich: 'text' } }),
      [prefix + other]: JSON.stringify({ line: '', body: 'Loaded text' }),
    })
    const drafts = launch(storage)
    await open(drafts, review)
    drafts.initialize(review, { line: '1', body: '' })
    drafts.initialize(other, { line: '2', body: 'Loaded text' })
    await settle()
    expect(drafts.storageStatus?.(review)).toBe('unreadable')
    expect(storage.saved(review)).toEqual({ line: 3, body: { rich: 'text' } })
    expect(storage.saved(other)).toEqual({ line: '2', body: 'Loaded text' })
  })

  it('shows a read failure, keeps saved drafts and restores them on retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '1', body: 'Saved before the failure' }),
    })
    storage.failures.read = true
    const drafts = launch(storage)
    const { listener } = await open(drafts, review)
    expect(drafts.storageStatus?.(review)).toBe('read-failed')
    expect(listener).toHaveBeenCalled()
    expect(drafts.read(review)).toBeUndefined()
    // Text typed during the failure stays in memory. Nothing is written until a read works.
    drafts.write(other, { line: '2', body: 'Typed during the failure' })
    await settle()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.saved(other)).toBeUndefined()
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Saved before the failure' })
    storage.failures.read = false
    drafts.retryStorage?.()
    await settle()
    expect(drafts.storageStatus?.(review)).toBeUndefined()
    expect(drafts.read(review)?.body).toBe('Saved before the failure')
    expect(drafts.read(other)?.body).toBe('Typed during the failure')
    const restarted = launch(storage)
    await open(restarted, review)
    expect(restarted.read(review)?.body).toBe('Saved before the failure')
    expect(restarted.read(other)?.body).toBe('Typed during the failure')
    warn.mockRestore()
  })

  it('retries a failed read when an editor opens again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '1', body: 'Saved' }),
    })
    storage.failures.read = true
    const drafts = launch(storage)
    const first = await open(drafts, review)
    first.unsubscribe()
    expect(drafts.storageStatus?.(review)).toBe('read-failed')
    storage.failures.read = false
    await open(drafts, review)
    expect(drafts.read(review)?.body).toBe('Saved')
    warn.mockRestore()
  })

  it('shows a write failure, keeps the text in memory and saves it on retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage()
    const drafts = launch(storage)
    const { listener } = await open(drafts, review)
    storage.failures.write = true
    listener.mockClear()
    drafts.write(review, { line: '5', body: 'Not saved yet' })
    await settle()
    expect(drafts.storageStatus?.(review)).toBe('write-failed')
    expect(listener).toHaveBeenCalled()
    expect(drafts.read(review)?.body).toBe('Not saved yet')
    expect(storage.saved(review)).toBeUndefined()
    storage.failures.write = false
    drafts.retryStorage?.()
    await settle()
    expect(drafts.storageStatus?.(review)).toBeUndefined()
    const restarted = launch(storage)
    await open(restarted, review)
    expect(restarted.read(review)?.body).toBe('Not saved yet')
    warn.mockRestore()
  })

  it('reports when a submitted draft could not be removed, and keeps its submission ID', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage()
    const schema = Schema.Struct({
      line: Schema.String,
      body: Schema.String,
      submissionId: Schema.optional(Schema.String),
    })
    const start = () =>
      createDetailDrafts<typeof schema.Type>({
        isClean: (draft) => !draft.body,
        persist: { name: 'pull-line-comment', schema, storage },
      })
    const drafts = start()
    // Before the first read, a settle waits for the read and the save.
    drafts.write(review, { line: '7', body: 'Posted text', submissionId: 'press-1' })
    await expect(drafts.settled?.(review)).resolves.toBeUndefined()
    expect(storage.saved(review)).toEqual({
      line: '7',
      body: 'Posted text',
      submissionId: 'press-1',
    })
    // The runtime accepts the comment, then the device rejects the removal.
    storage.failures.write = true
    drafts.remove(review)
    await expect(drafts.settled?.(review)).resolves.toBe('write-failed')
    expect(drafts.read(review)).toBeUndefined()
    // After a restart, the editor sees the ID and can ask the runtime before posting again.
    const restarted = start()
    await open(restarted, review)
    expect(restarted.read(review)?.submissionId).toBe('press-1')
    // A retry removes the saved copy.
    storage.failures.write = false
    drafts.retryStorage?.()
    await expect(drafts.settled?.(review)).resolves.toBeUndefined()
    expect(storage.saved(review)).toBeUndefined()
    warn.mockRestore()
  })

  it('settles only after a held write finishes, and never early', async () => {
    const storage = deviceStorage()
    const drafts = launch(storage)
    await open(drafts, review)
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const write = storage.setItem.getMockImplementation()!
    storage.setItem.mockImplementationOnce(async (key, value) => {
      await held
      await write(key, value)
    })
    drafts.write(review, { line: '1', body: 'Marked' })
    let settled: unknown = 'waiting'
    void drafts.settled?.(review).then((status) => (settled = status))
    await settle()
    expect(settled).toBe('waiting')
    expect(storage.saved(review)).toBeUndefined()
    release()
    await settle()
    expect(settled).toBeUndefined()
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Marked' })
  })

  it('settles at once after a failed read, without writing over saved drafts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: '1', body: 'Kept' }),
    })
    storage.failures.read = true
    const drafts = launch(storage)
    drafts.remove(review)
    await expect(drafts.settled?.(review)).resolves.toBe('read-failed')
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Kept' })
    warn.mockRestore()
  })

  it('keeps an unreadable record until the user replaces it', async () => {
    const storage = deviceStorage({
      [prefix + review]: JSON.stringify({ line: 3, body: { rich: 'text' } }),
      [prefix + other]: JSON.stringify({ line: '2', body: 'Readable' }),
    })
    const drafts = launch(storage)
    await open(drafts, review)
    expect(drafts.storageStatus?.(review)).toBe('unreadable')
    expect(drafts.read(other)?.body).toBe('Readable')
    expect(storage.saved(review)).toEqual({ line: 3, body: { rich: 'text' } })
    drafts.write(review, { line: '1', body: 'Replacement' })
    await settle()
    expect(drafts.storageStatus?.(review)).toBeUndefined()
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Replacement' })
  })

  it('keeps typed credentials and oversized text out of device storage', async () => {
    const resourceSchema = Schema.Struct({
      body: Schema.String,
      envValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    })
    const storage = deviceStorage()
    const drafts = createDetailDrafts<Schema.Schema.Type<typeof resourceSchema>>({
      persist: { name: 'bot-settings', schema: resourceSchema, storage },
    })
    const key = computerDraftKey(computer, 'bot', 'task')
    await open(drafts, key)
    const stored = () => storage.values.get(`dovo.detail-drafts.v1.bot-settings:${key}`)
    // The runtime sends saved credentials as references. They are safe to keep.
    drafts.write(key, { body: 'Role', envValues: { API_KEY: 'dovo-stored-secret:abc' } })
    await settle()
    expect(stored()).toContain('Role')
    expect(drafts.storageStatus?.(key)).toBeUndefined()
    drafts.write(key, { body: 'Role', envValues: { API_KEY: 'typed-secret-value' } })
    await settle()
    expect(drafts.storageStatus?.(key)).toBe('credential')
    // The older saved copy is removed, so it cannot come back in place of the newer text.
    expect(stored()).toBeUndefined()
    expect(JSON.stringify([...storage.values])).not.toContain('typed-secret-value')
    expect(drafts.read(key)?.envValues?.API_KEY).toBe('typed-secret-value')

    const comments = launch(storage)
    await open(comments, review)
    comments.write(review, { line: '1', body: 'x'.repeat(detailDraftStorageLimit) })
    await settle()
    expect(comments.storageStatus?.(review)).toBe('too-large')
    expect(storage.saved(review)).toBeUndefined()
    comments.write(review, { line: '1', body: 'Short again' })
    await settle()
    expect(comments.storageStatus?.(review)).toBeUndefined()
    expect(storage.saved(review)).toEqual({ line: '1', body: 'Short again' })
  })
})
