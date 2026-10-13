import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vite-plus/test'
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
