import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { Terminals } from './terminals'
import { TerminalRecovery, recoveryCommand, validateRecoveryShell } from './recovery'
import { installRecoveryIntegrations, recoveryLauncherSource } from './recovery-integrations'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
afterEach(() => vi.unstubAllEnvs())

async function fixture({ symlinkRecovery = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-terminal-recovery-'))
  for (const [key, folder] of [
    ['CODEX_HOME', 'codex'],
    ['CLAUDE_CONFIG_DIR', 'claude'],
    ['PI_CODING_AGENT_DIR', 'pi'],
    ['XDG_CONFIG_HOME', 'config'],
  ])
    vi.stubEnv(key!, join(directory, folder!))
  const db = openDatabase(join(directory, 'runtime.sqlite'))
  const recoveryDirectory = join(directory, 'recovery')
  if (symlinkRecovery) {
    const actual = join(directory, 'actual-recovery')
    await mkdir(actual)
    await symlink(actual, recoveryDirectory, 'dir')
  }
  const create = () =>
    new Terminals(undefined, undefined, undefined, new TerminalRecovery(db, recoveryDirectory))
  const hook = (id: string, provider: string, sessionId: string, ended = false) => {
    const result = spawnSync(process.execPath, [join(recoveryDirectory, 'report.cjs'), provider], {
      env: { ...process.env, DOVO_TERMINAL_RECOVERY_DIRECTORY: join(recoveryDirectory, id) },
      input: JSON.stringify({
        session_id: sessionId,
        cwd: directory,
        hook_event_name: ended ? 'SessionEnd' : 'SessionStart',
      }),
      encoding: 'utf8',
      timeout: 3000,
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
  return {
    directory,
    db,
    recoveryDirectory,
    create,
    hook,
    cleanup: async () => {
      db.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

it('preserves user hooks, is idempotent, scopes reporting to Dovo and respects shutdown', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.directory, 'codex'), { recursive: true })
    const userHook = {
      matcher: 'startup',
      hooks: [{ type: 'command', command: 'my-existing-hook' }],
    }
    await writeFile(
      join(f.directory, 'codex', 'hooks.json'),
      JSON.stringify({ description: 'My hooks', hooks: { SessionStart: [userHook] } }),
    )
    installRecoveryIntegrations(f.recoveryDirectory)
    installRecoveryIntegrations(f.recoveryDirectory)
    const config = JSON.parse(await readFile(join(f.directory, 'codex', 'hooks.json'), 'utf8'))
    expect(config.description).toBe('My hooks')
    expect(config.hooks.SessionStart).toHaveLength(2)
    expect(config.hooks.SessionStart[0]).toEqual(userHook)
    const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
    const id = '12345678-1234-4234-8234-123456789abc'
    recovery.environment(id, process.env.PATH ?? '')
    f.hook(id, 'codex', 'exact-conversation')
    expect(recovery.event(id)).toMatchObject({ provider: 'codex', sessionId: 'exact-conversation' })
    f.hook(id, 'codex', 'different-conversation', true)
    expect(recovery.event(id)).toMatchObject({ sessionId: 'exact-conversation' })
    recovery.freeze(id)
    f.hook(id, 'codex', 'exact-conversation', true)
    expect(recovery.event(id)).toMatchObject({ sessionId: 'exact-conversation' })
    recovery.environment(id, '')
    f.hook(id, 'claude', 'other-conversation')
    f.hook(id, 'claude', 'other-conversation', true)
    expect(recovery.event(id)).toBeNull()
    vi.stubEnv('DOVO_TERMINAL_RECOVERY_DIRECTORY', '')
    const unrelated = spawnSync(
      process.execPath,
      [join(f.recoveryDirectory, 'report.cjs'), 'codex'],
      {
        input: JSON.stringify({ session_id: 'outside-dovo', cwd: f.directory }),
        encoding: 'utf8',
      },
    )
    expect(unrelated.status).toBe(0)
    expect(recovery.event(id)).toBeNull()
  } finally {
    await f.cleanup()
  }
})

for (const provider of ['codex', 'claude', 'pi', 'opencode', 'tmux', 'herdr'] as const)
  it(`builds an exact ${provider} recovery without a latest-session fallback`, () => {
    const sessionId =
      provider === 'pi' ? join(tmpdir(), "session's file.jsonl") : 'exact-conversation'
    const command = recoveryCommand({ provider, sessionId, directory: tmpdir() }, '/bin/bash')
    expect(command).toContain(provider === 'herdr' ? 'hc' : provider)
    expect(command).toContain('exact-conversation' === sessionId ? sessionId : 'session')
    expect(command).not.toContain('--last')
    expect(command).not.toContain('--continue')
  })

it('does not replay shell startup commands or permit a terminal control sequence in a recovery ID', () => {
  expect(() =>
    validateRecoveryShell({ command: '/bin/bash', args: ['-c', 'deploy-production'] }),
  ).toThrow('startup command')
  expect(() =>
    recoveryCommand(
      { provider: 'codex', sessionId: 'id\rdeploy', directory: tmpdir() },
      '/bin/bash',
    ),
  ).toThrow('Invalid')
  expect(
    recoveryCommand(
      { provider: 'claude', sessionId: 'exact-id', directory: tmpdir() },
      'powershell.exe',
    ),
  ).toBe("& 'claude' '--resume' 'exact-id'")
})

it('loads Pi and OpenCode adapters and records the exact selected session, excluding child sessions', async () => {
  const f = await fixture()
  try {
    const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
    const id = '12345678-1234-4234-8234-123456789abc'
    Object.entries(recovery.environment(id, '')).forEach(([key, value]) => vi.stubEnv(key, value))
    type Context = { cwd: string; sessionManager: { getSessionFile: () => string } }
    const handlers = new Map<string, (event: object, context: Context) => void>()
    const pi: {
      default: (api: {
        on: (event: string, handler: (event: object, context: Context) => void) => void
      }) => void
    } = await import(
      pathToFileURL(join(f.directory, 'pi/extensions/dovo-terminal-recovery.ts')).href
    )
    pi.default({ on: (name, handler) => handlers.set(name, handler) })
    const context = {
      cwd: f.directory,
      sessionManager: { getSessionFile: () => join(f.directory, 'pi-session.jsonl') },
    }
    handlers.get('session_start')!({}, context)
    expect(recovery.event(id)).toEqual({
      provider: 'pi',
      sessionId: context.sessionManager.getSessionFile(),
      directory: f.directory,
    })
    handlers.get('session_shutdown')!({}, context)
    expect(recovery.event(id)).toBeNull()
    const plugin: {
      DovoTerminalRecovery: (context: { directory: string }) => Promise<{
        event: (input: {
          event: { type: string; properties: { info: { id: string; parentID?: string } } }
        }) => Promise<void>
        'chat.message': (input: { sessionID: string }) => Promise<void>
      }>
    } = await import(
      pathToFileURL(join(f.directory, 'config/opencode/plugins/dovo-terminal-recovery.js')).href
    )
    const hooks = await plugin.DovoTerminalRecovery({ directory: f.directory })
    await hooks.event({
      event: { type: 'session.created', properties: { info: { id: 'child', parentID: 'root' } } },
    })
    expect(recovery.event(id)).toBeNull()
    await hooks['chat.message']({ sessionID: 'ses_exact_existing' })
    expect(recovery.event(id)).toMatchObject({
      provider: 'opencode',
      sessionId: 'ses_exact_existing',
    })
    recovery.freeze(id)
  } finally {
    await f.cleanup()
  }
})

it.skipIf(process.platform === 'win32')(
  'skips its own launcher when PATH contains a symlink alias of its installation',
  async () => {
    const f = await fixture({ symlinkRecovery: true })
    try {
      installRecoveryIntegrations(f.recoveryDirectory)
      const bin = join(f.directory, 'tools')
      await mkdir(bin)
      const native = join(bin, 'tmux')
      await writeFile(native, '#!/bin/sh\n', { mode: 0o700 })
      const probe = vi.fn<
        (file: string, args: string[], options: object) => { status: number; stdout: string }
      >(() => ({ status: 0, stdout: 'native-session\n' }))
      const spawn = vi.fn<(file: string, args: string[], options: object) => EventEmitter>(
        () => new EventEmitter(),
      )
      const nodeRequire = createRequire(import.meta.url)
      runInNewContext(recoveryLauncherSource, {
        __dirname: realpathSync(f.recoveryDirectory),
        require: (name: string) =>
          name === 'node:child_process'
            ? { spawnSync: probe, spawn }
            : name === './report.cjs'
              ? { report: () => {} }
              : nodeRequire(name),
        process: {
          argv: ['node', 'launch.cjs', 'tmux', 'attach', '-t', 'given-name'],
          env: { PATH: join(f.recoveryDirectory, 'bin') + ':' + bin },
          cwd: () => f.directory,
          on: () => {},
          exit: (code: number) => {
            throw new Error(`Unexpected launcher exit: ${code}`)
          },
        },
        console,
      })
      expect(probe.mock.calls[0]?.[0]).toBe(native)
      expect(spawn.mock.calls[0]?.[0]).toBe(native)
    } finally {
      await f.cleanup()
    }
  },
)

for (const program of ['tmux', 'hc'] as const)
  it.skipIf(process.platform === 'win32')(
    `reattaches to the canonical ${program} target without rerunning its workload`,
    async () => {
      const f = await fixture({ symlinkRecovery: true })
      let terminals = f.create()
      try {
        const bin = join(f.directory, 'bin')
        await mkdir(bin)
        await writeFile(
          join(bin, program),
          `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'display-message') { console.log('actual-tmux-session'); process.exit(0); }
if (args[0] === 'get') { console.log(JSON.stringify({address:'t7'})); process.exit(0); }
console.log('ATTACHED:' + args.join('|')); setInterval(() => {}, 1000);
`,
          { mode: 0o700 },
        )
        vi.stubEnv('PATH', bin + ':' + process.env.PATH)
        const info = terminals.createCommand(
          STUDIO_TERMINAL_SCOPE,
          f.directory,
          { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
          'Multiplexer',
          undefined,
          undefined,
          { rememberSession: true },
        )
        terminals.input(
          info.id,
          program === 'tmux' ? 'tmux attach -t given-name\r' : 'hc attach given-name\r',
        )
        await waitForRuntime(() =>
          expect(terminals.get(info.id).info.recoveryProgram).toBe(
            program === 'tmux' ? 'tmux' : 'herdr',
          ),
        )
        await terminals.dispose()
        terminals = f.create()
        await waitForRuntime(() =>
          expect(terminals.get(info.id).buffer).toContain(
            program === 'tmux'
              ? 'ATTACHED:attach-session|-t|actual-tmux-session'
              : 'ATTACHED:attach|t7',
          ),
        )
        expect(terminals.get(info.id).buffer).not.toContain('given-name')
      } finally {
        await terminals.dispose()
        await f.cleanup()
      }
    },
  )

it.skipIf(process.platform === 'win32')(
  'recovers concurrent conversations under the same terminal IDs, keeps settled sessions asleep, and forgets closed sessions',
  async () => {
    const f = await fixture()
    let terminals = f.create()
    try {
      const bin = join(f.directory, 'bin')
      await mkdir(bin)
      await writeFile(
        join(bin, 'codex'),
        `#!/usr/bin/env node\nconsole.log('RESUMED:' + process.argv[3]); setInterval(() => {}, 1000);\n`,
        { mode: 0o700 },
      )
      vi.stubEnv('PATH', bin + ':' + process.env.PATH)
      const open = () =>
        terminals.createCommand(
          STUDIO_TERMINAL_SCOPE,
          f.directory,
          {
            command: '/bin/bash',
            args: ['--noprofile', '--norc', '-i'],
            env: { TEST_SECRET: 'do-not-save-this' },
          },
          'My terminal',
          undefined,
          undefined,
          { rememberSession: true },
        )
      const first = open(),
        second = open()
      f.hook(first.id, 'codex', 'conversation-one')
      f.hook(second.id, 'codex', 'conversation-two')
      await waitForRuntime(() =>
        expect(terminals.list().every((info) => info.recoveryProgram === 'codex')).toBe(true),
      )
      await terminals.update({ id: second.id, title: 'Parked work', pinned: true, settled: true })
      await terminals.dispose()
      expect(
        JSON.stringify(
          f.db.prepare('SELECT value FROM documents WHERE id = ?').get('terminal-recovery:v1'),
        ),
      ).not.toContain('do-not-save-this')
      terminals = f.create()
      await waitForRuntime(() =>
        expect(terminals.get(first.id).buffer).toContain('RESUMED:conversation-one'),
      )
      expect(terminals.get(first.id).buffer).not.toContain('conversation-two')
      expect(terminals.get(second.id).process).toBeUndefined()
      expect(terminals.get(second.id).info).toMatchObject({
        title: 'Parked work',
        pinned: true,
        dormant: true,
        exited: false,
      })
      await terminals.update({ id: second.id, settled: false })
      await waitForRuntime(() =>
        expect(terminals.get(second.id).buffer).toContain('RESUMED:conversation-two'),
      )
      await terminals.close(first.id)
      await terminals.dispose()
      terminals = f.create()
      expect(terminals.list().map((info) => info.id)).toEqual([second.id])
      await waitForRuntime(() =>
        expect(terminals.get(second.id).buffer).toContain('RESUMED:conversation-two'),
      )
    } finally {
      await terminals.dispose()
      await f.cleanup()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'retains a failed recovery visibly and never reruns an ordinary shell command',
  async () => {
    const f = await fixture()
    let terminals = f.create()
    try {
      const cwd = join(f.directory, 'checkout')
      await mkdir(cwd)
      const info = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        cwd,
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Shell',
        undefined,
        undefined,
        { rememberSession: true },
      )
      const once = join(f.directory, 'once')
      terminals.input(info.id, `echo once >> '${once}'\r`)
      await waitForRuntime(() => expect(existsSync(once)).toBe(true))
      await terminals.dispose()
      terminals = f.create()
      await waitForRuntime(() => expect(terminals.get(info.id).process).toBeDefined())
      expect(await readFile(once, 'utf8')).toBe('once\n')
      await terminals.dispose()
      await rm(cwd, { recursive: true })
      terminals = f.create()
      expect(terminals.get(info.id).info).toMatchObject({ dormant: true, exited: false })
      expect(terminals.get(info.id).info.recoveryError).toBeTruthy()
      await mkdir(cwd)
      await terminals.update({ id: info.id, settled: false })
      expect(terminals.get(info.id).info.dormant).toBe(false)
      expect(terminals.get(info.id).info.recoveryError).toBeUndefined()
    } finally {
      await terminals.dispose()
      await f.cleanup()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'settled working agents finish before sleeping, then concurrent restores resume only once',
  async () => {
    const f = await fixture()
    const terminals = f.create()
    try {
      const bin = join(f.directory, 'bin')
      await mkdir(bin)
      await writeFile(
        join(bin, 'codex'),
        `#!/usr/bin/env node\nconsole.log('EXACT-RESTORE:' + process.argv[3]); setInterval(() => {}, 1000);\n`,
        { mode: 0o700 },
      )
      vi.stubEnv('PATH', bin + ':' + process.env.PATH)
      const info = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        f.directory,
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Working agent',
        undefined,
        undefined,
        { rememberSession: true },
      )
      f.hook(info.id, 'codex', 'checkpointed-id')
      terminals.input(info.id, "printf '\\033]7501;state=working:app=codex\\033\\\\'\r")
      await waitForRuntime(() =>
        expect(terminals.get(info.id).info.activity?.state).toBe('working'),
      )
      await terminals.update({ id: info.id, settled: true })
      expect(terminals.get(info.id).process).toBeDefined()
      expect(terminals.get(info.id).info.dormant).toBe(false)
      terminals.input(info.id, "printf '\\033]7501;state=idle:app=codex\\033\\\\'\r")
      await waitForRuntime(() => expect(terminals.get(info.id).info.dormant).toBe(true))
      expect(terminals.get(info.id).info.exited).toBe(false)
      await Promise.all([
        terminals.update({ id: info.id, settled: false }),
        terminals.update({ id: info.id, settled: false }),
      ])
      await waitForRuntime(() =>
        expect(terminals.get(info.id).buffer).toContain('EXACT-RESTORE:checkpointed-id'),
      )
      expect(terminals.get(info.id).buffer.match(/EXACT-RESTORE:checkpointed-id/g)).toHaveLength(1)
    } finally {
      await terminals.dispose()
      await f.cleanup()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'retains future snoozes across restart and wakes the shell when due without replaying commands',
  async () => {
    const f = await fixture()
    let terminals = f.create()
    let restoreClock: (() => void) | undefined
    try {
      const info = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        f.directory,
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Snoozed shell',
        undefined,
        undefined,
        { rememberSession: true },
      )
      const wakeAt = Date.now() + 60_000
      await terminals.update({ id: info.id, snoozedUntil: new Date(wakeAt).toISOString() })
      // No explicit idle report: organizing an unknown workload leaves it running.
      expect(terminals.get(info.id).process).toBeDefined()
      await terminals.dispose()
      terminals = f.create()
      expect(terminals.get(info.id).info.dormant).toBe(true)
      expect(terminals.get(info.id).process).toBeUndefined()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(wakeAt + 1)
      restoreClock = () => clock.mockRestore()
      await waitForRuntime(() => expect(terminals.get(info.id).info.dormant).toBe(false))
      expect(terminals.get(info.id).info.snoozedUntil).toBeUndefined()
      expect(terminals.get(info.id).process).toBeDefined()
    } finally {
      restoreClock?.()
      await terminals.dispose()
      await f.cleanup()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'surfaces storage failure from terminal output without crashing or sleeping an unsaved session',
  async () => {
    const f = await fixture()
    const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
    const terminals = new Terminals(undefined, undefined, undefined, recovery)
    const save = vi.spyOn(recovery, 'put')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const info = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        f.directory,
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Unsaved shell',
        undefined,
        undefined,
        { rememberSession: true },
      )
      f.hook(info.id, 'codex', 'exact-id')
      await waitForRuntime(() => expect(terminals.get(info.id).info.recoveryProgram).toBe('codex'))
      save.mockImplementation(() => {
        throw new Error('disk full')
      })
      terminals.input(info.id, "printf '\\033]7501;state=idle:app=codex\\033\\\\'\r")
      await waitForRuntime(() =>
        expect(terminals.get(info.id).info.recoveryError).toContain('disk full'),
      )
      await terminals.update({ id: info.id, settled: true })
      expect(terminals.get(info.id).process).toBeDefined()
      expect(terminals.get(info.id).info.dormant).toBe(false)
      expect(log).toHaveBeenCalled()
    } finally {
      save.mockRestore()
      log.mockRestore()
      await terminals.dispose()
      await f.cleanup()
    }
  },
)
