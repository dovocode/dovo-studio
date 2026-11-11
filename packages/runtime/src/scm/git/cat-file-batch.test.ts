import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vite-plus/test'
import { exec } from '../../process.js'
import { fixture } from '../../testing/fixture.js'
import { GitBlobReader } from './cat-file-batch.js'

it('reports a missing object and cleans up its process', async () => {
  const f = await fixture()
  const reader = new GitBlobReader('git', f.directory)
  try {
    await expect(reader.text('0'.repeat(40), 1)).rejects.toThrow('Unexpected Git blob header')
  } finally {
    await reader.close()
    await f.cleanup()
  }
})

it('reports a missing executable without hanging cleanup', async () => {
  const reader = new GitBlobReader('/dovo-no-such-git-executable', tmpdir())
  try {
    await expect(reader.text('0'.repeat(40), 1)).rejects.toThrow('ENOENT')
  } finally {
    await reader.close()
  }
})

it.skipIf(process.platform === 'win32')(
  'interrupts a stalled blob read and awaits process cleanup',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-stalled-git-'))
    const executable = join(root, 'git')
    await writeFile(executable, '#!/bin/sh\nexec sleep 60\n')
    await chmod(executable, 0o755)
    const controller = new AbortController()
    const reader = new GitBlobReader(executable, root, controller.signal)
    try {
      const pending = reader.text('0'.repeat(40), 1)
      controller.abort()
      await expect(pending).rejects.toThrow('aborted')
    } finally {
      await reader.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)

async function store(directory: string, name: string, bytes: Buffer) {
  await writeFile(join(directory, name), bytes)
  return (await exec('git', ['hash-object', '-w', '--', name], { cwd: directory })).stdout.trim()
}

it('returns exact raw bytes in request order and survives a missing object', async () => {
  const f = await fixture()
  const reader = new GitBlobReader('git', f.directory)
  try {
    const blobs = [
      Buffer.from([0, 255, 254, 10, 0, 13, 10]),
      Buffer.alloc(0),
      Buffer.from('héllo → wörld\n'),
      // Larger than one pipe chunk, and ending without a newline.
      Buffer.from(Array.from({ length: 200 * 1024 }, (_, index) => index % 251)),
    ]
    const hashes = await Promise.all(
      blobs.map((bytes, i) => store(f.directory, `blob-${i}`, bytes)),
    )
    const missing = reader.bytes('0'.repeat(40), 1)
    const read = Promise.all(hashes.map((hash, i) => reader.bytes(hash, blobs[i].length)))
    await expect(missing).rejects.toThrow('Unexpected Git blob header')
    expect(await read).toEqual(blobs)
    // The classifying text API still collapses binary bodies and does not alter raw reads.
    expect(await reader.text(hashes[0], blobs[0].length)).toBe('\0')
    expect(await reader.bytes(hashes[0], blobs[0].length)).toEqual(blobs[0])
    expect(await reader.text(hashes[2], blobs[2].length)).toBe('héllo → wörld\n')
  } finally {
    await reader.close()
    await f.cleanup()
  }
})

it('rejects unbounded requests and fails closed after a size mismatch', async () => {
  const f = await fixture()
  let started = 0
  const reader = new GitBlobReader('git', f.directory, undefined, () => started++)
  try {
    const hash = await store(f.directory, 'blob', Buffer.from('twelve bytes'))
    await expect(reader.bytes(hash, 256 * 1024 + 1)).rejects.toThrow('Invalid bounded')
    await expect(reader.bytes('HEAD', 1)).rejects.toThrow('Invalid bounded')
    expect(started).toBe(0)
    // The unread body would otherwise be parsed as the reply to the next request.
    await expect(reader.bytes(hash, 3)).rejects.toThrow('Unexpected Git blob header')
    await expect(reader.bytes(hash, 12)).rejects.toThrow('Unexpected Git blob header')
    expect(started).toBe(1)
  } finally {
    await reader.close()
    await f.cleanup()
  }
})

it('closes before a queued read starts without spawning another process', async () => {
  let started = 0
  const reader = new GitBlobReader('git', tmpdir(), undefined, () => started++)
  const pending = reader.bytes('0'.repeat(40), 1)
  await reader.close()
  await expect(pending).rejects.toThrow('closed')
  await expect(reader.bytes('0'.repeat(40), 1)).rejects.toThrow('closed')
  expect(started).toBe(0)
})
