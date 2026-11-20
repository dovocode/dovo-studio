import { mkdtempSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '@dovo/runtime'
import { watchTerminalEvents, type TerminalEvent } from './terminal-events'
import { publishConnection } from './connection'
import { runTerminalCommand } from './terminal-cli'

vi.setConfig({ testTimeout: 30_000 })
const ownerToken = 'terminal-events-owner-token-with-at-least-32-characters'
let directory = ''
const cleanup: Array<() => unknown> = []
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-terminal-events-'))
  // Keep every runtime file in the temp directory, away from real user settings.
  vi.stubEnv('DOVO_DATA_ROOT', directory)
  vi.stubEnv('DOVO_SETTINGS_PATH', join(directory, 'settings.json'))
  vi.stubEnv('DOVO_TERMINAL_RECOVERY_DIRECTORY', join(directory, 'recovery'))
  vi.stubEnv('DOVO_TERMINAL_STATUS_DIRECTORY', join(directory, 'status'))
})
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

const start = async (port = 0) => {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await runtime.close()
  }
  cleanup.push(close)
  return { runtime, close }
}
// A real PTY program that runs until it reads "q".
const program = (s: Awaited<ReturnType<typeof start>>['runtime']['services'], title: string) =>
  s.terminals.createCommand(
    'task',
    directory,
    {
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.setRawMode(true); process.stdin.on('data', (d) => { if (String(d) === 'q') process.exit(3) })",
      ],
      env: {},
    },
    title,
  )
const watch = (port: number, options: { id?: string; signal?: AbortSignal } = {}) => {
  const events = watchTerminalEvents(
    { address: `http://127.0.0.1:${port}`, token: ownerToken, pid: process.pid },
    options,
  )
  cleanup.push(() => events.return())
  return async (): Promise<TerminalEvent> => {
    const result = await events.next()
    if (result.done) throw new Error('The event stream ended')
    return result.value
  }
}

it('pushes terminal lifecycle events and tells a lost connection from a closed terminal', async () => {
  const { runtime, close } = await start()
  const s = runtime.services
  const first = program(s, 'first')
  const next = watch(runtime.port)
  expect(await next()).toEqual({
    type: 'snapshot',
    terminals: [expect.objectContaining({ id: first.id, title: 'first', exited: false })],
  })

  const second = program(s, 'second')
  expect(await next()).toEqual({
    type: 'created',
    terminal: expect.objectContaining({ id: second.id, title: 'second', exited: false }),
  })

  // An exit is a change. The terminal still exists until someone closes it.
  s.terminals.input(first.id, 'q')
  expect(await next()).toMatchObject({
    type: 'changed',
    terminal: { id: first.id, exited: true, exitCode: 3 },
    previous: { id: first.id, exited: false },
  })

  await s.terminals.close(second.id)
  expect(await next()).toMatchObject({ type: 'closed', terminal: { id: second.id } })

  // A stopped runtime is a lost connection, not a closed terminal.
  const port = runtime.port
  await close()
  expect(await next()).toEqual({ type: 'connection', state: 'disconnected' })

  // A new runtime on the same address has no terminals, so the old one now really closed.
  await start(port)
  expect(await next()).toEqual({ type: 'connection', state: 'connected' })
  expect(await next()).toMatchObject({ type: 'closed', terminal: { id: first.id } })
})

it('reports one terminal when asked and stops when the caller aborts', async () => {
  const { runtime } = await start()
  const s = runtime.services
  const wanted = program(s, 'wanted')
  program(s, 'other')
  const controller = new AbortController()
  const events = watchTerminalEvents(
    { address: `http://127.0.0.1:${runtime.port}`, token: ownerToken, pid: process.pid },
    { id: wanted.id, signal: controller.signal },
  )
  cleanup.push(() => events.return())
  expect((await events.next()).value).toEqual({
    type: 'snapshot',
    terminals: [expect.objectContaining({ id: wanted.id })],
  })
  const pending = events.next()
  controller.abort()
  expect(await pending).toEqual({ done: true, value: undefined })
})

it('fails clearly when the runtime rejects the credential', async () => {
  const { runtime } = await start()
  const events = watchTerminalEvents({
    address: `http://127.0.0.1:${runtime.port}`,
    token: 'wrong-owner-token-with-at-least-32-characters',
    pid: process.pid,
  })
  cleanup.push(() => events.return())
  await expect(events.next()).rejects.toThrow('rejected the owner credential')
})

it('streams JSON lines from the events command and exits on Ctrl+C', async () => {
  const { runtime } = await start()
  const wanted = program(runtime.services, 'review')
  program(runtime.services, 'other terminal')
  await publishConnection(directory, {
    address: `http://127.0.0.1:${runtime.port}`,
    token: ownerToken,
    pid: process.pid,
  })
  const stdout = new PassThrough()
  const signals = new EventEmitter()
  let output = ''
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    if (output.endsWith('\n')) signals.emit('SIGINT')
  })
  expect(
    await runTerminalCommand(directory, ['events', 'review'], { json: true }, 'dovo-server', {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      signals,
    }),
  ).toBe(0)
  expect(JSON.parse(output)).toMatchObject({
    type: 'snapshot',
    terminals: [{ id: wanted.id }],
  })
  expect(signals.listenerCount('SIGINT')).toBe(0)
})

it('reports child-only changes and the next completed root turn on the real event stream', async () => {
  const { runtime } = await start()
  const { terminals } = runtime.services
  const terminal = terminals.createCommand(
    'task',
    directory,
    {
      command: process.execPath,
      args: [
        '-e',
        String.raw`
        const emit = (...reports) => process.stdout.write(reports.map(report => '\x1b]7501;' + report + '\x07').join(''));
        process.stdin.setRawMode(true);
        process.stdin.on('data', input => {
          if (String(input) === 'c') emit('id=agent/check:state=blocked:kind=permission');
          else emit('state=working', 'state=done');
        });
        emit('state=working', 'state=done');
      `,
      ],
      env: {},
    },
    'root',
  )
  await expect.poll(() => terminals.get(terminal.id).info.turn).toBe(1)
  const next = watch(runtime.port, { id: terminal.id })
  expect(await next()).toMatchObject({
    type: 'snapshot',
    terminals: [{ id: terminal.id, turn: 1, activity: 'done' }],
  })

  terminals.input(terminal.id, 'c')
  const childActivities = [
    { id: 'agent/check', activity: { state: 'blocked', kind: 'permission' } },
  ]
  expect(await next()).toMatchObject({
    type: 'changed',
    terminal: { id: terminal.id, turn: 1, activity: 'done', childActivities },
    previous: { turn: 1, activity: 'done' },
  })
  terminals.input(terminal.id, 'n')
  expect(await next()).toMatchObject({
    type: 'changed',
    terminal: { id: terminal.id, turn: 2, activity: 'done', childActivities },
    previous: { turn: 1, activity: 'done' },
  })
})

it('emits an event when only the reported root turn ID changes', async () => {
  const { runtime } = await start()
  const { terminals } = runtime.services
  const terminal = terminals.createCommand(
    'task',
    directory,
    {
      command: process.execPath,
      args: [
        '-e',
        String.raw`
        const report = id => process.stdout.write('\x1b]7501;state=working:turnId=' + id + '\x07');
        process.stdin.setRawMode(true);
        process.stdin.on('data', input => report(input.toString()));
        report('job-A');
      `,
      ],
      env: {},
    },
    'worker',
  )
  await expect.poll(() => terminals.get(terminal.id).info.activity?.turnId).toBe('job-A')
  const next = watch(runtime.port, { id: terminal.id })
  expect(await next()).toMatchObject({
    type: 'snapshot',
    terminals: [{ id: terminal.id, turn: 0, activity: 'working', turnId: 'job-A' }],
  })
  terminals.input(terminal.id, 'job-B')
  expect(await next()).toMatchObject({
    type: 'changed',
    previous: { turn: 0, activity: 'working', turnId: 'job-A' },
    terminal: { turn: 0, activity: 'working', turnId: 'job-B' },
  })
})
