import { mkdtemp, open, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { readBoundedFile } from './bounded-file-read.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function withFile(
  contents: string,
  test: (handle: Awaited<ReturnType<typeof open>>) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-bounded-read-'))
  directories.push(directory)
  const path = join(directory, 'file')
  await writeFile(path, contents)
  const handle = await open(path, 'r')
  try {
    await test(handle)
  } finally {
    await handle.close()
  }
}

it('returns complete small files and bounded UTF-8 prefixes', async () => {
  await withFile('aé\nsecond\n', async (handle) => {
    expect(await readBoundedFile(handle, 'file', {})).toEqual({
      path: 'file',
      contents: 'aé\nsecond\n',
      size: 11,
      complete: true,
      truncated: false,
      startLine: 1,
      hasMore: false,
    })
    expect(await readBoundedFile(handle, 'file', { maxBytes: 2 })).toMatchObject({
      contents: 'a',
      complete: false,
      truncated: true,
    })
  })
})

it('reads a later line without transferring the earlier contents', async () => {
  const contents = `${'x'.repeat(70000)}\nsecond\nthird\n`
  await withFile(contents, async (handle) => {
    expect(await readBoundedFile(handle, 'file', { startLine: 2, maxBytes: 7 })).toMatchObject({
      contents: 'second\n',
      startLine: 2,
      size: Buffer.byteLength(contents),
      complete: false,
    })
  })
})

it('rejects binary data and invalid windows', async () => {
  await withFile('a\0b', async (handle) => {
    await expect(readBoundedFile(handle, 'file', {})).rejects.toMatchObject({ status: 415 })
    await expect(readBoundedFile(handle, 'file', { maxBytes: 0 })).rejects.toMatchObject({
      status: 400,
    })
    await expect(readBoundedFile(handle, 'file', { startLine: 0 })).rejects.toMatchObject({
      status: 400,
    })
  })
})

it('enforces the file size limit before reading', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-bounded-read-'))
  directories.push(directory)
  const path = join(directory, 'large')
  await writeFile(path, '')
  await truncate(path, 100 * 1024 * 1024 + 1)
  const handle = await open(path, 'r')
  try {
    await expect(readBoundedFile(handle, 'large', {})).rejects.toMatchObject({ status: 413 })
  } finally {
    await handle.close()
  }
})
