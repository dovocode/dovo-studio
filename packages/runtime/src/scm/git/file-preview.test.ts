import { expect, it } from 'vitest'
import { createFilePreview } from './file-preview'

it('does not read oversized images and reports the saved size instead', async () => {
  let reads = 0
  const result = await createFilePreview(
    'large.png',
    { after: { hash: 'saved', size: 20 * 1024 * 1024, mode: '100644' } },
    async () => {
      reads++
      return Buffer.alloc(0)
    },
  )
  expect(reads).toBe(0)
  expect(result.after).toMatchObject({ kind: 'binary', size: 20 * 1024 * 1024 })
  expect(result.after?.notice).toContain('saved in full')
})
it('keeps UTF-8 prefix previews readable without inventing replacement characters', async () => {
  const text = Buffer.from('hello 🌍')
  const result = await createFilePreview(
    'text.txt',
    { before: { hash: 'old', size: text.length, mode: '100644' } },
    async () => text.subarray(0, text.length - 1),
  )
  expect(result.before).toMatchObject({ kind: 'text', text: 'hello ', truncated: true })
  expect(result.after).toBeUndefined()
})
it('classifies invalid UTF-8 as binary and exposes thumbnail decoder failures', async () => {
  const metadata = { after: { hash: 'saved', size: 2, mode: '100644' } }
  expect(
    await createFilePreview('binary.dat', metadata, async () => Buffer.from([0xff, 0xff])),
  ).toMatchObject({ after: { kind: 'binary' } })
  const result = await createFilePreview('broken.png', metadata, async () => Buffer.from([1, 2]))
  expect(result.after?.notice).toContain('Thumbnail unavailable')
})
