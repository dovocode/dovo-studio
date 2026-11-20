import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Schema } from 'effect'
import {
  SCRATCH_PROJECT_ID,
  decode,
  decodeResult,
  decodeTerminalStreamFrame,
  mutableStruct,
  terminalChildActivitySchema,
  terminalChildNoticeSchema,
  terminalChildrenResultSchema,
  terminalTitleSchema,
  terminalTurnSchema,
  terminalTurnIdSchema,
} from '@dovo/protocol'
import { readConnection, type LocalConnection } from './connection.js'
import { streamTerminalEvents } from './terminal-events.js'

/** parseArgs options that only `terminal` commands accept. */
export const terminalCliOptions = {
  name: { type: 'string' },
  command: { type: 'string' },
  cwd: { type: 'string' },
  project: { type: 'string' },
  parent: { type: 'string' },
  children: { type: 'string' },
  remember: { type: 'boolean' },
  enter: { type: 'boolean' },
  wait: { type: 'boolean' },
  'after-turn': { type: 'string' },
  until: { type: 'string' },
  timeout: { type: 'string' },
  lines: { type: 'string' },
  tail: { type: 'boolean' },
} as const
export type TerminalCliValues = {
  name?: string
  command?: string
  cwd?: string
  project?: string
  parent?: string
  children?: string
  remember?: boolean
  enter?: boolean
  wait?: boolean
  'after-turn'?: string
  until?: string
  timeout?: string
  lines?: string
  tail?: boolean
  json?: boolean
}
const commandOptions: Record<string, ReadonlyArray<keyof TerminalCliValues>> = {
  start: ['name', 'command', 'cwd', 'project', 'parent', 'remember', 'json'],
  list: ['json'],
  events: ['json'],
  read: ['lines', 'tail', 'json'],
  send: ['enter', 'wait', 'until', 'timeout', 'json'],
  attach: [],
  wait: ['until', 'timeout', 'after-turn', 'children', 'json'],
  'detach-parent': ['json'],
  close: ['json'],
}
const DETACH_KEY = '\x1d'
const WAIT_STATES = ['idle', 'done', 'blocked', 'error'] as const
/** The runtime caps one summary wait at 20 seconds; longer waits repeat it. */
const WAIT_SLICE_MS = 20_000
/** Exit status for a wait that timed out, as with coreutils `timeout`. */
export const WAIT_TIMEOUT_EXIT = 124

export function terminalHelp(cliName: string) {
  return `Usage: ${cliName} terminal <command> [options]
  start                     Open a shell and print its ID
    --name <name>           Unique name to use instead of the ID
    --command <text>        Type this shell command line after the shell starts
    --cwd <directory>       Open in this directory (default: the current directory)
    --project <id|name>     Open in a Dovo project
    --parent <terminal>     Link the new shell to this parent. Use self inside a Dovo terminal
    --no-remember           Do not restore the shell after a runtime restart
  list                      Show terminals
  events [terminal]         Stream changes as JSON lines. Press Ctrl+C to stop
  read <terminal>           Print the visible screen as plain text
    --lines <1-300>         Print the last N lines, with scrollback above the screen
    --tail                  Print recent output instead (last 3000 characters, colors removed)
  send <terminal> [text|-]  Type text, or standard input with -
    --enter                 Press Enter after the text
    --wait                  Wait for a newer completed turn or program exit
    --until, --timeout      Use these wait options with --wait
  attach <terminal>         Connect this terminal. Press Ctrl+] to detach
  wait <terminal>           Wait until the program exits
    --until <states>        Also stop on reported activity: idle,done,blocked,error
    --children <any|all>    Wait for a direct child to report news or for all children to settle
    --after-turn <number>   Wait for a completed turn after this number or program exit
    --timeout <seconds>     Stop waiting and exit with status ${WAIT_TIMEOUT_EXIT}
  detach-parent <terminal> Remove its parent link and keep both programs running
  close <terminal>          Stop the program and close the terminal
  --data-dir <directory>    Runtime data directory (default: ~/.dovo)
  --json                    Print machine-readable results

<terminal> is a full ID, a name, or a unique ID prefix from list.
A project root or Git worktree keeps its Dovo project link. Runtimes without directory support
open only project roots and worktrees, else the containing project or your home directory.
Start remembers the shell when the runtime supports it.
Turn counts use the root program's activity reports. Use --enter to submit an input line.
Put -- before text that starts with a dash: send build -- --help
The CLI uses the owner credential of the runtime in --data-dir. It never pairs a device.`
}

const errorBodySchema = mutableStruct({ error: Schema.String })
const terminalObservationFields = {
  // A newer runtime can introduce another state without changing this CLI projection.
  activity: Schema.optional(
    mutableStruct({ state: Schema.String, turnId: Schema.optional(terminalTurnIdSchema) }),
  ),
  turn: Schema.optional(terminalTurnSchema),
  childActivities: Schema.optional(Schema.Array(terminalChildActivitySchema)),
  parentTerminalId: Schema.optional(Schema.String),
  childNotices: Schema.optional(Schema.Array(terminalChildNoticeSchema)),
}
const terminalRowSchema = mutableStruct({
  id: Schema.String,
  taskId: Schema.String,
  title: Schema.String,
  customTitle: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  repositoryId: Schema.optional(Schema.String),
  exited: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
  dormant: Schema.optional(Schema.Boolean),
  ...terminalObservationFields,
})
export type TerminalRow = typeof terminalRowSchema.Type
const repositoryRowSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  kind: Schema.optional(Schema.String),
})
export type RepositoryRow = typeof repositoryRowSchema.Type
/** Only the fields this CLI reads, so newer runtimes with extra fields still decode. */
const overviewSchema = mutableStruct({
  owner: Schema.Boolean,
  terminals: Schema.Array(terminalRowSchema),
  terminalRecoverySupported: Schema.optional(Schema.Boolean),
  workspaceTerminalRequestIdSupported: Schema.optional(Schema.Boolean),
  workspaceTerminalLaunchOptionsSupported: Schema.optional(Schema.Boolean),
  terminalScreenSupported: Schema.optional(Schema.Boolean),
  terminalActivityWaitSupported: Schema.optional(Schema.Boolean),
  terminalTurnsSupported: Schema.optional(Schema.Boolean),
  terminalChildrenSupported: Schema.optional(Schema.Boolean),
  workspace: mutableStruct({ repositories: Schema.Array(repositoryRowSchema) }),
})
type Overview = typeof overviewSchema.Type
const summarySchema = mutableStruct({
  id: Schema.String,
  running: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
  outputTail: Schema.String,
  outputTruncated: Schema.Boolean,
  waitResult: Schema.optional(Schema.Literals(['activity', 'exit', 'timeout'])),
  ...terminalObservationFields,
})
type Summary = typeof summarySchema.Type
/** The rendered grid from POST /api/terminals/screen. */
const screenSchema = mutableStruct({
  id: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
  buffer: Schema.String,
  cursor: mutableStruct({ row: Schema.Number, column: Schema.Number }),
  text: Schema.String,
  truncated: Schema.Boolean,
})

export class RuntimeRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class RuntimeClient {
  constructor(readonly connection: LocalConnection) {}
  async request(
    path: string,
    body?: unknown,
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(this.connection.address + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.connection.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(
        `Could not reach the Dovo runtime at ${this.connection.address}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    const text = await response.text()
    if (!response.ok) {
      let message = text
      try {
        const parsed = decodeResult(errorBodySchema, JSON.parse(text))
        if (parsed.success) message = parsed.data.error
      } catch {
        // Keep the raw body; an old or proxied runtime can answer with plain text.
      }
      throw new RuntimeRequestError(
        response.status,
        response.status === 401
          ? 'The runtime rejected the owner credential in this data directory.'
          : message || `Runtime returned HTTP ${response.status}`,
      )
    }
    return text ? JSON.parse(text) : undefined
  }
}

/** The owner credential comes only from the selected data directory, never from other runtimes. */
export function terminalClient(directory: string, cliName: string) {
  const path = join(directory, 'runtime-connection.json')
  let connection: LocalConnection
  try {
    connection = readConnection(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error(
        `No running Dovo runtime in ${directory}. Start it with ${cliName} start --data-dir ${JSON.stringify(directory)}.`,
        { cause: error },
      )
    throw error
  }
  return new RuntimeClient(connection)
}

async function overview(client: RuntimeClient): Promise<Overview> {
  const snapshot = decode(overviewSchema, await client.request('/api/snapshot?scope=overview'))
  if (!snapshot.owner)
    throw new Error('The credential in this data directory is not the runtime owner.')
  return snapshot
}

/** Exact ID, then exact name, then exact title, then a unique ID prefix. Never guesses between matches. */
export function resolveTerminal(terminals: readonly TerminalRow[], reference: string): TerminalRow {
  const byId = terminals.find((terminal) => terminal.id === reference)
  if (byId) return byId
  const levels = [
    terminals.filter((terminal) => terminal.customTitle === reference),
    terminals.filter((terminal) => terminal.title === reference),
    reference.length >= 4 ? terminals.filter((terminal) => terminal.id.startsWith(reference)) : [],
  ]
  for (const matches of levels) {
    if (matches.length === 1) return matches[0]
    if (matches.length > 1)
      throw new Error(
        `"${reference}" matches ${matches.length} terminals. Use an ID:\n${matches.map((terminal) => `${terminal.id}  ${terminal.title}`).join('\n')}`,
      )
  }
  throw new Error(`No terminal matches "${reference}". Run terminal list to see terminals.`)
}

function terminalState(terminal: TerminalRow) {
  if (terminal.dormant) return 'dormant'
  if (terminal.exited)
    return terminal.exitCode === undefined ? 'exited' : `exited ${terminal.exitCode}`
  return terminal.activity?.state ?? 'running'
}

/** The shortest ID prefix, at least 8 characters, that identifies every listed terminal. */
function shortIdLength(terminals: readonly TerminalRow[]) {
  for (let length = 8; ; length++) {
    const prefixes = new Set(terminals.map((terminal) => terminal.id.slice(0, length)))
    if (prefixes.size === terminals.length || terminals.every((t) => t.id.length <= length))
      return length
  }
}

export function formatTerminalList(terminals: readonly TerminalRow[]) {
  if (!terminals.length) return 'No terminals.'
  const length = shortIdLength(terminals)
  const rows = [
    ['ID', 'NAME', 'STATE', 'DIRECTORY'],
    ...terminals.map((terminal) => [
      terminal.id.slice(0, length),
      terminal.title,
      terminalState(terminal),
      terminal.directory ?? '-',
    ]),
  ]
  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => row[column].length)))
  return rows
    .map((row) => row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column]) : cell)))
    .map((row) => row.join('  ').trimEnd())
    .join('\n')
}

const run = promisify(execFile)
async function git(directory: string, args: string[]) {
  try {
    const { stdout } = await run('git', ['-C', directory, ...args], {
      timeout: 5000,
      windowsHide: true,
    })
    return stdout
  } catch {
    return undefined
  }
}
function canonical(path: string) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
function samePath(left: string, right: string) {
  return resolve(left) === resolve(right) || canonical(left) === canonical(right)
}

export type TerminalCheckout = {
  /** Owner-only absolute directory outside the project model. Needs launch option support. */
  workingDirectory?: string
  repositoryId?: string
  execution?: 'worktree'
  existingWorktreePath?: string
}

/**
 * Map a directory to the runtime's project model. The runtime opens shells only in a project root
 * or one of its registered Git worktrees, so the CLI never sends an arbitrary path.
 */
export async function checkoutForDirectory(
  repositories: readonly RepositoryRow[],
  directory: string,
  exact: boolean,
): Promise<TerminalCheckout | undefined> {
  const projects = repositories.filter((repository) => repository.kind !== 'scratch')
  const root = projects.find((repository) => samePath(repository.path, directory))
  if (root) return { repositoryId: root.id }
  const lines = (
    await git(directory, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ])
  )
    ?.split(/\r?\n/)
    .filter(Boolean)
  if (!lines || lines.length < 2) return undefined
  const [top, common] = lines
  if (exact && !samePath(top, directory)) return undefined
  const main = projects.find(
    (repository) => !repository.kind && samePath(repository.path, dirname(common)),
  )
  if (!main) return undefined
  if (samePath(main.path, top)) return { repositoryId: main.id }
  // The runtime compares Git's own worktree record, so send that exact path.
  const records = (await git(main.path, ['worktree', 'list', '--porcelain', '-z']))
    ?.split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => field.slice('worktree '.length))
  const record = records?.find((path) => samePath(path, top))
  return record
    ? { repositoryId: main.id, execution: 'worktree', existingWorktreePath: record }
    : undefined
}

export function projectByReference(repositories: readonly RepositoryRow[], reference: string) {
  const byId = repositories.find((repository) => repository.id === reference)
  if (byId) return byId
  const byName = repositories.filter((repository) => repository.name === reference)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1)
    throw new Error(
      `"${reference}" matches ${byName.length} projects. Use a project ID:\n${byName.map((repository) => `${repository.id}  ${repository.path}`).join('\n')}`,
    )
  throw new Error(`No Dovo project matches "${reference}".`)
}

export function parseWaitStates(value: string) {
  const states = value
    .split(',')
    .map((state) => state.trim())
    .filter(Boolean)
  const invalid = states.filter((state) => !(WAIT_STATES as readonly string[]).includes(state))
  if (!states.length || invalid.length)
    throw new Error(`--until accepts ${WAIT_STATES.join(', ')}. Program exit always ends the wait.`)
  return [...new Set(states)] as Array<(typeof WAIT_STATES)[number]>
}

export function parseLines(value: string) {
  const lines = Number(value)
  if (!/^\d+$/.test(value) || lines < 1 || lines > 300)
    throw new Error('--lines must be a whole number from 1 to 300.')
  return lines
}

export function parseTimeout(value: string) {
  const ms = Number(value) * 1000
  if (!value.trim() || !Number.isFinite(ms) || ms < 0)
    throw new Error('--timeout must be a number of seconds, 0 or more.')
  return Math.ceil(ms)
}

function parseAfterTurn(value: string) {
  const turn = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(turn))
    throw new Error('--after-turn must be a whole number, 0 or more.')
  return turn
}

/** Stay below the runtime's input schema and WebSocket limits, even for JSON-escaped text. */
function inputFrames(data: string) {
  const frames: string[] = []
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + 16 * 1024, data.length)
    const last = data.charCodeAt(end - 1)
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
    frames.push(JSON.stringify({ type: 'input', data: data.slice(start, end) }))
    start = end
  }
  return frames
}

export interface TerminalSocket {
  /** Resolves when the socket opens. Rejects if it closes or fails first. */
  readonly opened: Promise<void>
  /** Resolves once with the close code and reason. */
  readonly closed: Promise<{ code: number; reason: string }>
  onMessage(listener: (data: string | ArrayBuffer) => void): () => void
  send(message: string): void
  close(): void
}

export function openTerminalSocket(url: string): TerminalSocket {
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.addEventListener('close', (event) =>
      resolve({ code: event.code, reason: event.reason }),
    ),
  )
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    void closed.then(({ code, reason }) =>
      reject(new Error(`Terminal connection closed (${code}${reason ? ` ${reason}` : ''})`)),
    )
  })
  opened.catch(() => {})
  return {
    opened,
    closed,
    onMessage: (listener) => {
      const receive = (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'string' || event.data instanceof ArrayBuffer)
          listener(event.data)
      }
      socket.addEventListener('message', receive)
      return () => socket.removeEventListener('message', receive)
    },
    send: (message) => socket.send(message),
    close: () => socket.close(1000),
  }
}

async function terminalSocket(
  client: RuntimeClient,
  id: string,
  connect: (url: string) => TerminalSocket,
  binary = false,
) {
  const { ticket } = decode(
    mutableStruct({ ticket: Schema.String }),
    await client.request('/api/terminals/ticket', { id }),
  )
  const url = new URL(
    `/ws/terminal?ticket=${encodeURIComponent(ticket)}`,
    client.connection.address,
  )
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (binary) url.searchParams.set('stream', 'binary-v1')
  return connect(url.toString())
}

/** WebSocket frames arrive in order, so a clean close after the input frames delivers them all. */
async function sendInput(
  client: RuntimeClient,
  id: string,
  data: string,
  connect: (url: string) => TerminalSocket,
) {
  const socket = await terminalSocket(client, id, connect)
  await socket.opened
  for (const frame of inputFrames(data)) socket.send(frame)
  socket.close()
  const { code, reason } = await socket.closed
  if (code !== 1000 && code !== 1005)
    throw new Error(
      `The runtime closed the terminal connection (${code}${reason ? ` ${reason}` : ''})`,
    )
}

type TtyInput = NodeJS.ReadableStream & {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (mode: boolean) => unknown
  setEncoding(encoding: BufferEncoding): unknown
}
type TtyOutput = NodeJS.WritableStream & {
  isTTY?: boolean
  columns?: number
  rows?: number
  on(event: 'resize', listener: () => void): unknown
  off(event: 'resize', listener: () => void): unknown
}
export type TerminalIo = {
  stdin: TtyInput
  stdout: TtyOutput
  stderr: NodeJS.WritableStream
  /** Signals that must end an attachment cleanly. Tests pass a plain emitter. */
  signals: Pick<NodeJS.EventEmitter, 'on' | 'off'>
}

/** Undo modes a program may have left on, so the user's own shell works after detach. */
const RESET_TERMINAL =
  '\x1b[0m\x1b[?25h\x1b[?1l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1049l'

export type AttachResult =
  | { reason: 'detached' }
  | { reason: 'exited'; exitCode?: number }
  | { reason: 'disconnected'; message: string }

export async function attachTerminal(
  client: RuntimeClient,
  terminal: TerminalRow,
  io: TerminalIo,
  connect: (url: string) => TerminalSocket = openTerminalSocket,
): Promise<AttachResult> {
  const socket = await terminalSocket(client, terminal.id, connect, true)
  const { stdin, stdout } = io
  const watch = new AbortController()
  let settle: (result: AttachResult) => void = () => {}
  const result = new Promise<AttachResult>((resolve) => {
    settle = resolve
  })
  let finished = false
  let attached = false
  let rawChanged = false
  let detachSocket = () => {}
  let pendingWrites = 0
  let exit: Extract<AttachResult, { reason: 'exited' }> | undefined
  let exitTimer: ReturnType<typeof setTimeout> | undefined
  let legacy = false
  const scheduleExit = () => {
    clearTimeout(exitTimer)
    // Exit arrives over HTTP. Wait for stdout and allow the last socket frames to arrive.
    const outcome = exit
    if (!finished && outcome && pendingWrites === 0)
      exitTimer = setTimeout(() => finish(outcome), 200)
  }
  const fail = (error: unknown, reset = true) =>
    finish(
      { reason: 'disconnected', message: error instanceof Error ? error.message : String(error) },
      reset,
    )
  const send = (frame: string) => {
    if (finished) return
    try {
      socket.send(frame)
    } catch (error) {
      fail(error)
    }
  }
  const resize = () => {
    if (!stdout.isTTY || !stdout.columns || !stdout.rows) return
    send(
      JSON.stringify({
        type: 'resize',
        cols: Math.min(500, Math.max(2, stdout.columns)),
        rows: Math.min(300, Math.max(1, stdout.rows)),
      }),
    )
  }
  const onInput = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const detach = text.indexOf(DETACH_KEY)
    const data = detach < 0 ? text : text.slice(0, detach)
    for (const frame of inputFrames(data)) send(frame)
    if (detach >= 0) finish({ reason: 'detached' })
  }
  const onEnd = () => finish({ reason: 'detached' })
  const onSignal = () => finish({ reason: 'detached' })
  const onOutputError = (error: Error) => fail(error, false)
  const releaseOutput = () => {
    if (!pendingWrites) stdout.off('error', onOutputError)
  }
  const restore = () => {
    if (rawChanged) stdin.setRawMode?.(false)
  }
  function finish(outcome: AttachResult, reset = true) {
    if (finished) return
    finished = true
    watch.abort()
    clearTimeout(exitTimer)
    detachSocket()
    stdin.off('data', onInput)
    stdin.off('end', onEnd)
    if (attached) stdin.pause()
    stdout.off('resize', resize)
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) io.signals.off(signal, onSignal)
    process.off('exit', restore)
    try {
      restore()
      if (attached && stdout.isTTY && reset) write(RESET_TERMINAL)
    } finally {
      releaseOutput()
      try {
        socket.close()
      } finally {
        settle(outcome)
      }
    }
  }
  function write(data: string | Uint8Array) {
    pendingWrites++
    scheduleExit()
    const consumed = (error?: Error | null) => {
      pendingWrites--
      if (error) {
        // A Writable emits its error after this callback. Keep the listener until then.
        setImmediate(() => {
          onOutputError(error)
          releaseOutput()
        })
        return
      }
      if (finished) return releaseOutput()
      if (typeof data !== 'string') send(JSON.stringify({ type: 'ack', bytes: data.byteLength }))
      scheduleExit()
    }
    try {
      stdout.write(data, consumed)
    } catch (error) {
      consumed(error instanceof Error ? error : new Error(String(error)))
    }
  }
  stdout.on('error', onOutputError)
  detachSocket = socket.onMessage((data) => {
    if (finished) return
    try {
      if (typeof data === 'string') {
        // Older runtimes ignore the stream request and keep sending plain text.
        legacy = true
        write(data)
      } else if (!legacy) {
        const frame = decodeTerminalStreamFrame(new Uint8Array(data))
        if (frame.type === 'data' && frame.data.length) write(frame.data)
      }
    } catch (error) {
      fail(error)
    }
  })
  void socket.closed.then(({ code, reason }) =>
    finish({
      reason: 'disconnected',
      message: `The runtime closed the terminal connection (${code}${reason ? ` ${reason}` : ''}).`,
    }),
  )
  try {
    await socket.opened
    if (finished) return result
    attached = true
    process.once('exit', restore)
    if (stdin.isTTY && stdin.setRawMode && !stdin.isRaw) {
      stdin.setRawMode(true)
      rawChanged = true
    }
    stdin.setEncoding('utf8')
    stdin.on('data', onInput)
    stdin.on('end', onEnd)
    stdout.on('resize', resize)
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) io.signals.on(signal, onSignal)
    stdin.resume()
    resize()
  } catch (error) {
    fail(error)
    return result
  }
  void (async () => {
    // The socket does not report program exit, so wait for it through the summary API.
    while (!watch.signal.aborted) {
      const summary = decode(
        summarySchema,
        await client.request(
          '/api/terminals/summary',
          { id: terminal.id, waitMs: WAIT_SLICE_MS },
          WAIT_SLICE_MS + 15_000,
          watch.signal,
        ),
      )
      if (!summary.running) {
        exit = { reason: 'exited', exitCode: summary.exitCode }
        scheduleExit()
        return
      }
    }
  })().catch((error: unknown) => {
    if (watch.signal.aborted) return
    fail(error)
  })
  return result
}

async function readAll(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  for await (const chunk of stream)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

type WaitOptions = {
  until?: ReturnType<typeof parseWaitStates>
  timeoutMs?: number
  afterTurn?: number
}

async function waitInSlices<T>(
  timeoutMs: number | undefined,
  read: (waitMs: number) => Promise<T>,
  ready: (result: T) => boolean,
) {
  const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs
  for (;;) {
    const waitMs = Math.min(WAIT_SLICE_MS, Math.max(0, deadline - Date.now()))
    const result = await read(waitMs)
    if (ready(result) || Date.now() >= deadline) return result
  }
}

async function waitForTerminal(
  client: RuntimeClient,
  id: string,
  { until, timeoutMs, afterTurn }: WaitOptions,
): Promise<{ summary: Summary; settled: boolean }> {
  const tracksActivity = until !== undefined || afterTurn !== undefined
  return waitInSlices(
    timeoutMs,
    async (waitMs) => {
      const response = await client.request(
        '/api/terminals/summary',
        { id, waitMs, until, afterTurn },
        waitMs + 15_000,
      )
      const summary = decode(summarySchema, response)
      if (tracksActivity && summary.waitResult === undefined)
        throw new Error(
          afterTurn === undefined
            ? 'Update the runtime to wait for reported terminal activity.'
            : 'The runtime did not report the result of the turn wait. Update the runtime.',
        )
      if (
        afterTurn !== undefined &&
        summary.waitResult === 'activity' &&
        (summary.turn === undefined || summary.turn <= afterTurn)
      )
        throw new Error('The runtime returned a completion without a newer terminal turn.')
      const settled = tracksActivity ? summary.waitResult !== 'timeout' : !summary.running
      return { summary, settled }
    },
    (result) => result.settled,
  )
}

async function reportWait(
  client: RuntimeClient,
  id: string,
  options: WaitOptions,
  json: boolean | undefined,
  print: (value: string) => void,
) {
  const { summary, settled } = await waitForTerminal(client, id, options)
  const { afterTurn, until } = options
  const outcome = !settled
    ? 'timeout'
    : summary.waitResult === 'exit' || !summary.running
      ? `exited${summary.exitCode === undefined ? '' : ` ${summary.exitCode}`}`
      : afterTurn !== undefined
        ? `turn ${summary.turn}${until && summary.activity ? ` activity ${summary.activity.state}` : ''}`
        : `activity ${summary.activity?.state ?? ''}`.trimEnd()
  print(json ? JSON.stringify({ ...summary, settled, afterTurn }) : outcome)
  return settled ? 0 : WAIT_TIMEOUT_EXIT
}

/** Runs one terminal command and returns the process exit status. */
export async function runTerminalCommand(
  directory: string,
  args: readonly string[],
  values: TerminalCliValues,
  cliName: string,
  io: TerminalIo,
  connect: (url: string) => TerminalSocket = openTerminalSocket,
): Promise<number> {
  const [command, reference, ...rest] = args
  const allowed = command ? commandOptions[command] : undefined
  if (!allowed) throw new Error(`Invalid terminal command. Run ${cliName} terminal --help.`)
  const extra = (Object.keys(values) as Array<keyof TerminalCliValues>).filter(
    (key) => values[key] !== undefined && !allowed.includes(key),
  )
  if (extra.length)
    throw new Error(
      `terminal ${command} does not accept ${extra.map((key) => `--${key}`).join(', ')}.`,
    )
  const takesTerminal = !['start', 'list'].includes(command)
  if (
    (command !== 'events' && (takesTerminal ? !reference : reference !== undefined)) ||
    rest.length > (command === 'send' ? 1 : 0)
  )
    throw new Error(`Invalid terminal ${command} arguments. Run ${cliName} terminal --help.`)
  const print = (value: string) => io.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
  const client = terminalClient(directory, cliName)
  const snapshot = await overview(client)

  if (command === 'events') {
    const id =
      reference === undefined ? undefined : resolveTerminal(snapshot.terminals, reference).id
    await streamTerminalEvents(client.connection, id, io)
    return 0
  }
  if (command === 'list') {
    print(values.json ? JSON.stringify(snapshot.terminals) : formatTerminalList(snapshot.terminals))
    return 0
  }
  if (command === 'start') return startTerminal(client, snapshot, values, io, print)
  if (!reference) throw new Error(`terminal ${command} needs a terminal ID or name.`)

  const terminal = resolveTerminal(snapshot.terminals, reference)
  if (command === 'read') {
    const observation = {
      turn: terminal.turn,
      childActivities: terminal.childActivities,
      parentTerminalId: terminal.parentTerminalId,
      childNotices: terminal.childNotices,
    }
    const lines = values.lines === undefined ? undefined : parseLines(values.lines)
    if (values.tail && lines !== undefined)
      throw new Error('--lines reads the screen and --tail reads recent output. Choose one.')
    if (!values.tail) {
      if (!snapshot.terminalScreenSupported) {
        if (lines !== undefined) throw new Error('Update the runtime to read the terminal screen.')
        io.stderr.write('Note: this runtime cannot read the screen. Showing recent output.\n')
      } else
        try {
          const screen = decode(
            screenSchema,
            await client.request('/api/terminals/screen', {
              id: terminal.id,
              ...(lines === undefined ? {} : { lines }),
            }),
          )
          print(
            values.json
              ? JSON.stringify({
                  source: 'screen',
                  ...screen,
                  activity: terminal.activity,
                  ...observation,
                })
              : screen.text,
          )
          return 0
        } catch (error) {
          // 409: the screen is not ready (for example during live recovery). Output still is.
          if (
            !(error instanceof RuntimeRequestError && error.status === 409) ||
            lines !== undefined
          )
            throw error
          io.stderr.write(`Note: ${error.message} Showing recent output.\n`)
        }
    }
    const summary = decode(
      summarySchema,
      await client.request('/api/terminals/summary', { id: terminal.id }),
    )
    if (values.json) print(JSON.stringify({ source: 'output', ...observation, ...summary }))
    else if (summary.outputTail) io.stdout.write(summary.outputTail)
    return 0
  }
  if (command === 'send') {
    const text = rest[0]
    if (text === undefined && !values.enter)
      throw new Error('Give text to send, - for standard input, or --enter.')
    if (!values.wait && (values.until !== undefined || values.timeout !== undefined))
      throw new Error('Use --wait with --until or --timeout when sending input.')
    const until = values.until === undefined ? undefined : parseWaitStates(values.until)
    const timeoutMs = values.timeout === undefined ? undefined : parseTimeout(values.timeout)
    if (values.wait && !snapshot.terminalTurnsSupported)
      throw new Error('Update the runtime to send input and wait for a new terminal turn.')
    if (terminal.exited) throw new Error(`Terminal ${terminal.title} has exited.`)
    const data =
      (text === '-' ? await readAll(io.stdin) : (text ?? '')) + (values.enter ? '\r' : '')
    if (values.wait) {
      if (!data) throw new Error('Give input or use --enter to wait for a new terminal turn.')
      const sent = decode(
        mutableStruct({ turn: terminalTurnSchema }),
        await client.request('/api/terminals/send', { id: terminal.id, data }),
      )
      return reportWait(
        client,
        terminal.id,
        { afterTurn: sent.turn, until, timeoutMs },
        values.json,
        print,
      )
    }
    await sendInput(client, terminal.id, data, connect)
    if (values.json) print(JSON.stringify({ id: terminal.id, characters: data.length }))
    return 0
  }
  if (command === 'wait') {
    const timeoutMs = values.timeout === undefined ? undefined : parseTimeout(values.timeout)
    if (values.children !== undefined) {
      const mode = values.children
      if (mode !== 'any' && mode !== 'all') throw new Error('--children accepts any or all.')
      if (values.until !== undefined || values['after-turn'] !== undefined)
        throw new Error('Use --until and --after-turn only when waiting on one terminal.')
      if (!snapshot.terminalChildrenSupported)
        throw new Error('Update the runtime to wait for child terminals.')
      const result = await waitInSlices(
        timeoutMs,
        async (waitMs) =>
          decode(
            terminalChildrenResultSchema,
            await client.request(
              '/api/terminals/children',
              { id: terminal.id, until: mode, waitMs },
              waitMs + 15_000,
            ),
          ),
        (result) => result.ready,
      )
      if (values.json) print(JSON.stringify(result))
      else {
        if (!result.ready) print('timeout')
        print(result.children.length ? formatTerminalList(result.children) : 'No child terminals.')
      }
      return result.ready ? 0 : WAIT_TIMEOUT_EXIT
    }
    const until = values.until === undefined ? undefined : parseWaitStates(values.until)
    const afterTurn =
      values['after-turn'] === undefined ? undefined : parseAfterTurn(values['after-turn'])
    if (afterTurn !== undefined && !snapshot.terminalTurnsSupported)
      throw new Error('Update the runtime to wait for newer terminal turns.')
    if (until && afterTurn === undefined && !snapshot.terminalActivityWaitSupported)
      throw new Error('Update the runtime to wait for reported terminal activity.')
    return reportWait(client, terminal.id, { until, timeoutMs, afterTurn }, values.json, print)
  }
  if (command === 'detach-parent') {
    if (!snapshot.terminalChildrenSupported)
      throw new Error('Update the runtime to detach a child terminal.')
    const detached = decode(
      terminalRowSchema,
      await client.request('/api/terminals/update', {
        id: terminal.id,
        parentTerminalId: null,
      }),
    )
    if (values.json) print(JSON.stringify(detached))
    return 0
  }
  if (command === 'close') {
    await client.request('/api/terminals/close', { id: terminal.id })
    if (values.json) print(JSON.stringify({ id: terminal.id, closed: true }))
    return 0
  }
  if (terminal.exited || terminal.dormant)
    throw new Error(
      `Terminal ${terminal.title} is ${terminal.dormant ? 'dormant. Restore it in Dovo first' : 'not running'}.`,
    )
  io.stderr.write(`Attached to ${terminal.title}. Press Ctrl+] to detach.\r\n`)
  const result = await attachTerminal(client, terminal, io, connect)
  if (result.reason === 'detached') {
    io.stderr.write(`\r\nDetached from ${terminal.title}. It keeps running.\n`)
    return 0
  }
  if (result.reason === 'exited') {
    io.stderr.write(
      `\r\n${terminal.title} exited${result.exitCode === undefined ? '' : ` with code ${result.exitCode}`}.\n`,
    )
    return result.exitCode ?? 0
  }
  io.stderr.write(`\r\n${result.message}\n`)
  return 1
}

async function startTerminal(
  client: RuntimeClient,
  snapshot: Overview,
  values: TerminalCliValues,
  io: TerminalIo,
  print: (value: string) => void,
) {
  let parentTerminalId: string | undefined
  if (values.parent !== undefined) {
    if (!snapshot.terminalChildrenSupported)
      throw new Error('Update the runtime to launch a child terminal.')
    if (values.parent === 'self') {
      parentTerminalId = process.env.DOVO_TERMINAL_ID
      if (
        !parentTerminalId ||
        !snapshot.terminals.some((terminal) => terminal.id === parentTerminalId)
      )
        throw new Error('--parent self requires a Dovo terminal on this runtime.')
    } else {
      parentTerminalId = resolveTerminal(snapshot.terminals, values.parent).id
    }
  }
  const name = values.name
  if (name !== undefined) {
    if (!decodeResult(terminalTitleSchema, name).success)
      throw new Error('A terminal name must be one line of 1 to 256 characters.')
    const taken = snapshot.terminals.find(
      (terminal) => terminal.customTitle === name || terminal.title === name,
    )
    if (taken) throw new Error(`Terminal ${taken.id} already uses the name "${name}".`)
  }
  if (values.project !== undefined && values.cwd !== undefined)
    throw new Error('Choose --cwd or --project, not both.')
  const repositories = snapshot.workspace.repositories
  // Newer runtimes let the owner open any local directory and set the name atomically.
  const launchOptions = Boolean(snapshot.workspaceTerminalLaunchOptionsSupported)
  let checkout: TerminalCheckout
  if (values.project !== undefined) {
    const project = projectByReference(repositories, values.project)
    checkout = { repositoryId: project.kind === 'scratch' ? SCRATCH_PROJECT_ID : project.id }
  } else {
    // A project root or worktree keeps its project link. Other directories open as plain folders.
    const requested = resolve(values.cwd ?? process.cwd())
    const found = await checkoutForDirectory(repositories, requested, true)
    if (found) checkout = found
    else if (launchOptions) checkout = { workingDirectory: requested }
    else if (values.cwd !== undefined)
      throw new Error(
        `${requested} is not a Dovo project root or one of its Git worktrees. Update the runtime to open other directories, or use --project.`,
      )
    else checkout = (await checkoutForDirectory(repositories, requested, false)) ?? {}
  }
  const supported = Boolean(snapshot.terminalRecoverySupported)
  if (values.remember === true && !supported)
    throw new Error('This runtime cannot remember terminals. Update it, or use --no-remember.')
  if (values.remember === undefined && !supported)
    io.stderr.write(
      'Note: this runtime cannot remember terminals. The shell stops when the runtime restarts.\n',
    )
  let created: unknown
  try {
    created = await client.request(
      '/api/terminals/workspace',
      {
        ...checkout,
        ...(parentTerminalId ? { parentTerminalId } : {}),
        ...(launchOptions && name !== undefined ? { name } : {}),
        rememberSession: values.remember ?? supported,
        ...(values.command !== undefined ? { command: values.command } : {}),
        ...(snapshot.workspaceTerminalRequestIdSupported ? { requestId: randomUUID() } : {}),
      },
      60_000,
    )
  } catch (error) {
    if (
      error instanceof RuntimeRequestError &&
      error.status === 404 &&
      error.message === 'Endpoint not found'
    )
      throw new Error('Update this runtime to open terminals from the CLI.', { cause: error })
    throw error
  }
  let terminal = decode(terminalRowSchema, created)
  if (name !== undefined && !launchOptions) {
    try {
      terminal = decode(
        terminalRowSchema,
        await client.request('/api/terminals/update', { id: terminal.id, title: name }),
      )
    } catch (error) {
      throw new Error(
        `Terminal ${terminal.id} is open, but naming it failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
  print(values.json ? JSON.stringify(terminal) : terminal.id)
  return 0
}
