import { expect, it } from 'vite-plus/test'
import { decode, taskMetadataSchema, type ChangedFile } from '@dovo/protocol'
import { versionReviewedFiles } from './file-review-versions.js'

const initial = (files: ChangedFile[]) =>
  versionReviewedFiles(
    decode(taskMetadataSchema, {
      id: 'task',
      title: 'Task',
      repositoryId: '',
      agentId: '',
      status: 'review',
      createdAt: '2026-11-11',
      draft: '',
      example: false,
      files,
    }),
  )
const file = { path: 'a.ts', before: 'old', after: 'new', viewed: true }

it('versions only the changed mark and retains marks for equivalent file inputs', () => {
  const before = initial([file, { ...file, path: 'b.ts' }])
  const next = versionReviewedFiles(
    {
      ...before,
      files: before.files.map((entry, index) =>
        index === 0 ? { ...entry, viewed: false } : entry,
      ),
    },
    before,
  )
  expect(next.fileReviewVersions?.['a.ts']).toBeGreaterThan(before.fileReviewVersion!)
  expect(next.fileReviewVersions?.['b.ts']).toBe(before.fileReviewVersions?.['b.ts'])
  const rescanned = versionReviewedFiles(
    {
      ...next,
      files: next.files.map((entry) => ({
        ...entry,
        diskContents: 'editor baseline',
        gitStatus: { index: 'modified', workingTree: 'unchanged' },
      })),
    },
    next,
  )
  expect(rescanned.fileReviewVersions).toEqual(next.fileReviewVersions)
  expect(rescanned.files.map((entry) => entry.viewed)).toEqual([false, true])
  const edited = versionReviewedFiles(
    {
      ...rescanned,
      files: rescanned.files.map((entry) =>
        entry.path === 'b.ts' ? { ...entry, after: 'edited' } : entry,
      ),
    },
    rescanned,
  )
  expect(edited.files[1].viewed).toBe(false)
  expect(edited.fileReviewVersions?.['b.ts']).toBeGreaterThan(next.fileReviewVersion!)
})

it('uses every preview identity field and preserves the review version through a rescan', () => {
  const preview = { kind: 'image' as const, after: { hash: 'a', size: 10, mode: '100644' } }
  const before = initial([{ ...file, before: '', after: '', preview }])
  const rescan = versionReviewedFiles(
    {
      ...before,
      files: [
        {
          ...before.files[0],
          preview: { after: { mode: '100644', size: 10, hash: 'a' }, kind: 'image' },
        },
      ],
    },
    before,
  )
  expect(rescan.fileReviewVersions).toEqual(before.fileReviewVersions)
  expect(rescan.files[0].viewed).toBe(true)
  for (const changed of [
    { ...preview, kind: 'binary' as const },
    { ...preview, after: { ...preview.after, hash: 'b' } },
    { ...preview, after: { ...preview.after, size: 20 } },
    { ...preview, after: { ...preview.after, mode: '100755' } },
  ]) {
    const next = versionReviewedFiles(
      { ...before, files: [{ ...before.files[0], preview: changed }] },
      before,
    )
    expect(next.files[0].viewed).toBe(false)
    expect(next.fileReviewVersions?.['a.ts']).toBeGreaterThan(before.fileReviewVersion!)
  }
})
