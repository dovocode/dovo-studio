import { describe, expect, it } from 'vite-plus/test'
import { createDetailDrafts, detailDraftKey, integrationDraftKey } from './detail-drafts'

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
  it('evicts least recently used drafts and clears only the submitted draft', () => {
    const drafts = createDetailDrafts<{ body: string }>(2)
    drafts.write('a', { body: 'Unsent review' })
    drafts.write('b', { body: 'Other review' })
    expect(drafts.read('a')?.body).toBe('Unsent review')
    drafts.write('c', { body: 'Third review' })
    expect(drafts.read('b')).toBeUndefined()
    drafts.remove('c')
    expect(drafts.read('c')).toBeUndefined()
    expect(drafts.read('a')?.body).toBe('Unsent review')
  })
})
