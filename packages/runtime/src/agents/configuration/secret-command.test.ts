/// <reference types="node" />
import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSecretCommand } from './secret-command.js'

it('preserves secret whitespace and never includes provider output in command errors', async () => {
  const signal = new AbortController().signal
  expect(
    await readSecretCommand(process.execPath, ['-e', 'process.stdout.write(" value\\n")'], signal),
  ).toBe(' value\n')
  await expect(
    readSecretCommand(
      process.execPath,
      [
        '-e',
        'process.stdout.write("private-value");process.stderr.write("private-error");process.exitCode=1',
      ],
      signal,
    ),
  ).rejects.toThrow('Secret provider command failed')
})

it('bounds output and rejects cancellation before spawning', async () => {
  const signal = new AbortController().signal
  await expect(
    readSecretCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(140000))'], signal),
  ).rejects.toThrow('output limit exceeded')
  const controller = new AbortController()
  controller.abort(new Error('Cancelled before spawn'))
  await expect(
    readSecretCommand('command-that-must-not-start', [], controller.signal),
  ).rejects.toThrow('Cancelled before spawn')
})

it('waits for a SIGTERM-ignoring CLI to exit after cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-secret-command-'))
  const ready = join(directory, 'ready'),
    controller = new AbortController()
  let pid: number | undefined, descendant: number | undefined
  const result = readSecretCommand(
    process.execPath,
    [
      '-e',
      `const fs=require('node:fs'),{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const code='process.on("SIGTERM",()=>process.exit(0));require("node:fs").writeFileSync(process.argv[1],JSON.stringify({pid:Number(process.argv[2]),descendant:process.pid}));setInterval(()=>{},1000)';spawn(process.execPath,['-e',code,process.argv[1],String(process.pid)],{stdio:'inherit'});setInterval(()=>{},1000)`,
      ready,
    ],
    controller.signal,
  )
  const outcome = result.then(
    () => undefined,
    (error: unknown) => error,
  )
  try {
    await vi.waitFor(async () => {
      const values: unknown = JSON.parse(await readFile(ready, 'utf8'))
      if (
        !values ||
        typeof values !== 'object' ||
        !('pid' in values) ||
        typeof values.pid !== 'number' ||
        !('descendant' in values) ||
        typeof values.descendant !== 'number'
      )
        throw new Error('Invalid probe readiness')
      pid = values.pid
      descendant = values.descendant
      expect(pid).toBeGreaterThan(0)
    })
    controller.abort()
    expect(await outcome).toMatchObject({ message: 'Secret provider cancelled' })
    expect(() => process.kill(pid!, 0)).toThrow('ESRCH')
    expect(() => process.kill(descendant!, 0)).toThrow('ESRCH')
  } finally {
    controller.abort()
    await result.catch(() => {})
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* Already exited. */
      }
    }
    await rm(directory, { recursive: true, force: true })
  }
})
