import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { quote } from 'shell-quote'
import { STUDIO_TERMINAL_SCOPE, terminalStatus } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { Terminals } from './terminals'
import { TerminalRecovery, recoveryCommand, validateRecoveryShell } from './recovery'
import { installRecoveryIntegrations, recoveryLauncherSource } from './recovery-integrations'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
afterEach(() => vi.unstubAllEnvs())

const reopen = { holder: false } as const
async function fixture({ symlinkRecovery = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-terminal-recovery-'))
  vi.stubEnv('HOME', directory)
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
  // Linux and macOS use the live holder by default. `{ holder: false }` covers the reopen path that
  // Windows and a lost holder use.
  const create = (options: { holder?: false } = {}) =>
    new Terminals(
      undefined,
      undefined,
      undefined,
      new TerminalRecovery(db, recoveryDirectory),
      options,
    )
  const emit = (id: string, provider: string, event: Record<string, unknown>, remember = true) => {
    const result = spawnSync(process.execPath, [join(recoveryDirectory, 'report.cjs'), provider], {
      env: {
        ...process.env,
        DOVO_TERMINAL_STATUS_DIRECTORY: join(recoveryDirectory, id),
        DOVO_TERMINAL_RECOVERY_DIRECTORY: remember ? join(recoveryDirectory, id) : undefined,
      },
      input: JSON.stringify({
        cwd: directory,
        ...event,
      }),
      encoding: 'utf8',
      timeout: 3000,
    })
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('')
    expect(result.status).toBe(0)
  }
  const hook = (id: string, provider: string, sessionId: string, ended = false) =>
    emit(id, provider, {
      session_id: sessionId,
      hook_event_name: ended ? 'SessionEnd' : 'SessionStart',
    })
  return {
    directory,
    db,
    recoveryDirectory,
    create,
    hook,
    emit,
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

it('installs each provider integration independently and keeps a malformed provider file', async () => {
  const f = await fixture()
  const terminals = f.create(reopen)
  try {
    const codexHooks = join(f.directory, 'codex', 'hooks.json')
    const malformed = '{"hooks": {"SessionStart": ['
    await mkdir(join(f.directory, 'codex'), { recursive: true })
    await writeFile(codexHooks, malformed)
    const start = (output: string) =>
      terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        f.directory,
        {
          command: process.execPath,
          args: [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(output)}, process.env.DOVO_TERMINAL_STATUS_DIRECTORY ?? ''); setInterval(() => {}, 1000)`,
          ],
          env: {},
        },
        'Agent',
      )
    const first = start(join(f.directory, 'first-environment'))
    await waitForRuntime(() =>
      expect(existsSync(join(f.directory, 'first-environment'))).toBe(true),
    )
    // The shell still receives the integration environment.
    expect(readFileSync(join(f.directory, 'first-environment'), 'utf8')).toBe(
      join(f.recoveryDirectory, first.id),
    )
    const error = terminals.get(first.id).info.integrationError
    expect(error).toContain('Could not install the Codex terminal integration:')
    expect(error).not.toMatch(/Claude|Pi|OpenCode/)
    expect(await readFile(codexHooks, 'utf8')).toBe(malformed)
    const claude = JSON.parse(await readFile(join(f.directory, 'claude', 'settings.json'), 'utf8'))
    expect(claude.hooks.SessionStart).toHaveLength(1)
    expect(existsSync(join(f.directory, 'pi', 'extensions', 'dovo-terminal-recovery.ts'))).toBe(
      true,
    )
    expect(
      existsSync(join(f.directory, 'config', 'opencode', 'plugins', 'dovo-terminal-recovery.js')),
    ).toBe(true)

    // A repaired file is installed by the next terminal without a runtime restart.
    await writeFile(codexHooks, '{}')
    const second = start(join(f.directory, 'second-environment'))
    await waitForRuntime(() =>
      expect(existsSync(join(f.directory, 'second-environment'))).toBe(true),
    )
    expect(terminals.get(second.id).info.integrationError).toBeUndefined()
    const codex = JSON.parse(await readFile(codexHooks, 'utf8'))
    expect(codex.hooks.SessionStart).toHaveLength(1)
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})

it('shares one verified hook per provider config across runtime directories and preserves user hooks', async () => {
  const f = await fixture()
  try {
    const first = join(f.directory, "first runtime's files")
    const second = join(f.directory, 'second runtime')
    installRecoveryIntegrations(first)
    const file = (provider: string) =>
      provider === 'codex'
        ? join(f.directory, 'codex', 'hooks.json')
        : join(f.directory, 'claude', 'settings.json')
    const command = (reporter: string, provider: string) =>
      process.platform === 'win32'
        ? `set "ELECTRON_RUN_AS_NODE=1" && "${process.execPath}" "${reporter}" ${provider}`
        : `ELECTRON_RUN_AS_NODE=1 ${quote([process.execPath, reporter, provider])}`
    const group = (command: string) => ({ hooks: [{ type: 'command', command, timeout: 3 }] })
    const original = (provider: string) => group(command(join(first, 'report.cjs'), provider))
    const unrelated = join(f.directory, 'mine', 'report.cjs')
    await mkdir(join(f.directory, 'mine'))
    await writeFile(unrelated, '// My reporter\n')
    const userGroups = (provider: string) => [
      { matcher: 'startup', ...original(provider) },
      { hooks: [...original(provider).hooks, { type: 'command', command: 'echo user hook' }] },
      group(command(unrelated, provider)),
      group(command(join(f.directory, 'missing', 'report.cjs'), provider)),
    ]
    for (const provider of ['codex', 'claude']) {
      const config = JSON.parse(await readFile(file(provider), 'utf8'))
      config.hooks.SessionStart = [...userGroups(provider), original(provider), original(provider)]
      await writeFile(file(provider), JSON.stringify(config))
    }
    installRecoveryIntegrations(second)
    await rm(second, { recursive: true })
    for (const provider of ['codex', 'claude']) {
      const contents = await readFile(file(provider), 'utf8')
      const config = JSON.parse(contents)
      expect(config.hooks.SessionStart.slice(0, -1)).toEqual(userGroups(provider))
      const generated = config.hooks.SessionStart.at(-1)
      const stableReporter = join(f.directory, provider, 'dovo-terminal-recovery', 'report.cjs')
      expect(generated).toEqual(group(command(stableReporter, provider)))
      expect(config.hooks.Stop).toEqual([generated])
      const session = join(f.directory, 'session-' + provider)
      await mkdir(session)
      // Execute the command as the provider does. Only the invoking terminal's env identifies its session.
      const result = spawnSync(generated.hooks[0].command, {
        shell: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          TMUX: '',
          HC_SCOPE: '',
          DOVO_TERMINAL_RECOVERY_DIRECTORY: session,
          DOVO_TERMINAL_STATUS_DIRECTORY: session,
        },
        input: JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 'working-' + provider,
          cwd: f.directory,
        }),
      })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(JSON.parse(await readFile(join(session, 'state.json'), 'utf8')).target).toMatchObject({
        provider,
        sessionId: 'working-' + provider,
      })
      installRecoveryIntegrations(first)
      expect(await readFile(file(provider), 'utf8')).toBe(contents)
    }
  } finally {
    await f.cleanup()
  }
})

it.each(['codex', 'claude'])(
  'reports %s lifecycle activity privately, isolates sessions and preserves shutdown ownership',
  async (provider) => {
    const f = await fixture()
    try {
      const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
      const id = '12345678-1234-4234-8234-123456789abc'
      const other = '12345678-1234-4234-8234-123456789def'
      recovery.environment(id, '')
      recovery.environment(other, '')
      const emit = (hook_event_name: string, extra: Record<string, unknown> = {}) =>
        f.emit(id, provider, { session_id: 'root-session', hook_event_name, ...extra })
      emit('SessionStart')
      expect(recovery.activity(id)?.activity).toEqual({ state: 'idle', app: provider })
      for (const [event, state] of [
        ['UserPromptSubmit', 'working'],
        ['PermissionRequest', 'blocked'],
        ['PostToolUse', 'working'],
        ['Stop', 'done'],
      ]) {
        emit(event!)
        expect(recovery.activity(id)?.activity?.state).toBe(state)
      }
      emit('PreToolUse', {
        tool_name: provider === 'claude' ? 'AskUserQuestion' : 'request_user_input',
      })
      expect(recovery.activity(id)?.activity).toEqual({
        state: 'blocked',
        kind: 'question',
        app: provider,
      })
      emit('PostToolUse')
      const current = recovery.activity(id)
      emit('Stop', { agent_id: 'child-agent' })
      emit('SessionEnd', { session_id: 'older-session' })
      f.emit(other, provider, { session_id: 'another-terminal', hook_event_name: 'SessionStart' })
      expect(recovery.activity(id)).toEqual(current)
      expect(recovery.activity(other)?.activity?.state).toBe('idle')
      const providerEvents =
        provider === 'claude'
          ? [
              {
                name: 'Notification',
                payload: { notification_type: 'permission_prompt' },
                activity: { state: 'blocked', kind: 'permission' },
              },
              { name: 'StopFailure', payload: {}, activity: { state: 'error' } },
            ]
          : [{ name: 'Interrupt', payload: {}, activity: { state: 'idle' } }]
      for (const event of providerEvents) {
        emit(event.name, event.payload)
        expect(recovery.activity(id)?.activity).toMatchObject(event.activity)
      }
      recovery.freeze(id)
      const frozen = recovery.activity(id)
      emit('SessionEnd')
      expect(recovery.activity(id)).toEqual(frozen)
      recovery.environment(id, '')
      emit('SessionStart')
      emit('SessionEnd')
      expect(recovery.activity(id)?.activity).toBeNull()
    } finally {
      await f.cleanup()
    }
  },
)

it.each([
  ['codex', 'turn_id', 'prompt_id'],
  ['claude', 'prompt_id', 'turn_id'],
] as const)(
  'keeps %s turn IDs across consecutive hook reports',
  async (provider, field, otherField) => {
    const f = await fixture()
    try {
      const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
      const id = '12345678-1234-4234-8234-123456789abc'
      recovery.environment(id, '')
      const emit = (hook_event_name: string, extra: Record<string, unknown> = {}) =>
        f.emit(id, provider, { session_id: 'session', hook_event_name, ...extra })
      emit('SessionStart', { [field]: 'stale' })
      expect(recovery.activity(id)?.activity).toEqual({ app: provider, state: 'idle' })
      emit('UserPromptSubmit', { [field]: 'a' })
      emit('PreToolUse', { [field]: 'b' })
      emit('Stop', { [field]: 'b' })
      expect(recovery.activity(id)).toMatchObject({
        activity: { app: provider, state: 'done', turnId: 'b' },
        transitions: [
          { state: 'idle' },
          { state: 'working', turnId: 'a' },
          { state: 'working', turnId: 'b' },
        ],
      })
      for (const extra of [
        { [otherField]: 'ignored' },
        { [field]: 'x\n' },
        { [field]: 'x'.repeat(129) },
      ]) {
        emit('PreToolUse', extra)
        expect(recovery.activity(id)?.activity).toEqual({ app: provider, state: 'working' })
      }
      emit('SessionEnd', { [field]: 'stale' })
      expect(recovery.activity(id)?.turnId).toBeUndefined()
    } finally {
      await f.cleanup()
    }
  },
)

it('keeps a tagged clear and the last 32 hook boundaries for long session paths', async () => {
  const f = await fixture()
  try {
    const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
    const id = '12345678-1234-4234-8234-123456789abc'
    const env = recovery.environment(id, '')
    const reporter = createRequire(import.meta.url)(join(f.recoveryDirectory, 'report.cjs'))
    vi.stubEnv('DOVO_TERMINAL_STATUS_DIRECTORY', env.DOVO_TERMINAL_STATUS_DIRECTORY)
    const session = '界'.repeat(4000)
    const turnId = (n: number) => String(n).padStart(128, 'x')
    for (let n = 0; n < 33; n++)
      reporter.status('pi', session, { state: 'working', turnId: turnId(n) })
    reporter.status('pi', session, null, turnId(32))
    const event = recovery.activity(id)
    expect(event?.activity).toBeNull()
    expect(event?.turnId).toBe(turnId(32))
    expect(event?.transitions?.map((entry) => entry.turnId)).toEqual(
      Array.from({ length: 32 }, (_, i) => turnId(i + 1)),
    )
  } finally {
    await f.cleanup()
  }
})

it('keeps the hook turn count after overlapping jobs exceed the transition history', async () => {
  const f = await fixture()
  try {
    const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
    const id = '12345678-1234-4234-8234-123456789abc'
    const env = recovery.environment(id, '')
    vi.stubEnv('DOVO_TERMINAL_STATUS_DIRECTORY', env.DOVO_TERMINAL_STATUS_DIRECTORY)
    const reporter = createRequire(import.meta.url)(join(f.recoveryDirectory, 'report.cjs'))
    const session = '界'.repeat(4000)
    const report = (state: string, n: number) =>
      reporter.status('codex', session, { state, turnId: String(n).padStart(128, 'x') })
    for (let n = 0; n < 128; n++) report('working', n)
    for (let n = 0; n < 128; n++) {
      report('blocked', n)
      report('working', n)
      report('done', n)
    }
    for (let n = 128; n < 256; n++) report('working', n)
    const snapshot = recovery.activity(id)
    expect(snapshot?.turn).toBe(128)
    expect(snapshot?.transitions).toHaveLength(32)
    report('done', 128)
    expect(recovery.activity(id)?.turn).toBe(129)
  } finally {
    await f.cleanup()
  }
})

it('recovers identified turns on a direct PTY from older hook snapshots without positions', async () => {
  const f = await fixture()
  const terminals = f.create(reopen)
  try {
    const { id } = terminals.createCommand(
      STUDIO_TERMINAL_SCOPE,
      f.directory,
      {
        command: process.execPath,
        args: [
          '-e',
          String.raw`
          const osc = (state, id) => '\x1b]7501;state=' + state + ':turnId=' + id + '\x07'
          process.stdout.write(osc('working', 'job0') + osc('done', 'job0'))
          process.stdin.once('data', () => process.stdout.write(
            osc('working', 'job1') + osc('done', 'job1') + osc('working', 'extra') + osc('done', 'extra')))
          process.stdin.resume()
        `,
        ],
        env: {},
      },
      'Agent',
    )
    await waitForRuntime(() => expect(terminals.get(id).info.turn).toBe(1))
    const reporter = createRequire(import.meta.url)(join(f.recoveryDirectory, 'report.cjs'))
    const directory = join(f.recoveryDirectory, id)
    vi.stubEnv('DOVO_TERMINAL_STATUS_DIRECTORY', directory)
    for (let n = 0; n < 40; n++) {
      if (n === 2) {
        reporter.status('codex', 'fixture', { state: 'working' })
        reporter.status('codex', 'fixture', { state: 'done' })
      }
      reporter.status('codex', 'fixture', { state: 'working', turnId: 'job' + n })
      reporter.status('codex', 'fixture', { state: 'done', turnId: 'job' + n })
    }
    // The previous reporter recorded the completed IDs but no per-ID positions.
    const file = join(directory, 'activity.json')
    const snapshot = JSON.parse(readFileSync(file, 'utf8'))
    delete snapshot.completionPositions
    writeFileSync(file, JSON.stringify(snapshot))
    await waitForRuntime(() =>
      expect(terminals.get(id).info).toMatchObject({ turn: 41, activity: { turnId: 'job39' } }),
    )
    terminals.input(id, '\r')
    await waitForRuntime(() =>
      expect(terminals.get(id).info).toMatchObject({ turn: 42, activity: { turnId: 'extra' } }),
    )
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})

it('retains concurrent hook updates and recovers when a writer exits before publishing', async () => {
  const f = await fixture()
  try {
    const recovery = new TerminalRecovery(f.db, f.recoveryDirectory)
    const id = '12345678-1234-4234-8234-123456789abc'
    const env = { ...process.env, ...recovery.environment(id, '') }
    f.hook(id, 'codex', 'session')
    const writer = String.raw`
      const fs = require('node:fs');
      const [reporter, turnId] = process.argv.slice(1);
      const status = require(reporter).status;
      const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        const contents = read.call(this, file, ...args);
        if (String(file).endsWith('activity.json')) {
          if (turnId === 'crash') process.exit(26);
          // Hold the snapshot long enough for the other processes to contend.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
        }
        return contents;
      };
      status('codex', 'session', { state: 'working', turnId });
    `
    const run = (turnId: string) =>
      promisify(execFile)(
        process.execPath,
        ['-e', writer, join(f.recoveryDirectory, 'report.cjs'), turnId],
        { env, timeout: 6000 },
      )
    await expect(run('crash')).rejects.toMatchObject({ code: 26 })
    const jobs = Array.from({ length: 6 }, (_, i) => 'job-' + i)
    // Let every writer finish before removing its files, even if one fails.
    for (const result of await Promise.allSettled(jobs.map(run))) {
      if (result.status === 'rejected') throw result.reason
    }
    const event = recovery.activity(id)
    const ids = [
      ...(event?.transitions ?? []).map((entry) => entry.turnId),
      event?.activity?.turnId,
    ]
    expect(new Set(ids.filter(Boolean))).toEqual(new Set(jobs))
    expect(event?.sequence).toBe(jobs.length + 1)
  } finally {
    await f.cleanup()
  }
})

it.skipIf(process.platform === 'win32')(
  'updates live terminal status from agent hooks even with Remember session off',
  async () => {
    const f = await fixture()
    const terminals = f.create()
    try {
      const info = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        f.directory,
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Agent terminal',
      )
      const current = () => terminals.get(info.id).info
      const emit = (hook_event_name: string) =>
        f.emit(info.id, 'codex', { hook_event_name, session_id: 'not-retained' }, false)
      emit('SessionStart')
      await waitForRuntime(() => expect(current().activity?.state).toBe('idle'))
      for (const [event, label, section] of [
        ['UserPromptSubmit', 'Working', 'working'],
        ['PermissionRequest', 'Needs input', 'needs-input'],
        ['PostToolUse', 'Working', 'working'],
        ['Stop', 'Done', 'active'],
      ]) {
        emit(event!)
        await waitForRuntime(() =>
          expect(terminalStatus(current(), true)).toMatchObject({ label, section }),
        )
      }
      expect(terminals.get(info.id).recovery).toBeUndefined()
      expect(new TerminalRecovery(f.db, f.recoveryDirectory).event(info.id)).toBeUndefined()
      emit('SessionEnd')
      await waitForRuntime(() => expect(current().activity).toBeUndefined())
      await terminals.close(info.id)
      expect(existsSync(join(f.recoveryDirectory, info.id))).toBe(false)
      expect(new TerminalRecovery(f.db, f.recoveryDirectory).list()).toEqual([])
    } finally {
      await terminals.dispose()
      await f.cleanup()
    }
  },
)

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
    const otherRuntime = join(f.directory, 'temporary second runtime')
    installRecoveryIntegrations(otherRuntime)
    await rm(otherRuntime, { recursive: true })
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
    expect(recovery.activity(id)?.activity).toEqual({ app: 'pi', state: 'idle' })
    handlers.get('agent_start')!({}, context)
    expect(recovery.activity(id)?.activity).toEqual({ app: 'pi', state: 'working' })
    handlers.get('agent_end')!({}, context)
    expect(recovery.activity(id)?.activity).toEqual({ app: 'pi', state: 'done' })
    expect(recovery.event(id)).toEqual({
      provider: 'pi',
      sessionId: context.sessionManager.getSessionFile(),
      directory: f.directory,
    })
    handlers.get('session_shutdown')!({}, context)
    expect(recovery.event(id)).toBeNull()
    expect(recovery.activity(id)?.activity).toBeNull()
    const plugin: {
      DovoTerminalRecovery: (context: { directory: string }) => Promise<{
        event: (input: {
          event: {
            type: string
            properties: {
              info?: { id: string; parentID?: string }
              sessionID?: string
              status?: { type: string }
            }
          }
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
    await hooks['chat.message']({ sessionID: 'child' })
    expect(recovery.event(id)).toBeNull()
    await hooks['chat.message']({ sessionID: 'ses_exact_existing' })
    expect(recovery.event(id)).toMatchObject({
      provider: 'opencode',
      sessionId: 'ses_exact_existing',
    })
    expect(recovery.activity(id)?.activity).toEqual({ app: 'opencode', state: 'working' })
    for (const [type, state] of [
      ['permission.asked', 'blocked'],
      ['permission.replied', 'working'],
      ['question.asked', 'blocked'],
      ['question.replied', 'working'],
      ['session.idle', 'done'],
      ['session.error', 'error'],
    ]) {
      await hooks.event({ event: { type: type!, properties: { sessionID: 'ses_exact_existing' } } })
      expect(recovery.activity(id)?.activity?.state).toBe(state)
    }
    await hooks.event({
      event: {
        type: 'session.status',
        properties: { sessionID: 'child', status: { type: 'busy' } },
      },
    })
    expect(recovery.activity(id)?.activity?.state).toBe('error')
    await hooks.event({
      event: {
        type: 'session.status',
        properties: { sessionID: 'ses_exact_existing', status: { type: 'busy' } },
      },
    })
    expect(recovery.activity(id)?.activity?.state).toBe('working')
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
      let terminals = f.create(reopen)
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
        terminals = f.create(reopen)
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
    let terminals = f.create(reopen)
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
      terminals = f.create(reopen)
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
      terminals = f.create(reopen)
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
    let terminals = f.create(reopen)
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
      terminals = f.create(reopen)
      await waitForRuntime(() => expect(terminals.get(info.id).process).toBeDefined())
      expect(await readFile(once, 'utf8')).toBe('once\n')
      await terminals.dispose()
      await rm(cwd, { recursive: true })
      terminals = f.create(reopen)
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
    let terminals = f.create(reopen)
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
      terminals = f.create(reopen)
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
      terminals.input(info.id, "printf '\\033]7501;state=working:app=codex\\033\\\\'\r")
      await waitForRuntime(() =>
        expect(terminals.get(info.id).info.activity?.state).toBe('working'),
      )
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
