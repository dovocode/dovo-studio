import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { connect } from 'node:net'
import { once } from 'node:events'
import { join } from 'node:path'
import { STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { Terminals } from './terminals'
import { TerminalRecovery } from './recovery'
import {
  HELD_INPUT_QUEUE_LIMIT,
  HolderInputError,
  TerminalHolder,
  launchHolder,
} from './holder-client'
import { HOLDER_PROTOCOL, HOLDER_STATE_FILE, holderSocketPath } from './holder-protocol'
import { HttpError } from '../errors'
import { waitForTerminalActivity } from './activity-wait'
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
  const create = (holder?: TerminalHolder) => {
    const terminals = new Terminals(undefined, undefined, undefined, recovery(), { holder })
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
  const holderPid = async () =>
    (
      JSON.parse(await readFile(join(recoveryDirectory, 'holder', HOLDER_STATE_FILE), 'utf8')) as {
        pid: number
      }
    ).pid
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
  return { directory, recoveryDirectory, create, marker, holderPid, open, foreground }
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
  'reopens a fresh shell without replaying commands when the holder is lost',
  async () => {
    const f = await fixture()
    const first = f.create()
    const info = f.open(first)
    first.input(info.id, `echo once >> once\r`)
    await f.marker('once')
    await waitForRuntime(() => expect(first.get(info.id).process?.pid).toBeGreaterThan(0))
    const shellPid = first.get(info.id).process!.pid
    await first.dispose()
    // A computer restart loses the holder and every program in it.
    process.kill(await f.holderPid(), 'SIGKILL')
    await waitForRuntime(() => expect(alive(shellPid)).toBe(false))

    const second = f.create()
    await waitForRuntime(() =>
      expect(second.get(info.id).info.integrationError).toContain('holder stopped'),
    )
    await waitForRuntime(() => expect(second.get(info.id).process?.pid).toBeGreaterThan(0))
    expect(second.get(info.id).process!.pid).not.toBe(shellPid)
    expect(second.get(info.id).info).toMatchObject({ exited: false, dormant: false })
    expect(await f.marker('once')).toBe('once\n')

    // Losing the holder while the runtime runs reopens the shell the same way.
    const reopened = second.get(info.id).process!.pid
    process.kill(await f.holderPid(), 'SIGKILL')
    await waitForRuntime(() => {
      const pid = second.get(info.id).process?.pid
      expect(pid && pid !== reopened).toBeTruthy()
    })
    expect(await f.marker('once')).toBe('once\n')
  },
)

it.skipIf(process.platform === 'win32')(
  'waits for an unresponsive holder instead of starting a second shell',
  async () => {
    const f = await fixture()
    const first = f.create()
    const info = f.open(first)
    await waitForRuntime(() => expect(first.get(info.id).process?.pid).toBeGreaterThan(0))
    const shellPid = first.get(info.id).process!.pid
    await first.dispose()
    const holder = await f.holderPid()
    process.kill(holder, 'SIGSTOP')
    try {
      const second = f.create()
      // The handshake waits 5 s for a silent holder. Allow for a loaded test machine.
      await vi.waitFor(
        () =>
          expect(second.get(info.id).info.recoveryError).toContain(
            'Waiting for the terminal holder',
          ),
        { timeout: 20_000 },
      )
      expect(second.get(info.id).info.dormant).toBe(true)
      expect(second.get(info.id).process).toBeUndefined()
      process.kill(holder, 'SIGCONT')
      await waitForRuntime(() => expect(second.get(info.id).process?.pid).toBe(shellPid))
      expect(second.get(info.id).info).toMatchObject({ dormant: false, exited: false })
      expect(second.get(info.id).info.recoveryError).toBeUndefined()
    } finally {
      process.kill(holder, 'SIGCONT')
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'runs a remembered shell locally, once, when the holder cannot start',
  async () => {
    const f = await fixture()
    const holder = new TerminalHolder(join(f.recoveryDirectory, 'holder'), {
      launch: async () => {
        throw new Error('no service manager')
      },
    })
    const terminals = f.create(holder)
    const info = f.open(terminals)
    terminals.input(info.id, `echo once >> once\r`)
    expect(await f.marker('once')).toBe('once\n')
    expect(terminals.get(info.id).info.integrationError).toContain('Live recovery is unavailable')
    expect(terminals.get(info.id).info).toMatchObject({ exited: false, dormant: false })
    await terminals.dispose()
    // Without a holder the remembered shell reopens. The command does not run again.
    const next = f.create()
    await waitForRuntime(() => expect(next.get(info.id).process?.pid).toBeGreaterThan(0))
    expect(next.get(info.id).info.integrationError).toBeUndefined()
    expect(await f.marker('once')).toBe('once\n')
  },
)

it.skipIf(process.platform === 'win32')(
  'keeps transient standalone and thread terminals out of the holder',
  async () => {
    const f = await fixture()
    const terminals = f.create()
    const transient = terminals.createCommand(STUDIO_TERMINAL_SCOPE, f.directory, shell, 'Plain')
    const thread = terminals.createCommand('task-1', f.directory, shell, 'Thread')
    await waitForRuntime(() => expect(terminals.get(thread.id).process?.pid).toBeGreaterThan(0))
    for (const id of [transient.id, thread.id])
      expect(terminals.get(id).process?.constructor.name).not.toBe('HeldTerminal')
    await expect(
      readFile(join(f.recoveryDirectory, 'holder', HOLDER_STATE_FILE)),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it.skipIf(process.platform === 'win32')(
  'does not pass the holder supervisor marker to shells',
  async () => {
    const f = await fixture()
    // No holder here: a test must never ask the host service manager to start one.
    vi.stubEnv('DOVO_TERMINAL_HOLDER_SUPERVISOR', 'systemd')
    const terminals = new Terminals(undefined, undefined, undefined, undefined, { holder: false })
    try {
      const info = terminals.createCommand(STUDIO_TERMINAL_SCOPE, f.directory, shell, 'Plain')
      terminals.input(info.id, 'echo "marker=[$DOVO_TERMINAL_HOLDER_SUPERVISOR]" > marker\r')
      expect(await f.marker('marker')).toBe('marker=[]\n')
    } finally {
      await terminals.dispose()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'keeps a split status report when a held foreground command starts, then clears it at the shell',
  async () => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'blocked.cjs'),
      String.raw`
      process.stdout.write('\x1b]75');
      setTimeout(() => process.stdout.write('01;state=blocked:app=fixture\x07'), 40);
      process.stdin.once('data', () => process.exit(0));
    `,
    )
    const terminals = f.create()
    const { id } = f.open(terminals)
    const current = () => terminals.get(id).info
    await waitForRuntime(() => expect(current().foregroundProcess?.idle).toBe(true))
    terminals.input(id, `"${process.execPath}" blocked.cjs\r`)
    await waitForRuntime(() => {
      expect(terminals.get(id).buffer).toContain('\x1b]7501;state=blocked:app=fixture\x07')
      expect(current().foregroundProcess?.idle).toBe(false)
    })
    const signal = new AbortController().signal
    expect(await waitForTerminalActivity(terminals, id, ['blocked'], 0, signal)).toBe('activity')
    expect(current().activity).toEqual({ state: 'blocked', app: 'fixture' })
    terminals.input(id, '\r')
    await waitForRuntime(() => {
      expect(current().foregroundProcess?.idle).toBe(true)
      expect(current().activity).toBeUndefined()
    })
  },
)

it.skipIf(process.platform === 'win32')(
  'reports status waits for a held shell after a restart, then exit and explicit close',
  async () => {
    const f = await fixture()
    const first = f.create()
    const info = f.open(first)
    await waitForRuntime(() => expect(first.get(info.id).process?.pid).toBeGreaterThan(0))
    const shellPid = first.get(info.id).process!.pid
    await first.dispose()
    const second = f.create()
    await waitForRuntime(() => expect(second.get(info.id).process?.pid).toBe(shellPid))
    const signal = new AbortController().signal
    // The report comes from the same held shell, through the new runtime.
    const blocked = waitForTerminalActivity(second, info.id, ['blocked'], 10_000, signal)
    second.input(info.id, "printf '\\033]7501;state=blocked\\033\\\\'\r")
    expect(await blocked).toBe('activity')
    expect(second.get(info.id).process?.pid).toBe(shellPid)
    const exited = waitForTerminalActivity(second, info.id, ['done'], 10_000, signal)
    second.input(info.id, 'exit 3\r')
    expect(await exited).toBe('exit')
    expect(second.get(info.id).info).toMatchObject({ exited: true, exitCode: 3 })

    // Explicit close of a running held shell ends it and ends a pending wait.
    const other = f.open(second)
    await waitForRuntime(() => expect(second.get(other.id).process?.pid).toBeGreaterThan(0))
    const otherPid = second.get(other.id).process!.pid
    const closed = waitForTerminalActivity(second, other.id, ['done'], 10_000, signal)
    await second.close(other.id)
    expect(await closed).toBe('closed')
    expect(() => process.kill(otherPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  },
)

it.skipIf(process.platform === 'win32')(
  'retains root turns across runtime restarts even after their PTY output rolls out',
  async () => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'turns.cjs'),
      String.raw`
        const report = (state) => '\x1b]7501;state=' + state + '\x07';
        console.log(report('working') + report('done'));
        setTimeout(() => {
          console.log(report('working') + report('blocked') + report('working') + report('done'));
          process.stdout.write('padding\n'.repeat(150000), () =>
            require('node:fs').writeFileSync('output-written', 'done\n'));
        }, 1000);
        process.stdin.resume();
      `,
    )
    const first = f.create()
    const { id } = f.open(first)
    await waitForRuntime(() => expect(first.get(id).process?.pid).toBeGreaterThan(0))
    first.input(id, `"${process.execPath}" turns.cjs\r`)
    await waitForRuntime(() => expect(first.get(id).info.turn).toBe(1))
    await first.dispose()
    await f.marker('output-written')
    const second = f.create()
    await waitForRuntime(() => {
      expect(second.get(id).info).toMatchObject({ turn: 3, activity: { state: 'done' } })
      expect(second.get(id).buffer).not.toContain('\x1b]7501;')
    })
    await second.dispose()
    const third = f.create()
    await waitForRuntime(() => {
      expect(third.get(id).info).toMatchObject({ turn: 3, activity: { state: 'done' } })
    })
    await third.close(id)
  },
)

it.skipIf(process.platform === 'win32')(
  'counts overlapping OSC and hook work once and keeps independent turns during a restart',
  async () => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'mixed-turns.cjs'),
      String.raw`
        const fs = require('node:fs');
        const path = require('node:path');
        const { status } = require(path.join(process.env.DOVO_TERMINAL_STATUS_DIRECTORY, '..', 'report.cjs'));
        const hook = state => status('codex', 'fixture', { state });
        const osc = state => process.stdout.write('\x1b]7501;state=' + state + '\x07');
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        (async () => {
          hook('working');
          osc('working');
          while (!fs.existsSync('continue-turns')) await wait(20);
          osc('done');
          await wait(150);
          hook('done');
          await wait(150);

          hook('working');
          osc('working');
          await wait(150);
          hook('done');
          await wait(150);
          osc('done');
          await wait(150);

          osc('working');
          osc('done');
          await wait(150);
          hook('working');
          hook('done');
          await wait(650);
          // Both sources complete two more turns before the PTY delivers one
          // read. A third OSC-only completion in that read must still count.
          hook('working');
          hook('done');
          hook('working');
          hook('done');
          process.stdout.write(('\x1b]7501;state=working\x07\x1b]7501;state=done\x07').repeat(3));
          fs.writeFileSync('turns-finished', 'done\n');
        })();
        process.stdin.resume();
      `,
    )
    const first = f.create()
    const { id } = f.open(first)
    await waitForRuntime(() => expect(first.get(id).process?.pid).toBeGreaterThan(0))
    first.input(id, `exec "${process.execPath}" mixed-turns.cjs\r`)
    await waitForRuntime(() =>
      expect(first.get(id).info).toMatchObject({ turn: 0, activity: { state: 'working' } }),
    )
    await first.dispose()
    await writeFile(join(f.directory, 'continue-turns'), '')
    await f.marker('turns-finished')

    const second = f.create()
    await waitForRuntime(() => {
      expect(second.get(id).info).toMatchObject({ turn: 7, activity: { state: 'done' } })
    })
    await second.dispose()
    const third = f.create()
    await waitForRuntime(() =>
      expect(third.get(id).info).toMatchObject({ turn: 7, dormant: false }),
    )
    await third.close(id)
  },
)

it.skipIf(process.platform === 'win32')(
  'counts distinct turn IDs in one read and suppresses delayed duplicates across reattachment',
  async () => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'ids.cjs'),
      String.raw`
      const fs = require('node:fs')
      const path = require('node:path')
      const {status} = require(path.join(process.env.DOVO_TERMINAL_STATUS_DIRECTORY, '..', 'report.cjs'))
      const hook = (state, turnId) => status('codex', 'fixture', {state, turnId})
      const osc = (state, turnId) => '\x1b]7501;state=' + state + ':turnId=' + turnId + '\x07'
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      async function gate(name) {
        while (!fs.existsSync(name)) await wait(20)
      }
      ;(async () => {
        fs.writeFileSync('ids-ready', 'ready\n')
        await gate('ids-run')
        hook('working', 'hook-only')
        hook('done', 'hook-only')
        hook('working', 'shared')
        hook('done', 'shared')
        process.stdout.write(osc('working','osc-only') + osc('done','osc-only') +
          osc('working','shared') + osc('done','shared'))
        fs.writeFileSync('ids-first', 'first\n')
        await gate('ids-continue')
        hook('working','osc-only')
        hook('done','osc-only')
        process.stdout.write(osc('working','hook-only') + osc('done','hook-only') +
          osc('working','last') + osc('done','last'))
        fs.writeFileSync('ids-second', 'second\n')
      })()
      process.stdin.resume()
    `,
    )
    const first = f.create()
    const { id } = f.open(first)
    await waitForRuntime(() => expect(first.get(id).process?.pid).toBeGreaterThan(0))
    first.input(id, `exec "${process.execPath}" ids.cjs\r`)
    await f.marker('ids-ready')
    await first.dispose()
    await writeFile(join(f.directory, 'ids-run'), '')
    await f.marker('ids-first')
    const second = f.create()
    await waitForRuntime(() =>
      expect(second.get(id).info).toMatchObject({ turn: 3, dormant: false }),
    )
    await second.dispose()
    await writeFile(join(f.directory, 'ids-continue'), '')
    await f.marker('ids-second')
    const third = f.create()
    await waitForRuntime(() =>
      expect(third.get(id).info).toMatchObject({ turn: 4, activity: { turnId: 'last' } }),
    )
    await third.close(id)
  },
)

it.skipIf(process.platform === 'win32')(
  'matches earlier OSC completions and later replays after hook history rolls over during an outage',
  async () => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'overrun.cjs'),
      String.raw`
      const fs = require('node:fs')
      const path = require('node:path')
      const {status} = require(path.join(process.env.DOVO_TERMINAL_STATUS_DIRECTORY, '..', 'report.cjs'))
      const hook = (state, turnId) => status('codex', 'fixture', {state, turnId})
      const osc = (state, id) => '\x1b]7501;state=' + state + ':turnId=' + id + '\x07'
      async function gate(name) {
        while (!fs.existsSync(name)) await new Promise(resolve => setTimeout(resolve, 10))
      }
      ;(async () => {
        process.stdout.write(osc('working', 'job0') + osc('done', 'job0'))
        await gate('start-hooks')
        hook('working', 'still-open')
        for (let i = 0; i < 40; i++) {
          if (i === 2) { hook('working'); hook('done') }
          hook('working', 'job' + i)
          hook('done', 'job' + i)
        }
        fs.writeFileSync('hook-burst', 'done\n')
        await gate('repeat')
        process.stdout.write(osc('working', 'job1') + osc('done', 'job1') +
          osc('done', 'still-open') + osc('working', 'extra') + osc('done', 'extra'))
      })()
      process.stdin.resume()
    `,
    )
    const first = f.create()
    const { id } = f.open(first)
    await waitForRuntime(() => expect(first.get(id).process?.pid).toBeGreaterThan(0))
    first.input(id, `exec "${process.execPath}" overrun.cjs\r`)
    await waitForRuntime(() => expect(first.get(id).info.turn).toBe(1))
    await first.dispose()
    const pid = await f.holderPid()
    process.kill(pid, 'SIGSTOP')
    try {
      await writeFile(join(f.directory, 'start-hooks'), '')
      await f.marker('hook-burst')
    } finally {
      process.kill(pid, 'SIGCONT')
    }
    const second = f.create()
    await waitForRuntime(() =>
      expect(second.get(id).info).toMatchObject({
        turn: 41,
        activity: { state: 'done', turnId: 'job39' },
      }),
    )
    await writeFile(join(f.directory, 'repeat'), '')
    await waitForRuntime(() =>
      expect(second.get(id).info).toMatchObject({
        turn: 43,
        activity: { state: 'done', turnId: 'extra' },
      }),
    )
    await second.close(id)
  },
)

it.skipIf(process.platform === 'win32')(
  'publishes a held turn and the exit together when the program ends while disconnected',
  async () => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'working-exit.cjs'),
      String.raw`
        process.stdout.write('\x1b]7501;state=working\x07');
        setTimeout(() => {
          require('node:fs').writeFileSync('exiting', 'done\n');
          process.exit(7);
        }, 1000);
      `,
    )
    const first = f.create()
    const { id } = f.open(first)
    await waitForRuntime(() => expect(first.get(id).process?.pid).toBeGreaterThan(0))
    first.input(id, `exec "${process.execPath}" working-exit.cjs\r`)
    await waitForRuntime(() => expect(first.get(id).info.activity?.state).toBe('working'))
    await first.dispose()
    await f.marker('exiting')
    const second = f.create()
    expect(
      await waitForTerminalActivity(second, id, undefined, 10000, new AbortController().signal, 0),
    ).toBe('exit')
    expect(second.get(id).info).toMatchObject({ turn: 1, exited: true, exitCode: 7 })
  },
)

it.skipIf(process.platform === 'win32').each(['OSC', 'hook'])(
  'captures tracked input after old %s reports in flight and before its own output',
  async (source) => {
    const f = await fixture()
    await writeFile(
      join(f.directory, 'tracked-input.cjs'),
      String.raw`
        const fs = require('node:fs');
        const path = require('node:path');
        const source = ${JSON.stringify(source)};
        const file = path.join(process.env.DOVO_TERMINAL_STATUS_DIRECTORY, 'activity.json');
        let id = 0;
        const report = (state, turn) => {
          if (source === 'OSC') return '\x1b]7501;state=' + state + '\x07';
          fs.writeFileSync(file + '.next', JSON.stringify({id:String(++id), at:Date.now(), turn, activity:{state}}));
          fs.renameSync(file + '.next', file);
          return '';
        };
        process.stdout.write(report('working', 0));
        let inputs = 0;
        process.stdin.on('data', () => {
          if (++inputs === 1) process.stdout.write('PRIOR_OUTPUT' + report('done', 1));
          else process.stdout.write(report('working', 1) + report('done', 2));
        });
      `,
    )
    const terminals = f.create()
    const { id } = f.open(terminals)
    await waitForRuntime(() => expect(terminals.get(id).process?.pid).toBeGreaterThan(0))
    terminals.input(id, `exec "${process.execPath}" tracked-input.cjs\r`)
    await waitForRuntime(() => expect(terminals.get(id).info.activity?.state).toBe('working'))
    let before: number | undefined
    let receipt: Promise<number> | undefined
    let output = ''
    const detach = terminals.attach(id, (data) => {
      output += data
      if (receipt || !output.includes('PRIOR_OUTPUT')) return
      // The holder sends raw output before the OSC frame. Hook reports are
      // polled at the runtime, but the receipt captures the pre-input file.
      before = terminals.get(id).info.turn
      receipt = terminals.inputAtTurn(id, 'next\r')
    })
    try {
      terminals.input(id, 'first\r')
      await waitForRuntime(() => expect(receipt).toBeDefined())
      expect(before).toBe(0)
      expect(await receipt).toBe(1)
      expect(
        await waitForTerminalActivity(
          terminals,
          id,
          ['done'],
          10000,
          new AbortController().signal,
          1,
        ),
      ).toBe('activity')
      expect(terminals.get(id).info.turn).toBe(2)
    } finally {
      detach()
      await terminals.close(id)
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'refuses and reports input during a holder outage, then accepts it after reattach',
  async () => {
    const f = await fixture()
    const terminals = f.create()
    const info = f.open(terminals)
    await waitForRuntime(() => expect(terminals.get(info.id).process?.pid).toBeGreaterThan(0))
    const shellPid = terminals.get(info.id).process!.pid
    // Another authenticated client takes the holder over, so this runtime loses its connection.
    const holderDirectory = join(f.recoveryDirectory, 'holder')
    const intruder = connect(holderSocketPath(holderDirectory))
    await once(intruder, 'connect')
    const key = (await readFile(join(holderDirectory, 'holder.key'), 'utf8')).trim()
    intruder.write(JSON.stringify({ t: 'hello', v: HOLDER_PROTOCOL, key }) + '\n')
    await waitForRuntime(() => expect(terminals.get(info.id).info.dormant).toBe(true))
    let refused: unknown
    try {
      terminals.input(info.id, 'echo lost >> lost\r')
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(HttpError)
    expect((refused as HttpError).status).toBe(503)
    expect(terminals.get(info.id).info.integrationError).toContain('Input was not sent')
    intruder.destroy()
    // The runtime retries, reattaches to the same shell and clears the note.
    await waitForRuntime(() => {
      expect(terminals.get(info.id).info.dormant).toBe(false)
      expect(terminals.get(info.id).process?.pid).toBe(shellPid)
    })
    expect(terminals.get(info.id).info.integrationError).toBeUndefined()
    terminals.input(info.id, 'echo after >> after\r')
    expect(await f.marker('after')).toBe('after\n')
    await expect(readFile(join(f.directory, 'lost'))).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it.skipIf(process.platform === 'win32')(
  'bounds input queued before the holder confirms a launch',
  async () => {
    const f = await fixture()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => (release = resolve))
    const holder = new TerminalHolder(join(f.recoveryDirectory, 'holder'), {
      startTimeout: 300,
      // The launch waits, so the terminal stays unconfirmed while input arrives.
      launch: async () => {
        await blocked
        return {}
      },
    })
    const terminal = holder.open('00000000-0000-4000-8000-0000000000aa', {
      file: '/bin/sh',
      args: [],
      cwd: f.directory,
      env: {},
      cols: 80,
      rows: 24,
    })
    terminal.write('x'.repeat(HELD_INPUT_QUEUE_LIMIT - 1))
    expect(() => terminal.write('yy')).toThrow(HolderInputError)
    terminal.write('z')
    expect(terminal.takeQueue().join('').length).toBe(HELD_INPUT_QUEUE_LIMIT)
    release()
  },
)

async function holderTerminals(directory: string) {
  const socket = connect(holderSocketPath(directory))
  await once(socket, 'connect')
  const key = (await readFile(join(directory, 'holder.key'), 'utf8')).trim()
  socket.write(JSON.stringify({ t: 'hello', v: HOLDER_PROTOCOL, key }) + '\n')
  const [chunk] = (await once(socket, 'data')) as [Buffer]
  socket.destroy()
  return (JSON.parse(chunk.toString().split('\n')[0]!) as { terminals: { id: string }[] }).terminals
}

it.skipIf(process.platform === 'win32')(
  'closes a launch the holder has not confirmed without starting it later',
  async () => {
    const f = await fixture()
    const holderDirectory = join(f.recoveryDirectory, 'holder')
    let started!: () => void
    const launched = new Promise<void>((resolve) => (started = resolve))
    const terminals = f.create(
      new TerminalHolder(holderDirectory, {
        // The holder starts only after the close, as on a slow service manager.
        launch: async (location) => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const result = await launchHolder(location)
          started()
          return result
        },
      }),
    )
    const info = f.open(terminals)
    expect(terminals.get(info.id).process?.pid).toBe(0)
    await terminals.close(info.id)
    expect(() => terminals.get(info.id)).toThrow('Terminal not found')
    await launched
    // A runtime that connects later sees no program, so nothing was created after the close.
    await waitForRuntime(async () => expect(await holderTerminals(holderDirectory)).toEqual([]))
  },
)

it.skipIf(process.platform === 'win32')(
  'keeps a terminal listed when the holder cannot confirm its close, then closes it on retry',
  async () => {
    const f = await fixture()
    const terminals = f.create()
    const info = f.open(terminals)
    await waitForRuntime(() => expect(terminals.get(info.id).process?.pid).toBeGreaterThan(0))
    const shellPid = terminals.get(info.id).process!.pid
    const holder = await f.holderPid()
    const observed: string[] = []
    terminals.observe(info.id, (event) => observed.push(event))
    process.kill(holder, 'SIGSTOP')
    try {
      const first = terminals.close(info.id)
      // A second request joins the same close instead of starting another.
      expect(terminals.close(info.id)).toBe(first)
      const error = await first.then(
        () => undefined,
        (failure: unknown) => failure,
      )
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(503)
      expect(terminals.get(info.id).info.exited).toBe(false)
      expect(observed).not.toContain('close')
    } finally {
      process.kill(holder, 'SIGCONT')
    }
    await waitForRuntime(() => expect(terminals.get(info.id).process).toBeDefined())
    await terminals.close(info.id)
    expect(() => terminals.get(info.id)).toThrow('Terminal not found')
    expect(observed.at(-1)).toBe('close')
    expect(observed).not.toContain('exit')
    expect(() => process.kill(shellPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  },
)
