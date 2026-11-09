import { describe, expect, it, vi } from 'vite-plus/test'
import { createDetailDrafts, detailDraftKey, integrationDraftKey } from './detail-drafts'
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
