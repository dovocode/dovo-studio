import { expect, it } from 'vite-plus/test'
import { createFilePreview } from './file-preview'

it('computes complete compact diffs off-thread only when requested', async () => {
  const contents = { old: Buffer.from('old\n'), next: Buffer.from('new\n') }
  const metadata = {
    before: { hash: 'old', size: contents.old.length, mode: '100644' },
    after: { hash: 'next', size: contents.next.length, mode: '100644' },
  }
  const read = async (hash: string) => (hash === 'old' ? contents.old : contents.next)
  const preview = await createFilePreview('file.txt', metadata, read, false, true)
  expect(preview.patch).toContain('-old')
  expect(preview.patch).toContain('+new')
  expect((await createFilePreview('file.txt', metadata, read)).patch).toBeUndefined()
})

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

it('loads complete larger text only on request and rejects an incomplete full read', async () => {
  const text = Buffer.from('source line\n'.repeat(20000) + 'change past the compact prefix\n')
  const metadata = { after: { hash: 'saved', size: text.length, mode: '100644' } }
  const read = async (_hash: string, limit: number) => text.subarray(0, limit)
  expect((await createFilePreview('large.ts', metadata, read)).after).toMatchObject({
    truncated: true,
  })
  const full = await createFilePreview('large.ts', metadata, read, true, true)
  expect(full.after).toMatchObject({ truncated: false, text: text.toString() })
  expect(full.patch).toContain('+change past the compact prefix')
  await expect(
    createFilePreview('large.ts', metadata, async () => text.subarray(0, 100), true),
  ).rejects.toThrow('changed while loading')
})

it('enforces the expanded diff byte budget before reading oversized contents', async () => {
  let reads = 0
  await expect(
    createFilePreview(
      'huge.ts',
      {
        after: { hash: 'saved', size: 8 * 1024 * 1024 + 1, mode: '100644' },
      },
      async () => {
        reads++
        return Buffer.alloc(0)
      },
      true,
    ),
  ).rejects.toMatchObject({ status: 413 })
  expect(reads).toBe(0)
  const bytes = Buffer.alloc(8 * 1024 * 1024, 'x')
  expect(
    (
      await createFilePreview(
        'boundary.txt',
        {
          after: { hash: 'saved', size: bytes.length, mode: '100644' },
        },
        async () => bytes,
        true,
      )
    ).after?.truncated,
  ).toBe(false)
})
