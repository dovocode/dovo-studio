/// <reference types="node" />
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vite-plus/test'
import { OwnedProcessShutdownError, stopOwnedChild } from './stop-owned-child'

function killIfRunning(pid: number) {
  try {
    process.kill(pid)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

it.skipIf(process.platform === 'win32')(
  'drains a provider that closes its pipes before exit is reaped',
  async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(2)'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    // On macOS, probing or signaling this group at EOF can return EPERM until
    // libuv reaps the process and the same probe starts returning ESRCH.
    child.stdout.resume()
    await once(child.stdout, 'end')
    await stopOwnedChild(child)
    expect(() => process.kill(-child.pid!, 0)).toThrow(/ESRCH/)
    await exited
    expect(child.exitCode).toBe(2)
  },
)

it.skipIf(process.platform === 'win32')(
  'keeps ownership through EPERM and requires proof of exit after the deadline',
  async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { detached: true })
    await once(child, 'exit')
    const kill = process.kill.bind(process)
    let denied = true
    const probe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -child.pid! && denied)
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      return kill(pid, signal)
    })
    vi.useFakeTimers()
    try {
      const stopping = stopOwnedChild(child)
      const failure = stopping.catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(2000)
      const error = await failure
      expect(error).toBeInstanceOf(OwnedProcessShutdownError)
      if (!(error instanceof OwnedProcessShutdownError)) throw error
      let confirmed = false
      void error.confirmed?.then(() => {
        confirmed = true
      })
      await vi.advanceTimersByTimeAsync(500)
      expect(confirmed).toBe(false)
      expect(stopOwnedChild(child)).toBe(stopping)
      denied = false
      await vi.advanceTimersByTimeAsync(250)
      await error.confirmed
      expect(confirmed).toBe(true)
      await expect(stopOwnedChild(child)).resolves.toBeUndefined()
    } finally {
      probe.mockRestore()
      vi.useRealTimers()
    }
  },
)

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
