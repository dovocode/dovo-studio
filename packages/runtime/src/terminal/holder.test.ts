/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HeldTerminal, HolderError, TerminalHolder, type HolderLauncher } from './holder-client'
import {
  HOLDER_REPLAY_LIMIT,
  HOLDER_PROTOCOL,
  HOLDER_STATE_FILE,
  HolderOutput,
  ensurePrivateDirectory,
  holderSocketPath,
  lineReader,
  type HolderMessage,
  type HolderRequest,
} from './holder-protocol'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-holder-test-'))
  // Removing the directory removes the socket. The holder then ends its programs and exits.
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const holderDirectory = join(directory, 'holder')
  // Each program records its PID and finishes once with the first line it reads.
  const program = join(directory, 'foreground.cjs')
  await writeFile(
    program,
    `const fs = require('node:fs')
fs.appendFileSync('starts', process.pid + '\\n')
console.log('READY ' + process.pid)
process.stdin.once('data', (data) => {
  fs.writeFileSync('finish', process.pid + ' ' + data.toString().trim() + '\\n')
  console.log('DONE ' + process.pid)
  process.exit(7)
})`,
  )
  const spawnRequest = {
    file: process.execPath,
    args: [program],
    cwd: directory,
    env: { PATH: process.env.PATH ?? '' },
    cols: 80,
    rows: 24,
  }
  return { directory, holderDirectory, spawnRequest }
}
function record(terminal: HeldTerminal) {
  let output = ''
  const failures: HolderError[] = []
  let exit: number | undefined
  terminal.onReady((restored) => {
    if (restored) output += restored.rawPrefix + restored.replay
  })
  terminal.onData((data) => (output += data))
  terminal.onFailure((error) => failures.push(error))
  terminal.onExit(({ exitCode }) => (exit = exitCode))
  return {
    get output() {
      return output
    },
    failures,
    get exit() {
      return exit
    },
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it.skipIf(process.platform === 'win32').each(['reattach', 'missing', 'exit', 'close'] as const)(
  'settles admission without repeating the create or its input after %s',
  async (outcome) => {
    const f = await fixture()
    ensurePrivateDirectory(f.holderDirectory)
    await writeFile(join(f.holderDirectory, 'holder.key'), 'cd'.repeat(32), { mode: 0o600 })
    const id = randomUUID()
    const state = { id, pid: 123, end: 0, process: 'shell', exited: false }
    const requests: HolderRequest[] = []
    const peers = new Set<Socket>()
    const server = createServer((socket) => {
      peers.add(socket)
      socket.once('close', () => peers.delete(socket))
      socket.setEncoding('utf8')
      const send = (...messages: HolderMessage[]) =>
        socket.write(messages.map((message) => JSON.stringify(message) + '\n').join(''))
      socket.on(
        'data',
        lineReader(
          (line) => {
            const request = JSON.parse(line) as HolderRequest
            if (request.t === 'hello') {
              send({ t: 'hello', v: HOLDER_PROTOCOL, pid: 123, terminals: [] })
              return
            }
            requests.push(request)
            if (request.t === 'create') {
              if (outcome === 'exit') {
                send(
                  { t: 'reply', r: request.r, ok: true, terminal: state },
                  { t: 'exit', id, exitCode: 7 },
                )
              } else if (outcome !== 'close') socket.destroy()
            } else if (request.t === 'attach') {
              if (outcome === 'missing')
                send({ t: 'reply', r: request.r, ok: false, missing: true, message: 'Not held' })
              else send({ t: 'reply', r: request.r, ok: true, terminal: state })
            } else if (request.t === 'close') send({ t: 'reply', r: request.r, ok: true })
          },
          () => socket.destroy(),
        ),
      )
    })
    await new Promise<void>((resolve) =>
      server.listen(holderSocketPath(f.holderDirectory), resolve),
    )
    const holder = new TerminalHolder(f.holderDirectory)
    try {
      const terminal = holder.open(id, f.spawnRequest, 'initial command\r')
      terminal.write('early interactive input\r')
      if (outcome === 'close') {
        await waitForRuntime(() => {
          if (!requests.length) throw new Error('The holder has not received the create request')
        })
        await terminal.close()
      }
      const error = await terminal.waitForAdmission().then(
        () => undefined,
        (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
      )
      const failures = { missing: 'Not held', close: 'The terminal closed before it started' }
      expect(error).toBe(
        outcome === 'missing' || outcome === 'close' ? failures[outcome] : undefined,
      )
      expect(requests.filter(({ t }) => t === 'create')).toEqual([
        expect.objectContaining({ id, initialInput: 'initial command\r' }),
      ])
      expect(requests.filter(({ t }) => t === 'attach')).toHaveLength(
        outcome === 'reattach' || outcome === 'missing' ? 1 : 0,
      )
      expect(requests.filter(({ t }) => t === 'input')).toEqual([])
      expect(terminal.exited).toBe(outcome === 'exit' || outcome === 'close')
    } finally {
      holder.disconnect()
      for (const peer of peers) peer.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'does not replay tracked input when the holder loses its delivery receipt',
  async () => {
    const f = await fixture()
    ensurePrivateDirectory(f.holderDirectory)
    await writeFile(join(f.holderDirectory, 'holder.key'), 'cd'.repeat(32), { mode: 0o600 })
    const id = randomUUID()
    const terminal = {
      id,
      pid: 123,
      end: 0,
      process: 'shell',
      exited: false,
      rootActivity: { turn: 0, activity: null, at: 0 },
    }
    const inputs: string[] = []
    const peers = new Set<Socket>()
    const server = createServer((socket) => {
      peers.add(socket)
      socket.once('close', () => peers.delete(socket))
      socket.setEncoding('utf8')
      const send = (message: HolderMessage) => socket.write(JSON.stringify(message) + '\n')
      socket.on(
        'data',
        lineReader(
          (line) => {
            const request = JSON.parse(line) as HolderRequest
            if (request.t === 'hello')
              send({ t: 'hello', v: HOLDER_PROTOCOL, pid: 123, terminals: [] })
            else if (request.t === 'create' || request.t === 'attach')
              send({ t: 'reply', r: request.r, ok: true, terminal })
            else if (request.t === 'send') {
              inputs.push(request.data)
              socket.destroy()
            }
          },
          () => socket.destroy(),
        ),
      )
    })
    await new Promise<void>((resolve) =>
      server.listen(holderSocketPath(f.holderDirectory), resolve),
    )
    const holder = new TerminalHolder(f.holderDirectory)
    try {
      const held = holder.open(id, f.spawnRequest)
      await held.waitForAdmission()
      await expect(held.inputAtTurn('once\r', () => 0)).rejects.toThrow(/may have been sent/)
      held.reattach()
      await waitForRuntime(() => expect(held.ready).toBe(true))
      expect(inputs).toEqual(['once\r'])
    } finally {
      holder.disconnect()
      for (const peer of peers) peer.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

async function holderPid(directory: string) {
  return (JSON.parse(await readFile(join(directory, HOLDER_STATE_FILE), 'utf8')) as { pid: number })
    .pid
}

it('bounds replay and returns only output after a known offset', () => {
  const output = new HolderOutput()
  output.append('a'.repeat(HOLDER_REPLAY_LIMIT))
  output.append('tail')
  expect(output.end).toBe(HOLDER_REPLAY_LIMIT + 4)
  expect(output.since().length).toBe(HOLDER_REPLAY_LIMIT)
  expect(output.since().endsWith('tail')).toBe(true)
  expect(output.since(HOLDER_REPLAY_LIMIT + 2)).toBe('il')
  // A client that fell behind the retained window gets everything that is left.
  expect(output.since(1).length).toBe(HOLDER_REPLAY_LIMIT)
})

it.skipIf(process.platform === 'win32')(
  'keeps a foreground program across a client restart and runs its input once',
  async () => {
    const f = await fixture()
    const id = randomUUID()
    const first = new TerminalHolder(f.holderDirectory)
    const created = first.open(id, f.spawnRequest)
    const before = record(created)
    await waitForRuntime(() => expect(before.output).toMatch(/READY \d+/))
    const pid = Number(/READY (\d+)/.exec(before.output)![1])
    expect(created.pid).toBe(pid)
    expect((await stat(f.holderDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(join(f.holderDirectory, 'holder.key'))).mode & 0o777).toBe(0o600)
    expect((await stat(holderSocketPath(f.holderDirectory))).isSocket()).toBe(true)
    first.disconnect()

    const second = new TerminalHolder(f.holderDirectory)
    const attached = second.open(id)
    const after = record(attached)
    await waitForRuntime(() => expect(attached.ready).toBe(true))
    expect(attached.pid).toBe(pid)
    // The new client receives the output it missed, but no input is sent again.
    expect(after.output).toContain(`READY ${pid}`)
    attached.write('continue\r')
    await waitForRuntime(() => expect(after.exit).toBe(7))
    expect(await readFile(join(f.directory, 'finish'), 'utf8')).toBe(`${pid} continue\n`)
    expect(await readFile(join(f.directory, 'starts'), 'utf8')).toBe(`${pid}\n`)
    expect(after.failures).toEqual([])

    // A retried create of a live terminal resolves to the same process.
    const again = randomUUID()
    const one = second.open(again, f.spawnRequest)
    await waitForRuntime(() => expect(one.ready).toBe(true))
    second.release(again)
    const retried = second.open(again, f.spawnRequest)
    await waitForRuntime(() => expect(retried.ready).toBe(true))
    expect(retried.pid).toBe(one.pid)
    await retried.close()
    await waitForRuntime(() => expect(alive(one.pid)).toBe(false))
    second.disconnect()
  },
)

it.skipIf(process.platform === 'win32')(
  'ends programs that no runtime claims when a runtime connects',
  async () => {
    const f = await fixture()
    const first = new TerminalHolder(f.holderDirectory)
    const orphan = first.open(randomUUID(), f.spawnRequest)
    await waitForRuntime(() => expect(orphan.ready).toBe(true))
    first.disconnect()
    const second = new TerminalHolder(f.holderDirectory)
    const kept = second.open(randomUUID(), f.spawnRequest)
    await waitForRuntime(() => expect(kept.ready).toBe(true))
    await waitForRuntime(() => expect(alive(orphan.pid)).toBe(false))
    expect(alive(kept.pid)).toBe(true)
    await kept.close()
    second.disconnect()
  },
)

it.skipIf(process.platform === 'win32')(
  'reports a stopped holder as missing and never starts one to reattach',
  async () => {
    const f = await fixture()
    const idle = new TerminalHolder(f.holderDirectory)
    const never = record(idle.open(randomUUID()))
    await waitForRuntime(() =>
      expect(never.failures.map((error) => error.kind)).toEqual(['missing']),
    )
    await expect(stat(join(f.holderDirectory, HOLDER_STATE_FILE))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const holder = new TerminalHolder(f.holderDirectory)
    const live = holder.open(randomUUID(), f.spawnRequest)
    const events = record(live)
    await waitForRuntime(() => expect(live.ready).toBe(true))
    process.kill(await holderPid(f.holderDirectory), 'SIGKILL')
    await waitForRuntime(() =>
      expect(events.failures.map((error) => error.kind)).toEqual(['missing']),
    )
    // The PTY closed with its holder, so the program received a hangup.
    await waitForRuntime(() => expect(alive(live.pid)).toBe(false))
    holder.disconnect()
  },
)

it.skipIf(process.platform === 'win32')(
  'distinguishes an incompatible or unresponsive holder from a lost one',
  async () => {
    const f = await fixture()
    ensurePrivateDirectory(f.holderDirectory)
    await writeFile(join(f.holderDirectory, 'holder.key'), 'ab'.repeat(32), { mode: 0o600 })
    let server: Server | undefined
    const serve = async (answer: boolean) => {
      server = createServer((socket) => {
        socket.on('data', () => {
          if (answer)
            socket.write(JSON.stringify({ t: 'hello', v: 999, pid: 1, terminals: [] }) + '\n')
        })
      })
      await new Promise<void>((resolve) =>
        server!.listen(holderSocketPath(f.holderDirectory), resolve),
      )
    }
    const stop = () => new Promise<void>((resolve) => server!.close(() => resolve()))
    try {
      await serve(true)
      const incompatible = record(new TerminalHolder(f.holderDirectory).open(randomUUID()))
      await waitForRuntime(() =>
        expect(incompatible.failures.map((error) => error.kind)).toEqual(['incompatible']),
      )
      expect(incompatible.failures[0]!.message).toContain('protocol 999')
      await stop()
      await serve(false)
      const silent = record(new TerminalHolder(f.holderDirectory).open(randomUUID()))
      await waitForRuntime(() =>
        expect(silent.failures.map((error) => error.kind)).toEqual(['unreachable']),
      )
    } finally {
      await stop()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'stops a holder that did not start and keeps no queued input',
  async () => {
    const f = await fixture()
    let child: ReturnType<typeof spawn> | undefined
    const holder = new TerminalHolder(f.holderDirectory, {
      startTimeout: 300,
      launch: async () => {
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
        return { abandon: async () => void child!.kill('SIGKILL') }
      },
    })
    const terminal = holder.open(randomUUID(), f.spawnRequest)
    const events = record(terminal)
    terminal.write('typed before failure\r')
    await waitForRuntime(() =>
      expect(events.failures.map((error) => error.kind)).toEqual(['failed']),
    )
    await waitForRuntime(() =>
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true),
    )
    expect(child!.signalCode).toBe('SIGKILL')
    // The caller moves this input to its fallback shell. It is not kept for a later holder.
    expect(terminal.takeQueue()).toEqual(['typed before failure\r'])
    expect(terminal.takeQueue()).toEqual([])
  },
)

it.skipIf(process.platform === 'win32')(
  'leaves an existing holder job running when it does not answer',
  async () => {
    const f = await fixture()
    const existing = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    cleanups.push(async () => void existing.kill('SIGKILL'))
    // The service manager reports that this holder's job already runs.
    const launch = vi.fn<HolderLauncher>(async () => ({}))
    const holder = new TerminalHolder(f.holderDirectory, { startTimeout: 300, launch })
    const events = record(holder.open(randomUUID(), f.spawnRequest))
    await waitForRuntime(() =>
      expect(events.failures.map((error) => error.kind)).toEqual(['unreachable']),
    )
    expect(launch).toHaveBeenCalled()
    expect(existing.exitCode).toBeNull()
    expect(alive(existing.pid!)).toBe(true)
  },
)

it.skipIf(process.platform === 'win32')(
  'never stops a holder it reached after an incompatible handshake',
  async () => {
    const f = await fixture()
    let server: Server | undefined
    const abandon = vi.fn<() => Promise<void>>(async () => {})
    const holder = new TerminalHolder(f.holderDirectory, {
      launch: async ({ directory }) => {
        // A preexisting holder from another release answers instead of the new one.
        await writeFile(join(directory, 'holder.key'), 'cd'.repeat(32), { mode: 0o600 })
        server = createServer((socket) =>
          socket.on('data', () =>
            socket.write(JSON.stringify({ t: 'hello', v: 999, pid: 1, terminals: [] }) + '\n'),
          ),
        )
        await new Promise<void>((resolve) => server!.listen(holderSocketPath(directory), resolve))
        return { abandon }
      },
    })
    try {
      const events = record(holder.open(randomUUID(), f.spawnRequest))
      await waitForRuntime(() =>
        expect(events.failures.map((error) => error.kind)).toEqual(['incompatible']),
      )
      expect(abandon).not.toHaveBeenCalled()
      expect(server!.listening).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'restores a full replay of control characters within the message limit',
  async () => {
    const f = await fixture()
    const id = randomUUID()
    const first = new TerminalHolder(f.holderDirectory)
    // More than the replay limit of BEL characters, which JSON escapes to six characters each.
    const created = first.open(id, {
      ...f.spawnRequest,
      args: [
        '-e',
        `process.stdout.write('\\x1b]7501;state=blocked:id=checks/a\\x07' + '\\x07'.repeat(${HOLDER_REPLAY_LIMIT + 4096}) + 'BELLS_DONE'); setInterval(() => {}, 1000)`,
      ],
    })
    let tail = ''
    created.onData((data) => (tail = (tail + data).slice(-64)))
    await waitForRuntime(() => expect(tail).toContain('BELLS_DONE'))
    first.disconnect()
    const second = new TerminalHolder(f.holderDirectory)
    const attached = second.open(id)
    const events = record(attached)
    let children: unknown
    attached.onChildSnapshot((records) => {
      children = records
    })
    let restored = 0
    attached.onReady((restore) => {
      restored = (restore?.rawPrefix.length ?? 0) + (restore?.replay.length ?? 0)
    })
    await waitForRuntime(() => expect(attached.ready).toBe(true))
    expect(attached.pid).toBe(created.pid)
    expect(restored).toBe(HOLDER_REPLAY_LIMIT)
    expect(children).toEqual([{ id: 'checks/a', activity: { state: 'blocked' } }])
    expect(events.failures).toEqual([])
    await attached.close()
    second.disconnect()
  },
)

it.skipIf(process.platform === 'win32')(
  'retains a held process after close fails and lets the runtime retry',
  async () => {
    const f = await fixture()
    const preload = join(f.directory, 'fail-first-stop.cjs')
    await writeFile(
      preload,
      `
      const kill = process.kill
      let fail = true
      process.kill = (pid, signal) => {
        if (fail && signal === 'SIGTERM') {
          fail = false
          throw new Error('test stop failure')
        }
        return kill(pid, signal)
      }
    `,
    )
    const holder = new TerminalHolder(f.holderDirectory, {
      launch: async ({ helper, directory }) => {
        const child = spawn(process.execPath, ['--require', preload, helper, directory], {
          stdio: 'ignore',
        })
        return { abandon: async () => void child.kill() }
      },
    })
    const id = randomUUID()
    const held = holder.open(id, {
      ...f.spawnRequest,
      file: '/bin/sh',
      args: ['-c', 'sleep 60 & echo READY; wait'],
    })
    const events = record(held)
    try {
      await waitForRuntime(() => expect(events.output).toContain('READY'))
      const pid = held.pid
      await expect(held.close()).rejects.toThrow('test stop failure')
      expect(alive(pid)).toBe(true)
      await held.close()
      await waitForRuntime(() => expect(alive(pid)).toBe(false))
    } finally {
      holder.disconnect()
    }
  },
)
