// Runs against the public Terminals API only, so `pnpm prove` can run it on older commits.
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { Terminals } from './terminals'
import { TerminalRecovery } from './recovery'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const shell = { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-terminal-holder-'))
  // Agent integrations write into these folders. Keep them out of the host profile.
  for (const [key, folder] of [
    ['HOME', 'home'],
    ['CODEX_HOME', 'codex'],
    ['CLAUDE_CONFIG_DIR', 'claude'],
    ['PI_CODING_AGENT_DIR', 'pi'],
    ['XDG_CONFIG_HOME', 'config'],
  ] as const)
    vi.stubEnv(key, join(directory, folder))
  const db = openDatabase(join(directory, 'runtime.sqlite'))
  const recoveryDirectory = join(directory, 'recovery')
  const recovery = () => new TerminalRecovery(db, recoveryDirectory)
  const runtimes: Terminals[] = []
  const create = () => {
    const terminals = new Terminals(undefined, undefined, undefined, recovery())
    runtimes.push(terminals)
    return terminals
  }
  // Removing the folder removes the holder socket, so the holder ends its programs and exits.
  cleanups.push(async () => {
    for (const terminals of runtimes) await terminals.dispose().catch(() => {})
    db.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  await writeFile(
    join(directory, 'foreground.cjs'),
    `const fs = require('node:fs')
fs.appendFileSync('starts', process.pid + '\\n')
process.stdin.once('data', (data) => {
  fs.writeFileSync('finish', process.pid + ' ' + data.toString().trim() + '\\n')
  process.exit(0)
})`,
  )
  const marker = async (name: string) => {
    let text = ''
    await waitForRuntime(async () => {
      text = await readFile(join(directory, name), 'utf8')
      expect(text.endsWith('\n')).toBe(true)
    })
    return text
  }
  const open = (terminals: Terminals) =>
    terminals.createCommand(
      STUDIO_TERMINAL_SCOPE,
      directory,
      shell,
      'Remembered',
      undefined,
      undefined,
      { rememberSession: true },
    )
  const foreground = `"${process.execPath}" foreground.cjs\r`
  return { directory, create, marker, open, foreground }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it.skipIf(process.platform === 'win32')(
  'keeps a remembered shell and its foreground command through graceful and abrupt runtime exits',
  async () => {
    const f = await fixture()
    const first = f.create()
    const info = f.open(first)
    first.input(info.id, f.foreground)
    const pid = (await f.marker('starts')).trim()
    await waitForRuntime(() => expect(first.get(info.id).process?.pid).toBeGreaterThan(0))
    const shellPid = first.get(info.id).process!.pid
    await first.dispose()

    const second = f.create()
    expect(second.get(info.id).info).toMatchObject({ exited: false, dormant: false })
    await waitForRuntime(() => expect(second.get(info.id).process?.pid).toBe(shellPid))
    // The new runtime shows earlier output. The command does not run again.
    expect(second.get(info.id).buffer).toContain('foreground.cjs')

    // A runtime that stops without shutdown sends nothing. The next one takes over the holder.
    const third = f.create()
    await second.dispose()
    await waitForRuntime(() => expect(third.get(info.id).process?.pid).toBe(shellPid))
    third.input(info.id, 'continue\r')
    expect(await f.marker('finish')).toBe(`${pid} continue\n`)
    expect(await f.marker('starts')).toBe(`${pid}\n`)

    // Explicit close still ends the held shell, and a later runtime forgets it.
    await third.close(info.id)
    expect(alive(shellPid)).toBe(false)
    await third.dispose()
    expect(f.create().list()).toEqual([])
  },
)
