import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { stopOwnedChild } from './stop-owned-child'

function killIfRunning(pid: number) {
  try {
    process.kill(pid)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

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

it.skipIf(process.platform !== 'win32')(
  'stops a Windows launcher and descendants that retain its output pipes',
  async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const {spawn}=require('node:child_process');
        const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],
          {stdio:['ignore',process.stdout,process.stderr]});
        process.stdout.write(String(descendant.pid));
        setInterval(()=>{},1000);`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let descendantPid: number | undefined
    try {
      const [data] = await once(child.stdout, 'data')
      descendantPid = Number(String(data))
      expect(Number.isInteger(descendantPid)).toBe(true)
      await stopOwnedChild(child)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      expect(() => process.kill(descendantPid!, 0)).toThrow(/ESRCH/)
      expect(child.stdout.readableEnded || child.stdout.destroyed).toBe(true)
    } finally {
      if (descendantPid) killIfRunning(descendantPid)
      await stopOwnedChild(child)
    }
  },
)
