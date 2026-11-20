import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { Terminals } from './terminals.js'
import { TerminalRecovery } from './recovery.js'
import { waitForTerminalActivity } from './activity-wait.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
afterEach(() => vi.unstubAllEnvs())

const unix = ['linux', 'darwin'].includes(process.platform)
const program = (source: string) => ({ command: process.execPath, args: ['-e', source], env: {} })
const signal = () => new AbortController().signal

it.skipIf(!unix)(
  'wakes on a silent hook report, cleans up after timeouts and ends a wait on explicit close',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-terminal-wait-'))
    // Installing hook integrations writes provider config; keep it inside this test.
    for (const [key, folder] of [
      ['CODEX_HOME', 'codex'],
      ['CLAUDE_CONFIG_DIR', 'claude'],
      ['PI_CODING_AGENT_DIR', 'pi'],
      ['XDG_CONFIG_HOME', 'config'],
    ])
      vi.stubEnv(key!, join(directory, folder!))
    const db = openDatabase(join(directory, 'runtime.sqlite'))
    const recoveryDirectory = join(directory, 'recovery')
    const recovery = new TerminalRecovery(db, recoveryDirectory)
    const terminals = new Terminals(undefined, undefined, undefined, recovery)
    try {
      // Until the program receives input, only the hook can change its status.
      const info = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        directory,
        program(String.raw`
          process.stdin.on('data', (data) =>
            process.stdout.write('\x1b]7501;state=' + data.toString().trim() + '\x07'));
        `),
        'Agent',
      )
      const session = () => terminals.get(info.id)
      const hook = (hook_event_name: string) => {
        const result = spawnSync(
          process.execPath,
          [join(recoveryDirectory, 'report.cjs'), 'codex'],
          {
            env: {
              ...process.env,
              DOVO_TERMINAL_STATUS_DIRECTORY: join(recoveryDirectory, info.id),
            },
            input: JSON.stringify({ cwd: directory, session_id: 'root', hook_event_name }),
            encoding: 'utf8',
            timeout: 3000,
          },
        )
        expect(result.status).toBe(0)
      }
      hook('UserPromptSubmit')
      await waitForRuntime(() => expect(session().info.activity?.state).toBe('working'))

      // Repeated timeouts leave no observer, timer or listener behind.
      const listeners = session().listeners.size
      for (let attempt = 0; attempt < 25; attempt++)
        expect(await waitForTerminalActivity(terminals, info.id, ['blocked'], 20, signal())).toBe(
          'timeout',
        )
      expect(session().observers.size).toBe(0)
      expect(session().listeners.size).toBe(listeners)

      const output = session().buffer
      const blocked = waitForTerminalActivity(terminals, info.id, ['blocked'], 15000, signal())
      expect(session().observers.size).toBe(1)
      hook('PermissionRequest')
      expect(await blocked).toBe('activity')
      expect(session().info.activity?.state).toBe('blocked')
      expect(session().info.turn).toBe(1)
      expect(session().buffer).toBe(output)
      expect(session().observers.size).toBe(0)

      // These synchronous hook subprocesses both finish before the runtime can poll.
      hook('UserPromptSubmit')
      hook('Stop')
      expect(await waitForTerminalActivity(terminals, info.id, ['done'], 10000, signal(), 1)).toBe(
        'activity',
      )
      expect(session().info.turn).toBe(2)

      // A turn can start on either source and end on the other. A later
      // completion from the source that started it must not count again.
      terminals.input(info.id, 'working\r')
      await waitForRuntime(() => expect(session().info.activity?.state).toBe('working'))
      hook('Stop')
      await waitForRuntime(() => expect(session().info.turn).toBe(3))
      terminals.input(info.id, 'done\r')
      await waitForRuntime(() => expect(session().buffer).toContain('\x1b]7501;state=done\x07'))
      expect(session().info.turn).toBe(3)

      hook('UserPromptSubmit')
      await waitForRuntime(() => expect(session().info.activity?.state).toBe('working'))
      terminals.input(info.id, 'done\r')
      await waitForRuntime(() => expect(session().info.turn).toBe(4))
      hook('Stop')
      await waitForRuntime(() =>
        expect(session().activityEvent).toBe(recovery.activity(info.id)?.id),
      )
      expect(session().info.turn).toBe(4)

      // Close ends a wait at once rather than after the process stops.
      const closing = waitForTerminalActivity(terminals, info.id, ['blocked'], 15000, signal())
      const closed = session()
      const started = Date.now()
      void terminals.close(info.id)
      expect(await closing).toBe('closed')
      expect(Date.now() - started).toBeLessThan(1000)
      expect(closed.observers.size).toBe(0)
      expect(() => terminals.get(info.id)).toThrow('Terminal not found')
    } finally {
      await terminals.dispose()
      db.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  },
)

it.skipIf(!unix)(
  'cancels a wait, removes its observer and reports a retained done after exit as exit',
  async () => {
    const terminals = new Terminals()
    try {
      const info = terminals.createCommand(
        'task',
        process.cwd(),
        program(
          `process.stdout.write('\\x1b]7501;state=working\\x07'); process.stdin.once('data', () => { process.stdout.write('\\x1b]7501;state=done\\x07'); setTimeout(() => process.exit(0), 50) })`,
        ),
        'Agent',
      )
      const session = () => terminals.get(info.id)
      await waitForRuntime(() => expect(session().info.activity?.state).toBe('working'))
      const controller = new AbortController()
      const waiting = waitForTerminalActivity(
        terminals,
        info.id,
        ['done'],
        10000,
        controller.signal,
      )
      expect(session().observers.size).toBe(1)
      controller.abort(new Error('Caller left'))
      await expect(waiting).rejects.toThrow('Caller left')
      expect(session().observers.size).toBe(0)
      await expect(
        waitForTerminalActivity(terminals, info.id, ['done'], 0, signal()),
      ).resolves.toBe('timeout')

      // An exit that arrives during a wait ends it through the same observer.
      const exited = waitForTerminalActivity(terminals, info.id, ['blocked'], 10000, signal())
      terminals.input(info.id, '\r')
      await expect(exited).resolves.toBe('exit')
      expect(session().info.exitCode).toBe(0)
      // The runtime keeps a final done report after exit; the program has still ended.
      expect(session().info.activity?.state).toBe('done')
      await expect(
        waitForTerminalActivity(terminals, info.id, ['done'], 10000, signal()),
      ).resolves.toBe('exit')
      expect(session().observers.size).toBe(0)
    } finally {
      await terminals.dispose()
    }
  },
)
