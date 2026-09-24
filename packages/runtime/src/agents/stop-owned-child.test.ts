import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { stopOwnedChild } from './stop-owned-child'

it.skipIf(process.platform === 'win32')(
  'awaits stubborn provider exit and includes writes made during graceful shutdown',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-owned-process-'))
    const file = join(directory, 'late.txt')
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
    process.on('SIGTERM', () => setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(file)}, 'saved'), 150));
    setInterval(() => {}, 1000);
    process.stdout.write('ready');
  `,
      ],
      { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    try {
      await once(child.stdout, 'data')
      const stopping = stopOwnedChild(child)
      expect(stopOwnedChild(child)).toBe(stopping)
      await stopping
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      expect(await readFile(file, 'utf8')).toBe('saved')
    } finally {
      await stopOwnedChild(child)
      await rm(directory, { recursive: true, force: true })
    }
  },
)
