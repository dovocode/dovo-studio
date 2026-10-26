import { expect, it } from 'vite-plus/test'
import {
  changedFileFingerprint,
  pullFileFingerprint,
  reviewFileState,
  orderReviewFiles,
} from './review'
const file = { path: 'app.ts', before: 'old', after: 'new', viewed: false }
it('identifies the visible diff independently of viewed marks and editor disk baselines', () => {
  expect(changedFileFingerprint({ ...file, viewed: true, diskContents: 'disk' })).toBe(
    changedFileFingerprint(file),
  )
  expect(changedFileFingerprint({ ...file, before: 'older' })).not.toBe(
    changedFileFingerprint(file),
  )
  expect(changedFileFingerprint({ ...file, after: 'newer' })).not.toBe(changedFileFingerprint(file))
})
it('includes binary hashes and modes, with stable metadata key order', () => {
  const image = {
    ...file,
    before: '',
    after: '',
    preview: { kind: 'image' as const, after: { hash: 'a', size: 10, mode: '100644' } },
  }
  expect(
    changedFileFingerprint({
      ...image,
      preview: { after: { mode: '100644', hash: 'a', size: 10 }, kind: 'image' },
    }),
  ).toBe(changedFileFingerprint(image))
  expect(
    changedFileFingerprint({
      ...image,
      preview: { ...image.preview, after: { ...image.preview.after, hash: 'b' } },
    }),
  ).not.toBe(changedFileFingerprint(image))
})
it('retains unchanged text PR patches across pushes, but resets unavailable patches conservatively', () => {
  const pull = { headSha: 'head', baseSha: 'base' }
  const text = {
    path: 'app.ts',
    patch: '@@ -1 +1 @@\n-old\n+new',
    status: 'modified',
    additions: 1,
    deletions: 1,
  }
  expect(pullFileFingerprint(text, pull)).toBe(
    pullFileFingerprint(text, { ...pull, headSha: 'next' }),
  )
  expect(pullFileFingerprint({ ...text, patch: undefined }, pull)).not.toBe(
    pullFileFingerprint({ ...text, patch: undefined }, { ...pull, headSha: 'next' }),
  )
})
it('never shows viewed state for a different visible revision and ignores legacy dependency grouping', () => {
  const progress = {
    files: [{ path: file.path, fingerprint: 'old', viewed: true, version: 1 }],
    groups: [{ label: 'app', paths: ['types.ts', 'app.ts'], basis: 'ast' as const }],
  }
  expect(reviewFileState(progress, 'app.ts', 'new')).toBeUndefined()
  expect(
    orderReviewFiles([{ path: 'app.ts' }, { path: 'types.ts' }], progress.groups, true).map(
      (file) => file.path,
    ),
  ).toEqual(['app.ts', 'types.ts'])
})

it('requires feature groups to partition changed paths exactly once and preserves review order', async () => {
  const { featureReviewGroups, featureReviewSchema, decode } = await import('../index')
  const group = {
    label: 'Feature',
    summary: 'Change contract',
    impact: 'Inspect callers and tests',
    paths: ['app.ts', 'types.ts'],
  }
  const value = decode(featureReviewSchema, { groups: [group] })
  const groups = featureReviewGroups(value, ['types.ts', 'app.ts'])
  expect(groups[0]).toMatchObject({ ...group, basis: 'feature' })
  expect(
    orderReviewFiles([{ path: 'types.ts' }, { path: 'app.ts' }], groups, true).map(
      (file) => file.path,
    ),
  ).toEqual(['app.ts', 'types.ts'])
  expect(() =>
    featureReviewGroups({ groups: [{ ...group, paths: ['missing.ts'] }] }, ['app.ts']),
  ).toThrow(/unknown or duplicate/)
  expect(() =>
    featureReviewGroups({ groups: [{ ...group, paths: ['app.ts', 'app.ts'] }] }, ['app.ts']),
  ).toThrow(/unknown or duplicate/)
  expect(() =>
    featureReviewGroups({ groups: [{ ...group, paths: ['app.ts'] }] }, ['app.ts', 'types.ts']),
  ).toThrow(/omitted/)
  expect(() => decode(featureReviewSchema, { groups: [] })).toThrow(/at least 1/)
})

it('indexes review state without losing revision matching or first-match semantics', async () => {
  const { createReviewFileLookup } = await import('./review')
  const first = { path: 'app.ts', fingerprint: 'old', viewed: true, version: 1 }
  const current = { ...first, fingerprint: 'new', viewed: false, version: 2 }
  const progress = { files: [first, current, { ...first, viewed: false }], groups: [] }
  const lookup = createReviewFileLookup(progress)
  expect(lookup('app.ts', 'old')).toBe(first)
  expect(lookup('app.ts', 'new')).toBe(current)
  expect(lookup('app.ts', 'missing')).toBeUndefined()
  expect(lookup('other.ts', 'new')).toBeUndefined()
  expect(createReviewFileLookup(null)('app.ts', 'old')).toBeUndefined()
})
it('indexes renamed inline comments in timeline order, without duplicate aliases', async () => {
  const { pullCommentsByFile } = await import('./review')
  const files = [
    { path: 'new.ts', previousPath: 'old.ts', status: 'renamed', additions: 1, deletions: 0 },
    { path: 'same.ts', previousPath: 'same.ts', status: 'modified', additions: 1, deletions: 0 },
  ]
  const comments = ['old.ts', 'new.ts', 'same.ts', 'old.ts', 'unrelated.ts'].map((path, index) => ({
    id: String(index),
    kind: 'inline' as const,
    path,
    author: 'reviewer',
    body: 'Review',
    url: 'https://github.com/team/repo/pull/1',
    date: '',
  }))
  const ordinary = { ...comments[0]!, id: 'discussion', kind: 'comment' as const }
  const result = pullCommentsByFile(files, [...comments, ordinary])
  expect(result.get('new.ts')?.map((comment) => comment.id)).toEqual(['0', '1', '3'])
  expect(result.get('same.ts')?.map((comment) => comment.id)).toEqual(['2'])
  expect(result.has('unrelated.ts')).toBe(false)
})
