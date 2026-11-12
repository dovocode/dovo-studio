import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSecureCommand } from './secure-command.js'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
it('stops and reaps a stdin consumer on cancellation without forwarding its secret output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-secure-command-'))
  directories.push(directory)
  const marker = join(directory, 'pid')
  const controller = new AbortController()
  const command = {
    kind: 'command' as const,
    command: process.execPath,
    args: [
      '-e',
      `process.stdin.once('data',value=>{process.stdout.write(value);process.stderr.write(value);require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)})`,
    ],
    appendNewline: true,
  }
  const outcome = runSecureCommand(
    command,
    directory,
    'synthetic-private-value',
    controller.signal,
  ).then(
    () => 'completed',
    (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'),
  )
  let pid = 0
  await vi.waitFor(async () => {
    pid = Number(await readFile(marker, 'utf8'))
    expect(pid).toBeGreaterThan(0)
  })
  controller.abort()
  expect(await outcome).toBe('Secure command did not complete.')
  expect(() => process.kill(pid, 0)).toThrow(/ESRCH|no such process/i)
})
