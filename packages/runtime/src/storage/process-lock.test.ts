import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { acquireProcessLock } from './process-lock.js'

const directories: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-lock-race-'))
  directories.push(directory)
  return join(directory, 'runtime-process.lock')
}
it('admits only one stale-lock contender and recovers after that owner crashes', async () => {
  const path = fixture()
  writeFileSync(path, JSON.stringify({ pid: 2147483647, nonce: 'stale' }))
  const source = new URL('./process-lock.ts', import.meta.url).href
  const contenders = Array.from({ length: 6 }, () => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { acquireProcessLock } from ${JSON.stringify(source)};
      process.once('message', () => {
        try { acquireProcessLock(${JSON.stringify(path)}); process.send({ acquired: true }) }
        catch { process.send({ acquired: false }) }
      });
      process.send({ ready: true });
      setInterval(() => {}, 1000);
    `,
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    )
    children.push(child)
    return { child, ready: once(child, 'message') }
  })
  await Promise.all(contenders.map(({ ready }) => ready))
  const results = contenders.map(({ child }) => once(child, 'message'))
  for (const { child } of contenders) child.send('go')
  const received = await Promise.all(results)
  const winners = received.flatMap(([message], index) =>
    message.acquired ? [contenders[index].child] : [],
  )
  expect(winners).toHaveLength(1)
  expect(() => acquireProcessLock(path)).toThrow('Another runtime operation is active')
  const exited = once(winners[0], 'exit')
  winners[0].kill('SIGKILL')
  await exited
  const release = acquireProcessLock(path)
  release()
  release()
  acquireProcessLock(path)()
}, 10000)
