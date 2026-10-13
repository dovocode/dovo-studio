import { Effect, Fiber } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vite-plus/test'
import { execFile } from 'node:child_process'
import { exec, execEffect, processEnvironment, ProcessError } from './process.js'

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, execFile: vi.fn<typeof original.execFile>(original.execFile) }
})

it('preserves text, binary output and native exit details at the boundary', async () => {
  expect(await exec(process.execPath, ['-e', 'process.stdout.write("hello")'])).toEqual({
    stdout: 'hello',
    stderr: '',
  })
  expect(execFile).toHaveBeenLastCalledWith(
    process.execPath,
    ['-e', 'process.stdout.write("hello")'],
    expect.objectContaining({ windowsHide: true }),
    expect.any(Function),
  )
  const binary = await exec(
    process.execPath,
    ['-e', 'process.stdout.write(Buffer.from([0, 255]))'],
    { encoding: 'buffer' },
  )
  expect(binary.stdout).toEqual(Buffer.from([0, 255]))
  await expect(
    exec(process.execPath, ['-e', 'process.stderr.write("failure");process.exit(7)']),
  ).rejects.toMatchObject({ _tag: 'ProcessError', code: 7, stderr: 'failure' })
  await expect(exec('dovo-nonexistent-test-executable')).rejects.toBeInstanceOf(ProcessError)
})

it('kills and reaps an interrupted subprocess before completing interruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-effect-process-test-'))
  const path = join(directory, 'pid')
  const script =
    'require("node:fs").writeFileSync(process.argv[1], String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'
  const fiber = Effect.runFork(execEffect(process.execPath, ['-e', script, path]))
  try {
    let pid = 0
    await vi.waitFor(async () => {
      pid = Number(await readFile(path, 'utf8'))
      expect(pid).toBeGreaterThan(0)
    })
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
    await rm(directory, { recursive: true, force: true })
  }
})

it('never forwards a Meta API key to child processes', () => {
  const previous = process.env.META_API_KEY
  process.env.META_API_KEY = 'inherited-secret'
  try {
    expect(processEnvironment().META_API_KEY).toBeUndefined()
    expect(processEnvironment({ META_API_KEY: 'explicit-secret' }).META_API_KEY).toBeUndefined()
    expect(processEnvironment({ meta_api_key: 'lowercase-secret' })).not.toHaveProperty(
      'meta_api_key',
    )
    expect(processEnvironment({ OTHER_TOKEN: 'kept' }).OTHER_TOKEN).toBe('kept')
  } finally {
    if (previous === undefined) delete process.env.META_API_KEY
    else process.env.META_API_KEY = previous
  }
})
