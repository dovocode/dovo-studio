import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { encodeTerminalStreamFrame } from '@dovo/protocol'
import { publishConnection } from './connection'
import {
  RuntimeClient,
  WAIT_TIMEOUT_EXIT,
  attachTerminal,
  checkoutForDirectory,
  formatTerminalList,
  parseTimeout,
  parseWaitStates,
  resolveTerminal,
  runTerminalCommand,
  type TerminalIo,
  type TerminalRow,
  type TerminalSocket,
} from './terminal-cli'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const row = (id: string, title: string, extra: Partial<TerminalRow> = {}): TerminalRow => ({
  id,
  taskId: 'studio:terminals',
  title,
  exited: false,
  ...extra,
})

it('resolves IDs, names, titles and prefixes without guessing between matches', () => {
  const terminals = [
    row('aaaa1111-0000', 'Terminal 1', { customTitle: 'build' }),
    row('aaaa2222-0000', 'vim'),
    row('bbbb3333-0000', 'vim'),
    row('cccc4444-0000', 'aaaa1111-0000'),
  ]
  expect(resolveTerminal(terminals, 'aaaa1111-0000').id).toBe('aaaa1111-0000')
  expect(resolveTerminal(terminals, 'build').id).toBe('aaaa1111-0000')
  expect(resolveTerminal(terminals, 'bbbb').id).toBe('bbbb3333-0000')
  expect(() => resolveTerminal(terminals, 'vim')).toThrow(/matches 2 terminals/)
  expect(() => resolveTerminal(terminals, 'aaaa')).toThrow(/matches 2 terminals/)
  // Short references never match ID prefixes by accident.
  expect(() => resolveTerminal(terminals, 'aaa')).toThrow(/No terminal matches/)
})

it('lists terminals with unique short IDs and readable states', () => {
  expect(formatTerminalList([])).toBe('No terminals.')
  const text = formatTerminalList([
    row('12345678a-x', 'build', { directory: '/work/app' }),
    row('12345678b-x', 'Terminal 2', { exited: true, exitCode: 3 }),
    row('99999999-x', 'agent', { activity: { state: 'blocked' } }),
    row('88888888-x', 'old', { dormant: true, exited: true }),
  ])
  expect(text.split('\n')).toEqual([
    'ID         NAME        STATE     DIRECTORY',
    '12345678a  build       running   /work/app',
    '12345678b  Terminal 2  exited 3  -',
    '99999999-  agent       blocked   -',
    '88888888-  old         dormant   -',
  ])
})

it('validates wait states and timeouts', () => {
  expect(parseWaitStates('done, blocked,done')).toEqual(['done', 'blocked'])
  expect(() => parseWaitStates('working')).toThrow(/--until accepts/)
  expect(() => parseWaitStates('')).toThrow(/--until accepts/)
  expect(parseTimeout('1.5')).toBe(1500)
  expect(parseTimeout('0')).toBe(0)
  for (const value of ['', '-1', 'soon']) expect(() => parseTimeout(value)).toThrow(/--timeout/)
})

it('maps a directory only to a project root or a registered Git worktree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dovo-terminal-checkout-'))
  directories.push(root)
  const project = join(root, 'project')
  const worktree = join(root, 'feature')
  mkdirSync(join(project, 'src'), { recursive: true })
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', project, ...args], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    })
  git('init', '-q')
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'x',
  )
  git('worktree', 'add', '-q', worktree)
  const repositories = [{ id: 'p1', name: 'Project', path: project }]
  expect(await checkoutForDirectory(repositories, project, true)).toEqual({ repositoryId: 'p1' })
  expect(await checkoutForDirectory(repositories, worktree, true)).toMatchObject({
    repositoryId: 'p1',
    execution: 'worktree',
    existingWorktreePath: expect.stringMatching(/feature$/),
  })
  // An explicit subdirectory is refused; the current directory falls back to its project root.
  expect(await checkoutForDirectory(repositories, join(project, 'src'), true)).toBeUndefined()
  expect(await checkoutForDirectory(repositories, join(project, 'src'), false)).toEqual({
    repositoryId: 'p1',
  })
  expect(await checkoutForDirectory([], project, false)).toBeUndefined()
})

class FakeSocket implements TerminalSocket {
  sent: string[] = []
  private receive?: (data: string | ArrayBuffer) => void
  private resolveClosed!: (value: { code: number; reason: string }) => void
  readonly opened = Promise.resolve()
  readonly closed = new Promise<{ code: number; reason: string }>((resolve) => {
    this.resolveClosed = resolve
  })
  closedByClient = false
  onMessage(listener: (data: string | ArrayBuffer) => void) {
    this.receive = listener
    return () => {
      this.receive = undefined
    }
  }
  send(message: string) {
    this.sent.push(message)
  }
  close() {
    this.closedByClient = true
    this.resolveClosed({ code: 1000, reason: '' })
  }
  emit(data: string | ArrayBuffer) {
    this.receive?.(data)
  }
  dropped(code: number, reason: string) {
    this.resolveClosed({ code, reason })
  }
}

/** Answers ticket and summary requests. A summary waits until `exit` is called. */
class FakeClient extends RuntimeClient {
  requests: Array<{ path: string; body: unknown }> = []
  private exitCode?: number
  private exited = new EventEmitter()
  constructor() {
    super({ address: 'http://127.0.0.1:1', token: 'x'.repeat(32), pid: 1 })
  }
  exit(code: number) {
    this.exitCode = code
    this.exited.emit('exit')
  }
  override async request(path: string, body?: unknown, _timeout?: number, signal?: AbortSignal) {
    this.requests.push({ path, body })
    if (path === '/api/terminals/ticket') return { ticket: 'ticket-1' }
    if (path !== '/api/terminals/summary') throw new Error(`Unexpected ${path}`)
    if (this.exitCode === undefined)
      await new Promise<void>((resolve, reject) => {
        this.exited.once('exit', resolve)
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    return {
      id: 't1',
      running: false,
      exitCode: this.exitCode,
      outputTail: '',
      outputTruncated: false,
    }
  }
}

function ttyIo(isRaw = false) {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw,
    modes: [] as boolean[],
    setRawMode(mode: boolean) {
      stdin.modes.push(mode)
      stdin.isRaw = mode
      return stdin
    },
  })
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 40 })
  let written = ''
  stdout.on('data', (chunk: Buffer) => (written += chunk.toString()))
  const stderr = new PassThrough()
  const signals = new EventEmitter()
  const io: TerminalIo = { stdin, stdout, stderr, signals }
  return { io, stdin, stdout, signals, written: () => written }
}

it('attaches in raw mode, forwards input and resize, and restores the TTY on detach', async () => {
  const { io, stdin, stdout, signals, written } = ttyIo()
  const socket = new FakeSocket()
  const client = new FakeClient()
  const attached = attachTerminal(client, row('t1', 'build'), io, (url) => {
    expect(url).toBe('ws://127.0.0.1:1/ws/terminal?ticket=ticket-1&stream=binary-v1')
    return socket
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(stdin.modes).toEqual([true])
  expect(JSON.parse(socket.sent[0])).toEqual({ type: 'resize', cols: 120, rows: 40 })
  socket.emit('$ ')
  stdin.write('ls\r')
  stdout.columns = 90
  stdout.rows = 20
  stdout.emit('resize')
  // Text typed in the same chunk before the detach key is still delivered.
  stdin.write('x\x1dignored')
  expect(await attached).toEqual({ reason: 'detached' })
  expect(socket.sent.slice(1).map((frame) => JSON.parse(frame))).toEqual([
    { type: 'input', data: 'ls\r' },
    { type: 'resize', cols: 90, rows: 20 },
    { type: 'input', data: 'x' },
  ])
  expect(stdin.modes).toEqual([true, false])
  expect(socket.closedByClient).toBe(true)
  expect(written()).toContain('$ ')
  expect(written()).toContain('\x1b[?1049l')
  expect(signals.listenerCount('SIGTERM')).toBe(0)
  expect(stdin.listenerCount('data')).toBe(0)
})

it('acknowledges binary payload bytes only after stdout consumes them', async () => {
  const { io, signals, stdin } = ttyIo(true)
  const socket = new FakeSocket()
  const client = new FakeClient()
  const chunks: Buffer[] = []
  const consume: Array<() => void> = []
  io.stdout = new Writable({
    write(chunk: Buffer, _encoding, next) {
      chunks.push(chunk)
      consume.push(next)
    },
  })
  const attached = attachTerminal(client, row('t1', 'build'), io, () => socket)
  await new Promise((resolve) => setImmediate(resolve))
  const emit = (frame: Parameters<typeof encodeTerminalStreamFrame>[0]) => {
    const bytes = encodeTerminalStreamFrame(frame)
    socket.emit(Uint8Array.from(bytes).buffer)
  }
  const data = new TextEncoder().encode('é🙂')
  emit({ type: 'replayStart' })
  emit({ type: 'data', data })
  emit({ type: 'replayEnd' })
  emit({ type: 'pong', nonce: 'pong-1' })
  emit({ type: 'data', data: new TextEncoder().encode('tail') })
  expect(chunks.map((chunk) => chunk.toString())).toEqual(['é🙂'])
  expect(socket.sent).toEqual([])
  consume.shift()?.()
  await new Promise((resolve) => setImmediate(resolve))
  expect(chunks.map((chunk) => chunk.toString())).toEqual(['é🙂', 'tail'])
  expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([{ type: 'ack', bytes: 6 }])
  signals.emit('SIGTERM')
  expect(await attached).toEqual({ reason: 'detached' })
  consume.shift()?.()
  expect(socket.sent).toHaveLength(1)
  expect(stdin.isRaw).toBe(true)
  expect(stdin.modes).toEqual([])
  expect(signals.listenerCount('SIGTERM')).toBe(0)
})

it('disconnects and restores raw mode when a binary frame is invalid', async () => {
  const { io, stdin } = ttyIo()
  const socket = new FakeSocket()
  const attached = attachTerminal(new FakeClient(), row('t1', 'build'), io, () => socket)
  await new Promise((resolve) => setImmediate(resolve))
  socket.emit(Uint8Array.of(255).buffer)
  expect(await attached).toEqual({
    reason: 'disconnected',
    message: 'Invalid terminal stream frame',
  })
  expect(socket.sent).toHaveLength(1) // Initial resize only.
  expect(stdin.modes).toEqual([true, false])
})

it('drains received output before reporting a program exit', async () => {
  const { io } = ttyIo()
  const socket = new FakeSocket()
  const client = new FakeClient()
  let consume: (() => void) | undefined
  io.stdout = new Writable({
    write(_chunk, _encoding, next) {
      consume = next
    },
  })
  const attached = attachTerminal(client, row('t1', 'build'), io, () => socket)
  await new Promise((resolve) => setImmediate(resolve))
  socket.emit(Uint8Array.of(0, 97).buffer)
  client.exit(3)
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(socket.closedByClient).toBe(false)
  expect(socket.sent).toEqual([])
  consume?.()
  expect(await attached).toEqual({ reason: 'exited', exitCode: 3 })
  expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([{ type: 'ack', bytes: 1 }])
})

it('restores the TTY and withholds credit when stdout fails', async () => {
  const { io, stdin } = ttyIo()
  const socket = new FakeSocket()
  const output = new Writable({
    write(_chunk, _encoding, next) {
      next(new Error('Output closed'))
    },
  })
  io.stdout = output
  const attached = attachTerminal(new FakeClient(), row('t1', 'build'), io, () => socket)
  await new Promise((resolve) => setImmediate(resolve))
  socket.emit(Uint8Array.of(0, 97).buffer)
  expect(await attached).toEqual({ reason: 'disconnected', message: 'Output closed' })
  expect(stdin.modes).toEqual([true, false])
  expect(socket.sent).toEqual([])
  expect(output.listenerCount('error')).toBe(0)
})

it('ends an attachment when the program exits or the runtime drops the socket', async () => {
  const exiting = ttyIo()
  const client = new FakeClient()
  const socket = new FakeSocket()
  const attached = attachTerminal(client, row('t1', 'build'), exiting.io, () => socket)
  await new Promise((resolve) => setTimeout(resolve, 0))
  client.exit(7)
  expect(await attached).toEqual({ reason: 'exited', exitCode: 7 })
  expect(exiting.stdin.modes).toEqual([true, false])

  const dropped = ttyIo()
  const lost = new FakeSocket()
  const pending = attachTerminal(new FakeClient(), row('t1', 'build'), dropped.io, () => lost)
  await new Promise((resolve) => setTimeout(resolve, 0))
  lost.dropped(1008, 'Device revoked')
  expect(await pending).toEqual({
    reason: 'disconnected',
    message: 'The runtime closed the terminal connection (1008 Device revoked).',
  })
  expect(dropped.stdin.modes).toEqual([true, false])

  const signalled = ttyIo()
  const signalSocket = new FakeSocket()
  const interrupted = attachTerminal(
    new FakeClient(),
    row('t1', 'b'),
    signalled.io,
    () => signalSocket,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  signalled.signals.emit('SIGHUP')
  expect(await interrupted).toEqual({ reason: 'detached' })
  expect(signalled.stdin.modes).toEqual([true, false])
})

class Failure {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {}
}
async function fixtureRuntime(
  snapshot: Record<string, unknown>,
  answer: (path: string, body: Record<string, unknown>) => unknown,
) {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-terminal-cli-'))
  directories.push(directory)
  const token = 'fixture-owner-credential-for-terminal-cli'
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    expect(request.headers.authorization).toBe(`Bearer ${token}`)
    let text = ''
    for await (const chunk of request) text += String(chunk)
    const path = request.url ?? ''
    const body: Record<string, unknown> = text ? JSON.parse(text) : {}
    requests.push({ path, body })
    const result =
      path === '/api/snapshot?scope=overview'
        ? {
            owner: true,
            terminals: [],
            workspace: { repositories: [] },
            ...snapshot,
          }
        : answer(path, body)
    const status = result instanceof Failure ? result.status : result === undefined ? 404 : 200
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify(
        result instanceof Failure
          ? { error: result.error }
          : (result ?? { error: 'Endpoint not found' }),
      ),
    )
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await publishConnection(directory, {
    address: `http://127.0.0.1:${address.port}`,
    token,
    pid: process.pid,
  })
  const { io } = ttyIo()
  let output = ''
  io.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  let errors = ''
  io.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
  return {
    requests,
    output: () => output,
    errors: () => errors,
    run: (args: string[], values = {}) =>
      runTerminalCommand(directory, args, values, 'dovo-server', io),
  }
}
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('starts a remembered, named shell in the current project and prints its ID', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dovo-terminal-project-'))
  directories.push(project)
  const runtime = await fixtureRuntime(
    {
      terminalRecoverySupported: true,
      workspaceTerminalRequestIdSupported: true,
      terminals: [row('old-1', 'taken')],
      workspace: { repositories: [{ id: 'p1', name: 'App', path: project }] },
    },
    (path, body) =>
      path === '/api/terminals/workspace'
        ? row('new-1', 'Terminal 2', { directory: project })
        : path === '/api/terminals/update'
          ? row('new-1', String(body.title), { customTitle: String(body.title) })
          : undefined,
  )
  await expect(runtime.run(['start'], { name: 'taken' })).rejects.toThrow(
    'Terminal old-1 already uses the name "taken".',
  )
  await expect(runtime.run(['start'], { name: 'a\nb' })).rejects.toThrow(/one line/)
  await expect(
    runtime.run(['start'], { name: 'dev', command: 'pnpm dev', project: 'App' }),
  ).resolves.toBe(0)
  expect(runtime.output()).toBe('new-1\n')
  const created = runtime.requests.find((entry) => entry.path === '/api/terminals/workspace')
  expect(created?.body).toEqual({
    repositoryId: 'p1',
    rememberSession: true,
    command: 'pnpm dev',
    requestId: expect.any(String),
  })
  expect(runtime.requests.at(-1)).toEqual({
    path: '/api/terminals/update',
    body: { id: 'new-1', title: 'dev' },
  })
  await expect(runtime.run(['start'], { cwd: join(project, 'missing') })).rejects.toThrow(
    /is not a Dovo project root/,
  )
})

it('falls back clearly on runtimes without recovery, workspace terminals or activity waits', async () => {
  const runtime = await fixtureRuntime({ terminals: [row('t1', 'shell')] }, (path, body) =>
    path === '/api/terminals/summary'
      ? { id: body.id, running: true, outputTail: 'tail', outputTruncated: false }
      : undefined,
  )
  await expect(runtime.run(['start'], { remember: true })).rejects.toThrow(
    /cannot remember terminals/,
  )
  await expect(runtime.run(['start'])).rejects.toThrow(
    'Update this runtime to open terminals from the CLI.',
  )
  expect(runtime.errors()).toContain('cannot remember terminals')
  expect(runtime.requests.find((entry) => entry.path === '/api/terminals/workspace')?.body).toEqual(
    { rememberSession: false },
  )
  await expect(runtime.run(['wait', 'shell'], { until: 'done', timeout: '0' })).rejects.toThrow(
    'Update the runtime to wait for reported terminal activity.',
  )
  await expect(runtime.run(['wait', 'shell'], { 'after-turn': '0' })).rejects.toThrow(
    'Update the runtime to wait for newer terminal turns.',
  )
  await expect(runtime.run(['send', 'shell', '-'], { wait: true })).rejects.toThrow(
    'Update the runtime to send input and wait for a new terminal turn.',
  )
  await expect(runtime.run(['read', 'shell'], { lines: '5' })).rejects.toThrow(
    'Update the runtime to read the terminal screen.',
  )
  await expect(runtime.run(['read', 'shell'])).resolves.toBe(0)
  expect(runtime.output()).toBe('tail')
  expect(runtime.errors()).toContain('this runtime cannot read the screen')
  // No activity wait request reaches a runtime that cannot honor it.
  expect(
    runtime.requests.some(
      (entry) => entry.body.until !== undefined || entry.body.afterTurn !== undefined,
    ),
  ).toBe(false)
  expect(
    runtime.requests.some(
      (entry) => entry.path === '/api/terminals/send' || entry.path === '/api/terminals/ticket',
    ),
  ).toBe(false)
})

it('reads the rendered screen and falls back to output when the screen is not ready', async () => {
  let ready = true
  const screen = {
    id: 't1',
    cols: 80,
    rows: 24,
    buffer: 'alternate',
    cursor: { row: 0, column: 0 },
    text: 'top\nbottom',
    truncated: false,
  }
  const runtime = await fixtureRuntime(
    { terminalScreenSupported: true, terminals: [row('t1', 'vim')] },
    (path, body) =>
      path === '/api/terminals/screen'
        ? ready
          ? { ...screen, truncated: body.lines !== undefined }
          : new Failure(409, 'Terminal screen is waiting for live recovery.')
        : path === '/api/terminals/summary'
          ? { id: 't1', running: true, outputTail: 'raw tail', outputTruncated: false }
          : undefined,
  )
  await expect(runtime.run(['read', 'vim'])).resolves.toBe(0)
  await expect(runtime.run(['read', 'vim'], { lines: '40', json: true })).resolves.toBe(0)
  await expect(runtime.run(['read', 'vim'], { tail: true })).resolves.toBe(0)
  expect(runtime.output().split('\n').slice(0, 3)).toEqual([
    'top',
    'bottom',
    JSON.stringify({ source: 'screen', ...screen, truncated: true }),
  ])
  expect(runtime.output().endsWith('raw tail')).toBe(true)
  expect(
    runtime.requests.filter((entry) => entry.path === '/api/terminals/screen').map((e) => e.body),
  ).toEqual([{ id: 't1' }, { id: 't1', lines: 40 }])
  for (const lines of ['0', '301', '2.5', 'x'])
    await expect(runtime.run(['read', 'vim'], { lines })).rejects.toThrow(/--lines must/)
  await expect(runtime.run(['read', 'vim'], { lines: '3', tail: true })).rejects.toThrow(
    /Choose one/,
  )
  ready = false
  await expect(runtime.run(['read', 'vim'], { lines: '3' })).rejects.toThrow(/live recovery/)
  await expect(runtime.run(['read', 'vim'])).resolves.toBe(0)
  expect(runtime.errors()).toContain(
    'Note: Terminal screen is waiting for live recovery. Showing recent output.',
  )
})

it('opens any directory and names the shell in one request on newer runtimes', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'dovo-terminal-plain-'))
  directories.push(plain)
  const runtime = await fixtureRuntime(
    { terminalRecoverySupported: true, workspaceTerminalLaunchOptionsSupported: true },
    (path, body) =>
      path === '/api/terminals/workspace'
        ? row('new-2', String(body.name), { customTitle: String(body.name), directory: plain })
        : undefined,
  )
  await expect(runtime.run(['start'], { name: 'logs', cwd: plain })).resolves.toBe(0)
  expect(runtime.output()).toBe('new-2\n')
  expect(runtime.requests.filter((entry) => entry.path.startsWith('/api/terminals'))).toEqual([
    {
      path: '/api/terminals/workspace',
      body: { workingDirectory: plain, name: 'logs', rememberSession: true },
    },
  ])
})

it('waits for reported activity, exit or timeout with scriptable exit statuses', async () => {
  const results = ['timeout', 'activity']
  const runtime = await fixtureRuntime(
    { terminalActivityWaitSupported: true, terminals: [row('t1', 'agent')] },
    (path, body) => {
      if (path !== '/api/terminals/summary') return undefined
      if (!body.until)
        return { id: 't1', running: false, exitCode: 3, outputTail: '', outputTruncated: false }
      const waitResult = results.shift() ?? 'timeout'
      return {
        id: 't1',
        running: true,
        outputTail: '',
        outputTruncated: false,
        waitResult,
        ...(waitResult === 'activity' ? { activity: { state: 'blocked' } } : {}),
      }
    },
  )
  // A timeout slice inside a longer wait asks again instead of ending the wait.
  await expect(runtime.run(['wait', 'agent'], { until: 'blocked,done' })).resolves.toBe(0)
  expect(
    runtime.requests.filter((entry) => entry.path === '/api/terminals/summary').map((e) => e.body),
  ).toEqual([
    { id: 't1', waitMs: 20000, until: ['blocked', 'done'] },
    { id: 't1', waitMs: 20000, until: ['blocked', 'done'] },
  ])
  await expect(runtime.run(['wait', 'agent'], { until: 'done', timeout: '0' })).resolves.toBe(
    WAIT_TIMEOUT_EXIT,
  )
  await expect(runtime.run(['wait', 'agent'])).resolves.toBe(0)
  expect(runtime.output()).toBe('activity blocked\ntimeout\nexited 3\n')
})

it('uses the cursor returned by send and observes a completed turn even when another is working', async () => {
  let waits = 0
  const runtime = await fixtureRuntime(
    {
      terminalTurnsSupported: true,
      terminals: [row('t1', 'agent', { turn: 2, activity: { state: 'done' } })],
    },
    (path) => {
      if (path === '/api/terminals/send') return { turn: 4 }
      if (path !== '/api/terminals/summary') return undefined
      const first = waits++ === 0
      return {
        id: 't1',
        running: true,
        outputTail: '',
        outputTruncated: false,
        turn: first ? 4 : 6,
        activity: { state: first ? 'done' : 'working', turnId: first ? 'job-A' : 'job-B' },
        waitResult: first ? 'timeout' : 'activity',
      }
    },
  )
  await expect(
    runtime.run(['send', 'agent', 'next'], { wait: true, enter: true, json: true }),
  ).resolves.toBe(0)
  expect(runtime.requests.filter(({ path }) => path.startsWith('/api/terminals/'))).toEqual([
    { path: '/api/terminals/send', body: { id: 't1', data: 'next\r' } },
    { path: '/api/terminals/summary', body: { id: 't1', waitMs: 20000, afterTurn: 4 } },
    { path: '/api/terminals/summary', body: { id: 't1', waitMs: 20000, afterTurn: 4 } },
  ])
  expect(JSON.parse(runtime.output())).toMatchObject({
    afterTurn: 4,
    turn: 6,
    activity: { state: 'working', turnId: 'job-B' },
    waitResult: 'activity',
    settled: true,
  })
})

it('validates tracked send options before delivery and never treats an old completion as new', async () => {
  const runtime = await fixtureRuntime(
    { terminalTurnsSupported: true, terminals: [row('t1', 'agent')] },
    (path) =>
      path === '/api/terminals/send'
        ? { turn: 2 }
        : {
            id: 't1',
            running: true,
            outputTail: '',
            outputTruncated: false,
            activity: { state: 'done' },
            turn: 2,
            waitResult: 'activity',
          },
  )
  await expect(runtime.run(['send', 'agent', 'next'], { timeout: '1' })).rejects.toThrow(
    /Use --wait/,
  )
  await expect(
    runtime.run(['send', 'agent', 'next'], { wait: true, timeout: '-1' }),
  ).rejects.toThrow(/--timeout/)
  await expect(
    runtime.run(['send', 'agent', 'next'], { wait: true, until: 'working' }),
  ).rejects.toThrow(/--until/)
  for (const cursor of ['-1', '1.5', '', '9007199254740992'])
    await expect(runtime.run(['wait', 'agent'], { 'after-turn': cursor })).rejects.toThrow(
      /--after-turn/,
    )
  expect(runtime.requests.filter(({ path }) => path.startsWith('/api/terminals/'))).toEqual([])
  await expect(runtime.run(['send', 'agent', 'next'], { wait: true })).rejects.toThrow(
    /without a newer terminal turn/,
  )
  expect(runtime.requests.filter(({ path }) => path === '/api/terminals/send')).toHaveLength(1)
  expect(runtime.output()).toBe('')
})

it('does not retry tracked input over the legacy socket after a runtime error', async () => {
  const runtime = await fixtureRuntime(
    { terminalTurnsSupported: true, terminals: [row('t1', 'agent')] },
    (path) => (path === '/api/terminals/send' ? new Failure(503, 'Connection closed') : undefined),
  )
  await expect(runtime.run(['send', 'agent', 'next'], { wait: true })).rejects.toThrow(
    'Connection closed',
  )
  expect(runtime.requests.filter(({ path }) => path.startsWith('/api/terminals/'))).toEqual([
    { path: '/api/terminals/send', body: { id: 't1', data: 'next' } },
  ])
})

it('combines after-turn with activity filters and reports timeout and exit separately', async () => {
  let exited = false
  const runtime = await fixtureRuntime(
    { terminalTurnsSupported: true, terminals: [row('t1', 'agent')] },
    (path) =>
      path === '/api/terminals/summary'
        ? {
            id: 't1',
            running: !exited,
            ...(exited ? { exitCode: 7 } : {}),
            outputTail: '',
            outputTruncated: false,
            turn: 0,
            waitResult: exited ? 'exit' : 'timeout',
          }
        : undefined,
  )
  const values = { 'after-turn': '0', until: 'blocked', timeout: '0' }
  await expect(runtime.run(['wait', 'agent'], values)).resolves.toBe(WAIT_TIMEOUT_EXIT)
  exited = true
  await expect(runtime.run(['wait', 'agent'], values)).resolves.toBe(0)
  expect(runtime.output()).toBe('timeout\nexited 7\n')
  expect(
    runtime.requests
      .filter(({ path }) => path === '/api/terminals/summary')
      .map(({ body }) => body),
  ).toEqual([
    { id: 't1', waitMs: 0, until: ['blocked'], afterTurn: 0 },
    { id: 't1', waitMs: 0, until: ['blocked'], afterTurn: 0 },
  ])
})

it('resolves an explicit parent, and resolves self only by a local terminal ID', async () => {
  const parent = row('parent-id', 'coordinator')
  const runtime = await fixtureRuntime(
    {
      terminalChildrenSupported: true,
      terminalRecoverySupported: true,
      workspaceTerminalLaunchOptionsSupported: true,
      terminals: [parent, row('different-id', 'ambiguous-self')],
    },
    (path, body) =>
      path === '/api/terminals/workspace'
        ? row('child-id', 'child', { parentTerminalId: String(body.parentTerminalId) })
        : undefined,
  )
  try {
    vi.stubEnv('DOVO_TERMINAL_ID', parent.id)
    expect(await runtime.run(['start'], { parent: 'coordinator', json: true })).toBe(0)
    expect(await runtime.run(['start'], { parent: 'self', json: true })).toBe(0)
    expect(await runtime.run(['start'])).toBe(0)
    vi.stubEnv('DOVO_TERMINAL_ID', 'ambiguous-self')
    await expect(runtime.run(['start'], { parent: 'self' })).rejects.toThrow(/on this runtime/)
    vi.stubEnv('DOVO_TERMINAL_ID', undefined)
    await expect(runtime.run(['start'], { parent: 'self' })).rejects.toThrow(/on this runtime/)
  } finally {
    vi.unstubAllEnvs()
  }
  expect(
    runtime.requests
      .filter(({ path }) => path === '/api/terminals/workspace')
      .map(({ body }) => body.parentTerminalId),
  ).toEqual([parent.id, parent.id, undefined])
  expect(JSON.parse(runtime.output().split('\n')[0]!)).toMatchObject({
    parentTerminalId: parent.id,
  })
})

it('waits on direct child terminals in bounded slices and reports partial progress on timeout', async () => {
  const parent = row('p', 'parent')
  const blocked = row('b', 'builder', { parentTerminalId: 'p', activity: { state: 'blocked' } })
  const busy = row('w', 'worker', { parentTerminalId: 'p', activity: { state: 'working' } })
  let polls = 0
  const runtime = await fixtureRuntime(
    { terminalChildrenSupported: true, terminals: [parent] },
    (path, body) => {
      if (path !== '/api/terminals/children') return undefined
      if (body.until === 'any')
        return ++polls === 1
          ? { ready: false, children: [busy] }
          : { ready: true, children: [blocked] }
      return { ready: false, children: [blocked, busy] }
    },
  )
  expect(await runtime.run(['wait', 'parent'], { children: 'any', json: true })).toBe(0)
  expect(await runtime.run(['wait', 'parent'], { children: 'all', json: true, timeout: '0' })).toBe(
    WAIT_TIMEOUT_EXIT,
  )
  expect(
    runtime.requests
      .filter(({ path }) => path === '/api/terminals/children')
      .map(({ body }) => body),
  ).toEqual([
    { id: 'p', until: 'any', waitMs: 20000 },
    { id: 'p', until: 'any', waitMs: 20000 },
    { id: 'p', until: 'all', waitMs: 0 },
  ])
  expect(
    runtime
      .output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { ready: true, children: [blocked] },
    { ready: false, children: [blocked, busy] },
  ])
})

it('rejects unsupported child commands and conflicting filters before sending a child request', async () => {
  const runtime = await fixtureRuntime({ terminals: [row('p', 'parent')] }, () => undefined)
  await expect(runtime.run(['start'], { parent: 'p' })).rejects.toThrow(/Update the runtime/)
  await expect(runtime.run(['detach-parent', 'p'])).rejects.toThrow(/Update the runtime/)
  await expect(runtime.run(['wait', 'p'], { children: 'all' })).rejects.toThrow(
    /Update the runtime/,
  )
  await expect(runtime.run(['wait', 'p'], { children: 'each' })).rejects.toThrow(/any or all/)
  await expect(runtime.run(['wait', 'p'], { children: 'any', until: 'done' })).rejects.toThrow(
    /one terminal/,
  )
  await expect(runtime.run(['wait', 'p'], { children: 'all', 'after-turn': '2' })).rejects.toThrow(
    /one terminal/,
  )
  expect(runtime.requests.every(({ path }) => path.startsWith('/api/snapshot'))).toBe(true)
})

it('preserves root turn and explicit child records in JSON list and read output', async () => {
  const activity = { state: 'working', turnId: 'job-A' }
  const nextActivity = { state: 'working', turnId: 'job-B' }
  const childNotices = [{ terminalId: 'process-id', state: 'blocked', turn: 1 }] as const
  const childActivities = [
    { id: 'agent/check', activity: { state: 'blocked', kind: 'permission', turnId: 'child-A' } },
  ] as const
  const runtime = await fixtureRuntime(
    {
      terminalScreenSupported: true,
      terminals: [
        row('t1', 'agent', {
          turn: 0,
          activity,
          childActivities,
          parentTerminalId: 'parent-id',
          childNotices,
        }),
      ],
    },
    (path) =>
      path === '/api/terminals/screen'
        ? {
            id: 't1',
            cols: 80,
            rows: 24,
            buffer: 'normal',
            cursor: { row: 0, column: 0 },
            text: 'screen',
            truncated: false,
          }
        : {
            id: 't1',
            running: true,
            outputTail: 'recent',
            outputTruncated: false,
            turn: 1,
            activity: nextActivity,
          },
  )
  await expect(runtime.run(['list'], { json: true })).resolves.toBe(0)
  await expect(runtime.run(['read', 'agent'], { json: true })).resolves.toBe(0)
  await expect(runtime.run(['read', 'agent'], { json: true, tail: true })).resolves.toBe(0)
  const [list, screen, tail] = runtime
    .output()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(list).toEqual([
    expect.objectContaining({
      turn: 0,
      activity,
      childActivities,
      parentTerminalId: 'parent-id',
      childNotices,
    }),
  ])
  expect(screen).toMatchObject({
    source: 'screen',
    activity,
    turn: 0,
    childActivities,
    parentTerminalId: 'parent-id',
    childNotices,
  })
  expect(tail).toMatchObject({
    source: 'output',
    activity: nextActivity,
    turn: 1,
    childActivities,
    parentTerminalId: 'parent-id',
    childNotices,
  })
})

it.skipIf(process.platform === 'win32')(
  'drives a real runtime shell through the packaged CLI',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'dovo-terminal-e2e-'))
    directories.push(root)
    const home = join(root, 'home')
    mkdirSync(home)
    const data = join(root, 'data')
    // A private home keeps the user's shell profile and credentials out of the test.
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      SHELL: '/bin/sh',
      DOVO_LOGIN_PATH: 'off',
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_STATE_HOME: join(home, 'state'),
      XDG_DATA_HOME: join(home, 'data'),
      CODEX_HOME: join(home, 'codex'),
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
      PI_CODING_AGENT_DIR: join(home, 'pi'),
    }
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const address = probe.address()
        probe.close(() => resolve(address && typeof address === 'object' ? address.port : 0))
      })
    })
    const cli = fileURLToPath(new URL('../dist/server-cli.js', import.meta.url))
    const dovo = (...args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
        execFile(
          process.execPath,
          [cli, '--data-dir', data, ...args],
          { env },
          (error, stdout, stderr) =>
            resolve({
              code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
              stdout,
              stderr,
            }),
        ),
      )
    expect((await dovo('setup', '--host', '127.0.0.1', '--port', String(port))).code).toBe(0)
    try {
      expect((await dovo('start')).code).toBe(0)
      const started = await dovo(
        'terminal',
        'start',
        '--name',
        'e2e',
        '--command',
        'echo ready-$((40+2))',
      )
      expect(started).toMatchObject({ code: 0, stdout: expect.stringMatching(/^[0-9a-f-]{36}\n$/) })
      const id = started.stdout.trim()
      expect((await dovo('terminal', 'start', '--name', 'e2e')).stderr).toContain(
        `Terminal ${id} already uses the name "e2e".`,
      )
      const listed = JSON.parse((await dovo('terminal', 'list', '--json')).stdout)
      expect(listed).toEqual([
        expect.objectContaining({ id, title: 'e2e', customTitle: 'e2e', exited: false }),
      ])
      await expect
        .poll(async () => (await dovo('terminal', 'read', 'e2e')).stdout, { timeout: 10_000 })
        .toContain('ready-42')
      const pty = createRequire(
        new URL('../../../packages/runtime/package.json', import.meta.url),
      ).resolve('node-pty')
      const wrapper = `before=$(stty -g)
        "$@"
        status=$?
        if [ "$(stty -g)" != "$before" ]; then exit 90; fi
        printf '\\nTTY mode restored\\n'
        exit "$status"`
      const interactive = await new Promise<{ output: string; code: number }>((resolve, reject) =>
        execFile(
          process.execPath,
          [
            '-e',
            `
            const pty = require(${JSON.stringify(pty)}).spawn('/bin/sh', [
              '-c', ${JSON.stringify(wrapper)}, 'attach', process.execPath,
              ${JSON.stringify(cli)}, '--data-dir', ${JSON.stringify(data)}, 'terminal', 'attach', 'e2e',
            ], { env: process.env, cols: 100, rows: 24 });
            let output = '';
            let phase = 0;
            const timer = setTimeout(() => { process.exitCode = 91; pty.kill(); }, 12000);
            pty.onData(chunk => {
              output += chunk;
              if (phase === 0 && output.includes('ready-42')) {
                phase++;
                pty.write(${JSON.stringify(`node -e 'process.stdout.write("x".repeat(300000) + "\\nbinary-" + (40+3) + "\\n")'\r`)});
              } else if (phase === 1 && output.includes('binary-43')) {
                phase++;
                pty.write('\\x1d');
              }
            });
            pty.onExit(({exitCode}) => {
              clearTimeout(timer);
              process.stdout.write(output);
              process.exitCode ??= exitCode;
            });
          `,
          ],
          { env, timeout: 15_000 },
          (error, output) => {
            if (error && typeof error.code !== 'number') reject(error)
            else resolve({ output, code: typeof error?.code === 'number' ? error.code : 0 })
          },
        ),
      )
      if (interactive.code !== 0)
        throw new Error(
          `PTY attach exited with ${interactive.code}. ${interactive.output.slice(-400)}`,
        )
      expect(interactive.output.includes('x'.repeat(300000))).toBe(true)
      expect(interactive.output).toContain('binary-43')
      expect(interactive.output).toContain('TTY mode restored')
      expect(interactive.output).toContain('It keeps running.')
      const tracked = await dovo(
        'terminal',
        'send',
        'e2e',
        '--enter',
        '--wait',
        '--timeout',
        '5',
        '--json',
        '--',
        String.raw`printf '\033]7501;state=working\007\033]7501;state=done\007'`,
      )
      expect(tracked).toMatchObject({ code: 0 })
      expect(JSON.parse(tracked.stdout)).toMatchObject({
        afterTurn: 0,
        turn: 1,
        waitResult: 'activity',
      })
      const observed = await dovo('terminal', 'wait', 'e2e', '--after-turn', '0', '--timeout', '0')
      expect(observed).toMatchObject({ code: 0, stdout: 'turn 1\n' })
      expect((await dovo('terminal', 'send', id.slice(0, 8), '--enter', '--', 'exit 4')).code).toBe(
        0,
      )
      expect(await dovo('terminal', 'wait', 'e2e', '--timeout', '10')).toMatchObject({
        code: 0,
        stdout: 'exited 4\n',
      })
      expect((await dovo('terminal', 'close', 'e2e')).code).toBe(0)
      expect((await dovo('terminal', 'list')).stdout).toBe('No terminals.\n')
    } finally {
      await dovo('stop')
    }
  },
  90_000,
)

it('rejects invalid commands and options before reading credentials', async () => {
  const { io } = ttyIo()
  const missing = join(tmpdir(), 'dovo-terminal-cli-missing')
  const runCommand = (args: string[], values = {}) =>
    runTerminalCommand(missing, args, values, 'dovo-server', io)
  await expect(runCommand([])).rejects.toThrow(/Invalid terminal command/)
  await expect(runCommand(['list', 'extra'])).rejects.toThrow(/Invalid terminal list arguments/)
  await expect(runCommand(['read'])).rejects.toThrow(/Invalid terminal read arguments/)
  await expect(runCommand(['send', 'a', 'b', 'c'])).rejects.toThrow(/Invalid terminal send/)
  await expect(runCommand(['list'], { enter: true })).rejects.toThrow(/does not accept --enter/)
  await expect(runCommand(['list'])).rejects.toThrow(
    /No running Dovo runtime in .*dovo-terminal-cli-missing\. Start it with dovo-server start/,
  )
})
