// Dovo terminal holder. It owns the PTYs of remembered standalone terminals so that their
// processes survive a runtime restart or crash. Usage: node holder.js <private directory>.
// A development checkout runs this file directly with Node's type stripping, so it loads its
// sibling modules by extension and uses the PTY and screen parser packages.
import { connect, createServer, type Server, type Socket } from 'node:net'
import { createRequire } from 'node:module'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import Database from 'better-sqlite3'
import { lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as Pty from 'node-pty'

const extension = extname(fileURLToPath(import.meta.url))
const sibling = (name: string) => new URL(`./${name}${extension}`, import.meta.url).href
const protocol: typeof import('./holder-protocol.js') = await import(sibling('holder-protocol'))
const { readTerminalHookActivity, hookActivityHistory }: typeof import('./hook-activity.js') =
  await import(sibling('hook-activity'))
const { TerminalMetadata, updateChildActivities }: typeof import('./metadata.js') = await import(
  sibling('metadata')
)
const {
  advanceTerminalTurn,
  closeWorkingTurns,
  restoreHookTurnIds,
  initialTerminalTurnProgress,
}: typeof import('./turn-state.js') = await import(sibling('turn-state'))
type ScreenModules = [typeof import('./screen.js'), typeof import('./holder-screen-replay.js')]
// The parsed screen improves a restore. Without it, held programs must still start and survive.
const screenModules: ScreenModules | undefined = await Promise.all([
  import(sibling('screen')) as Promise<ScreenModules[0]>,
  import(sibling('holder-screen-replay')) as Promise<ScreenModules[1]>,
]).catch((error: unknown) => {
  console.error(new Date().toISOString(), 'Terminal screen parser is unavailable', error)
  return undefined
})
const { stopUnixTerminal }: typeof import('./stop-terminal.js') = await import(
  sibling('stop-terminal')
)
const pty = createRequire(import.meta.url)('node-pty') as typeof Pty
type Message = import('./holder-protocol.js').HolderMessage
type Request = import('./holder-protocol.js').HolderRequest
type RootActivity = import('./holder-protocol.js').HolderRootActivity
type HeldRootActivity = RootActivity & {
  merged: import('./holder-protocol.js').HolderMergedActivity
}

type Output = InstanceType<typeof protocol.HolderOutput>
type Replay = {
  replay: string
  screen?: import('./holder-protocol.js').HolderReplayScreen
  rawPrefix?: string
}
type ScreenReplay = {
  write(data: string): void
  resize(cols: number, rows: number): void
  prepare(): Promise<void>
  full(): Replay
  dispose(): void
}
/** Raw output only. A client restores the newest retained output and reports no parsed screen. */
function rawReplay(output: Output): ScreenReplay {
  return {
    write: (data) => output.append(data),
    resize: () => {},
    prepare: async () => {},
    full: () => ({ screen: { kind: 'unavailable' }, replay: output.since() }),
    dispose: () => {},
  }
}

const directory = process.argv[2]
if (!directory || !isAbsolute(directory)) {
  console.error('Usage: holder <absolute private directory>')
  process.exit(2)
}
process.umask(0o077)
// The holder has no terminal. A closed session or launcher must not end the shells it owns.
process.on('SIGHUP', () => {})
// One failed request or parser must not end every program the holder owns.
process.on('uncaughtException', (error) => log('Unexpected terminal holder error', error))
process.on('unhandledRejection', (error) => log('Unexpected terminal holder rejection', error))
protocol.ensurePrivateDirectory(directory)
const socketPath = protocol.holderSocketPath(directory)
if (dirname(socketPath) !== directory) protocol.ensurePrivateDirectory(dirname(socketPath))

function log(...parts: unknown[]) {
  console.error(new Date().toISOString(), ...parts)
}
function writePrivate(name: string, content: string) {
  const file = join(directory!, name)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, content, { mode: 0o600 })
  renameSync(temporary, file)
}
/** `live`: a holder accepts connections. `absent`: no file. `stale`: a file with no listener. */
function probe(path: string) {
  return new Promise<'live' | 'absent' | 'stale'>((resolve, reject) => {
    const socket = connect(path)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('The terminal holder socket did not answer'))
    }, 2000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve('live')
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      // A busy or inaccessible listener (EAGAIN, EACCES, ...) may be live. Never remove it.
      if (error.code === 'ENOENT') resolve('absent')
      else if (error.code === 'ECONNREFUSED') resolve('stale')
      else reject(error)
    })
  })
}

type Held = {
  id: string
  terminal: Pty.IPty
  output: InstanceType<typeof protocol.HolderOutput>
  process: string
  activityMarkerTail: string
  rootActivity: HeldRootActivity
  turnProgress: import('./turn-state.js').TerminalTurnProgress
  hookDirectory?: string
  hookEvent?: string
  hookSequence?: number
  childActivities?: import('./holder-protocol.js').HolderTerminalState['childActivities']
  exited: boolean
  exitCode?: number
  exitedAt?: number
  /** Only the current client's terminals send output. Others wait for an attach with replay. */
  attached: boolean
  screen: ScreenReplay
  screenPaused: boolean
  restoring?: Socket
  clientPaused: boolean
  closing?: Promise<void>
}
const terminals = new Map<string, Held>()
const key = randomBytes(32)
let client: Socket | undefined
let blocked = false
let idleSince = Date.now()
let lastClientAt = Date.now()

function send(message: Message, socket = client) {
  if (!socket || socket.destroyed) return
  if (!socket.write(JSON.stringify(message) + '\n') && socket === client && !blocked) {
    // A slow runtime pauses the programs rather than growing the socket buffer.
    blocked = true
    for (const held of terminals.values()) if (!held.exited) held.terminal.pause()
    socket.once('drain', () => {
      if (client === socket) unblock()
    })
  }
}
function applyPressure(held: Held) {
  if (held.exited) return
  if (blocked || held.clientPaused || held.screenPaused) held.terminal.pause()
  else held.terminal.resume()
}
function unblock() {
  blocked = false
  for (const held of terminals.values()) applyPressure(held)
}
function state(held: Held) {
  return {
    id: held.id,
    pid: held.terminal.pid,
    end: held.output.end,
    process: held.process,
    rootActivity: held.rootActivity,
    childActivities: held.childActivities ?? [],
    exited: held.exited,
    ...(held.exitCode === undefined ? {} : { exitCode: held.exitCode }),
  }
}
function foreground(terminal: Pty.IPty) {
  try {
    return terminal.process
  } catch {
    return ''
  }
}

function sampleForeground(held: Held) {
  const name = foreground(held.terminal)
  if (!name || name === held.process) return
  const replaced = Boolean(held.process)
  if (held.process) held.childActivities = undefined
  held.process = name
  if (held.attached) send({ t: 'process', id: held.id, name })
  if (replaced) {
    const before = held.rootActivity
    if (before.activity) observeActivity(held, 'osc', null)
    finishWorkingTurns(held)
    if (before !== held.rootActivity && held.attached)
      send({ t: 'activity', id: held.id, root: held.rootActivity })
  }
}

// Ambiguous pairing is limited to reports first observed in a single PTY read.
// Explicit IDs may pair only with the same ID or with an anonymous completion.
type HookBatch = { anonymous: number; identified: Set<string> }
function observeActivity(
  held: Held,
  source: 'osc' | 'hook',
  activity: RootActivity['activity'],
  turn?: number,
  turnId = activity?.turnId,
  batch?: HookBatch,
  current = true,
) {
  const next = advanceTerminalTurn(
    held.turnProgress,
    source,
    activity?.state === 'working',
    turn,
    current,
    turnId,
  )
  held.turnProgress = next.progress
  const { merged } = held.rootActivity
  let count = next.count
  if (batch && source === 'hook') {
    if (next.id && next.countedId) {
      batch.identified.add(next.id)
      batch.anonymous += count - 1
    } else batch.anonymous += count
  } else if (batch && source === 'osc') {
    if (next.id && batch.identified.delete(next.id)) {
      // Already counted by ID in the reducer. Consume the matching hook so a
      // later anonymous OSC completion cannot claim it a second time.
    } else if (count && batch.anonymous) {
      const overlap = Math.min(count, batch.anonymous)
      count -= overlap
      batch.anonymous -= overlap
    } else if (count && !next.id) {
      for (const id of batch.identified) {
        batch.identified.delete(id)
        if (--count === 0) break
      }
    }
  }
  held.rootActivity = {
    ...(source === 'osc'
      ? { turn: next.progress.osc.turn, activity, at: Date.now() }
      : held.rootActivity),
    merged: {
      ...merged,
      turn: Math.min(Number.MAX_SAFE_INTEGER, merged.turn + count),
      activity: next.apply ? activity : merged.activity,
    },
  }
}

function finishWorkingTurns(held: Held, finalActivity: RootActivity['activity'] = null) {
  const { merged } = held.rootActivity
  const ended = closeWorkingTurns(held.turnProgress)
  if (merged.activity === finalActivity && !ended.count && !held.turnProgress.working) return
  held.turnProgress = ended.progress
  held.rootActivity = {
    ...held.rootActivity,
    merged: {
      ...merged,
      turn: Math.min(Number.MAX_SAFE_INTEGER, merged.turn + ended.count),
      activity: finalActivity,
    },
  }
}

function sampleHookActivity(held: Held, publish = true, batch?: HookBatch) {
  if (!held.hookDirectory) return undefined
  const before = held.rootActivity
  let event: ReturnType<typeof readTerminalHookActivity>
  let hookError: string | undefined
  try {
    event = readTerminalHookActivity(held.hookDirectory)
    if (event && event.id !== held.hookEvent) {
      for (const transition of hookActivityHistory(
        event,
        held.hookSequence ?? 0,
        held.turnProgress.hook.turn,
      )) {
        observeActivity(
          held,
          'hook',
          transition.state ? { state: transition.state } : null,
          transition.turn,
          transition.turnId,
          batch,
          !transition.skipped,
        )
      }
      observeActivity(
        held,
        'hook',
        event.activity,
        event.turn,
        event.turnId ?? event.activity?.turnId,
        batch,
      )
      held.turnProgress = restoreHookTurnIds(
        held.turnProgress,
        event.openTurns,
        event.completedTurns,
      )
      held.hookEvent = event.id
      held.hookSequence = event.sequence
    }
  } catch (error) {
    hookError = error instanceof Error ? error.message : String(error)
  }
  if (hookError !== held.rootActivity.merged.hookError) {
    held.rootActivity = {
      ...held.rootActivity,
      merged: { ...held.rootActivity.merged, hookError },
    }
  }
  if (publish && before !== held.rootActivity && held.attached)
    send({ t: 'activity', id: held.id, root: held.rootActivity })
  return event
}

const activityMarker = '\x1b]7501;'
function sampleBeforeActivity(held: Held, data: string) {
  const overlap = activityMarker.length - 1
  const boundary = held.activityMarkerTail + data.slice(0, overlap)
  // Attribute a report using the live foreground job. A quiet program can report
  // and block before the periodic process poll observes that it replaced the shell.
  if (boundary.includes(activityMarker) || data.includes(activityMarker)) sampleForeground(held)
  held.activityMarkerTail = (data.length >= overlap ? data : boundary).slice(-overlap)
}

function create(id: string, spawn: import('./holder-protocol.js').HolderSpawn) {
  const terminal = pty.spawn(spawn.file, spawn.args, {
    name: 'xterm-256color',
    cols: spawn.cols,
    rows: spawn.rows,
    cwd: spawn.cwd,
    env: spawn.env,
  })
  const output = new protocol.HolderOutput()
  let replay: ScreenReplay = rawReplay(output)
  if (screenModules) {
    try {
      const [{ TerminalScreenState }, { HolderScreenReplay }] = screenModules
      const screen = new TerminalScreenState(spawn.cols, spawn.rows, (paused) => {
        held.screenPaused = paused
        applyPressure(held)
      })
      replay = new HolderScreenReplay(output, screen, spawn.cols, spawn.rows)
    } catch (error) {
      log('Could not start the screen parser for a terminal', error)
    }
  }
  const held: Held = {
    id,
    terminal,
    output,
    screen: replay,
    screenPaused: false,
    process: '',
    activityMarkerTail: '',
    rootActivity: { turn: 0, activity: null, at: 0, merged: { turn: 0, activity: null } },
    turnProgress: initialTerminalTurnProgress(),
    hookDirectory: spawn.env.DOVO_TERMINAL_STATUS_DIRECTORY,
    exited: false,
    attached: true,
    clientPaused: false,
  }
  terminals.set(id, held)
  const activityChanges: RootActivity[] = []
  let sampledHooks = false
  const batch: HookBatch = { anonymous: 0, identified: new Set() }
  let oscStartedInChunk = false
  const metadata = new TerminalMetadata((event) => {
    if (event.type === 'children')
      held.childActivities = updateChildActivities(held.childActivities, event)
    if (event.type !== 'activity') return
    if (!sampledHooks) {
      sampledHooks = true
      sampleHookActivity(held, false, batch)
    }
    const working = event.activity?.state === 'working'
    if (working && !held.turnProgress.osc.working) oscStartedInChunk = true
    observeActivity(
      held,
      'osc',
      event.activity ?? null,
      undefined,
      event.turnId ?? event.activity?.turnId,
      oscStartedInChunk && !working ? batch : undefined,
    )
    if (!working) oscStartedInChunk = false
    if (held.attached) activityChanges.push(held.rootActivity)
  })
  if (blocked) terminal.pause()
  terminal.onData((data) => {
    sampleBeforeActivity(held, data)
    sampledHooks = false
    batch.anonymous = 0
    batch.identified.clear()
    oscStartedInChunk = false
    metadata.write(data)
    try {
      held.screen.write(data)
    } catch (error) {
      // The raw output was kept before parsing. Continue without the parsed screen.
      log('Terminal screen parser failed', error)
      const failed = held.screen
      held.screen = rawReplay(output)
      held.screenPaused = false
      applyPressure(held)
      try {
        failed.dispose()
      } catch {}
    }
    if (held.attached)
      for (const piece of protocol.splitText(data)) send({ t: 'data', id, data: piece })
    for (const root of activityChanges.splice(0)) send({ t: 'activity', id, root })
  })
  terminal.onExit(({ exitCode }) => {
    sampleHookActivity(held, false)
    sampledHooks = true
    batch.anonymous = 0
    batch.identified.clear()
    const finalActivity = held.rootActivity.merged.activity
    metadata.endProcess()
    finishWorkingTurns(
      held,
      finalActivity?.state === 'done' || finalActivity?.state === 'error' ? finalActivity : null,
    )
    activityChanges.length = 0
    // Exit takes precedence over activity waits. The attach reply still carries the final turn.
    held.exited = true
    held.exitCode = exitCode
    held.exitedAt = Date.now()
    if (held.attached) send({ t: 'exit', id, exitCode, rootActivity: held.rootActivity })
  })
  held.process = foreground(terminal)
  return held
}

async function close(held: Held) {
  held.closing ??= stopUnixTerminal(held.terminal, () => held.exited).then(
    () => {
      held.screen.dispose()
      if (terminals.get(held.id) === held) terminals.delete(held.id)
    },
    (error: unknown) => {
      held.closing = undefined
      throw error
    },
  )
  return held.closing
}

function validSize(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000
}
function validSpawn(spawn: unknown): spawn is import('./holder-protocol.js').HolderSpawn {
  if (!spawn || typeof spawn !== 'object') return false
  const value = spawn as Record<string, unknown>
  return (
    typeof value.file === 'string' &&
    Array.isArray(value.args) &&
    value.args.every((arg) => typeof arg === 'string') &&
    typeof value.cwd === 'string' &&
    isAbsolute(value.cwd) &&
    !!value.env &&
    typeof value.env === 'object' &&
    Object.values(value.env).every((item) => typeof item === 'string') &&
    validSize(value.cols) &&
    validSize(value.rows)
  )
}

async function attach(socket: Socket, held: Held, r: number, from?: number, screen?: boolean) {
  if (held.restoring === socket)
    return send(
      { t: 'reply', r, ok: false, message: 'Terminal restore already in progress' },
      socket,
    )
  const incremental =
    from !== undefined &&
    Number.isSafeInteger(from) &&
    from >= held.output.start &&
    from <= held.output.end
  const full = screen && !incremental
  if (full) {
    held.attached = false
    held.restoring = socket
    await held.screen.prepare()
    if (held.restoring === socket) held.restoring = undefined
    if (client !== socket || socket.destroyed) return
    if (held.closing || terminals.get(held.id) !== held)
      return send({ t: 'reply', r, ok: false, missing: true, message: 'Not held' }, socket)
  }
  if (!held.exited) sampleHookActivity(held, false)
  const replay = full ? held.screen.full() : { replay: held.output.since(from) }
  const reply: Message = { t: 'reply', r, ok: true, terminal: state(held), ...replay }
  // Escaped control characters take up to six JSON characters. Extremely large, dense
  // checkpoints must fit alongside the retained raw history in a single reply.
  if (
    reply.screen?.kind === 'checkpoint' &&
    reply.screen.ansi.length + (reply.rawPrefix?.length ?? 0) + (reply.replay?.length ?? 0) >
      (protocol.HOLDER_LINE_LIMIT - 4096) / protocol.JSON_ESCAPE_FACTOR &&
    JSON.stringify(reply).length > protocol.HOLDER_LINE_LIMIT
  ) {
    reply.screen = { kind: 'unavailable' }
    reply.replay = held.output.since()
    delete reply.rawPrefix
  }
  held.attached = true
  send(reply, socket)
  if (held.exited)
    send(
      { t: 'exit', id: held.id, exitCode: held.exitCode ?? 0, rootActivity: held.rootActivity },
      socket,
    )
}

function handle(socket: Socket, request: Request) {
  if (request.t === 'hello') return
  const held = terminals.get(request.id)
  switch (request.t) {
    case 'create': {
      if (
        !protocol.holderTerminalId(request.id) ||
        !validSpawn(request.spawn) ||
        (request.initialInput !== undefined && typeof request.initialInput !== 'string')
      )
        return send({ t: 'reply', r: request.r, ok: false, message: 'Invalid terminal request' })
      // A retried create resolves to the same process. It never starts a second one.
      if (held && !held.closing) {
        void attach(socket, held, request.r, undefined, request.screen)
        return
      }
      if (held) return send({ t: 'reply', r: request.r, ok: false, message: 'Terminal is closing' })
      try {
        const created = create(request.id, request.spawn)
        try {
          if (request.initialInput !== undefined) created.terminal.write(request.initialInput)
        } catch (error) {
          // A failed write must not leave a terminal that a retry can mistake for an admission.
          void close(created).catch((cause: unknown) =>
            log('Terminal startup cleanup failed', cause),
          )
          throw error
        }
        return send({ t: 'reply', r: request.r, ok: true, terminal: state(created), replay: '' })
      } catch (error) {
        return send({
          t: 'reply',
          r: request.r,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    case 'attach': {
      if (!held)
        return send({ t: 'reply', r: request.r, ok: false, missing: true, message: 'Not held' })
      if (held.closing)
        return send({ t: 'reply', r: request.r, ok: false, message: 'Terminal is closing' })
      void attach(socket, held, request.r, request.from, request.screen)
      return
    }
    case 'close': {
      if (!held) return send({ t: 'reply', r: request.r, ok: true })
      void close(held).then(
        () => send({ t: 'reply', r: request.r, ok: true }, socket),
        (error: unknown) =>
          send(
            {
              t: 'reply',
              r: request.r,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            },
            socket,
          ),
      )
      return
    }
    case 'input':
      if (held && !held.exited && !held.closing && typeof request.data === 'string')
        held.terminal.write(request.data)
      return
    case 'send': {
      if (!held?.attached || held.exited || held.closing)
        return send({
          t: 'reply',
          r: request.r,
          ok: false,
          message: 'The terminal is unavailable. Input was not sent.',
        })
      if (typeof request.data !== 'string' || request.data.length > protocol.HOLDER_DATA_CHUNK)
        return send({
          t: 'reply',
          r: request.r,
          ok: false,
          message: 'Invalid input. Input was not sent.',
        })
      sampleForeground(held)
      const hookActivity = sampleHookActivity(held)
      if (held.rootActivity.merged.hookError)
        return send({
          t: 'reply',
          r: request.r,
          ok: false,
          message: 'Could not read terminal activity. Input was not sent.',
        })
      try {
        held.terminal.write(request.data)
      } catch (error) {
        log('Could not confirm terminal input', error)
        return send({
          t: 'reply',
          r: request.r,
          ok: false,
          message: 'Delivery could not be confirmed. Input may have been sent.',
        })
      }
      // All previous PTY frames have been sent before this reply. Output
      // caused by this input can only be read on a later event-loop callback.
      return send({ t: 'reply', r: request.r, ok: true, hookActivity })
    }
    case 'resize':
      if (held && !held.exited && validSize(request.cols) && validSize(request.rows)) {
        held.terminal.resize(request.cols, request.rows)
        held.screen.resize(request.cols, request.rows)
      }
      return
    case 'pause':
    case 'resume':
      if (!held || held.exited) return
      held.clientPaused = request.t === 'pause'
      applyPressure(held)
  }
}

function accept(socket: Socket) {
  socket.setEncoding('utf8')
  let authenticated = false
  const timer = setTimeout(() => socket.destroy(), 5000)
  const read = protocol.lineReader(
    (line) => {
      let request: Request
      try {
        request = JSON.parse(line) as Request
      } catch {
        socket.destroy()
        return
      }
      if (!authenticated) {
        const offered = request.t === 'hello' && typeof request.key === 'string' ? request.key : ''
        const given = Buffer.from(offered, 'hex')
        if (given.length !== key.length || !timingSafeEqual(given, key)) {
          send({ t: 'denied', message: 'Terminal holder key does not match' }, socket)
          socket.end()
          return
        }
        clearTimeout(timer)
        authenticated = true
        // A new runtime takes over. The previous connection belongs to a stopped or replaced one.
        if (client && client !== socket) client.destroy()
        client = socket
        lastClientAt = Date.now()
        blocked = false
        for (const held of terminals.values()) {
          held.attached = false
          held.clientPaused = false
          applyPressure(held)
        }
        // Also send the version when it differs, so that the runtime can report the mismatch.
        send(
          {
            t: 'hello',
            v: protocol.HOLDER_PROTOCOL,
            pid: process.pid,
            terminals: [...terminals.values()].filter((held) => !held.closing).map(state),
          },
          socket,
        )
        return
      }
      if (socket !== client) return
      try {
        handle(socket, request)
      } catch (error) {
        log('Request failed', error)
      }
    },
    () => socket.destroy(),
  )
  socket.on('data', (chunk: string) => read(chunk))
  socket.on('error', () => {})
  socket.on('close', () => {
    clearTimeout(timer)
    if (client !== socket) return
    client = undefined
    lastClientAt = Date.now()
    // Without a reader, keep programs running and keep the newest output for replay.
    blocked = false
    for (const held of terminals.values()) {
      held.attached = false
      held.clientPaused = false
      applyPressure(held)
    }
  })
}

let server: Server | undefined
let socketIdentity = ''
let stopping = false
function identity(path: string) {
  try {
    const stat = lstatSync(path)
    return stat.isSocket() ? `${stat.dev}:${stat.ino}` : ''
  } catch {
    return ''
  }
}
async function shutdown(reason: string, stopTerminals: boolean) {
  if (stopping) return
  stopping = true
  log('Stopping terminal holder:', reason)
  server?.close()
  client?.destroy()
  if (stopTerminals) await Promise.allSettled([...terminals.values()].map((held) => close(held)))
  if (identity(socketPath) === socketIdentity) {
    rmSync(socketPath, { force: true })
    if (directoryIdentity() === ownDirectory)
      rmSync(join(directory!, protocol.HOLDER_STATE_FILE), { force: true })
  }
  process.exit(0)
}

function directoryIdentity() {
  try {
    const stat = lstatSync(directory!)
    return stat.isDirectory() ? `${stat.dev}:${stat.ino}` : ''
  } catch {
    return ''
  }
}
const ownDirectory = directoryIdentity()
// Serialize the socket probe, stale-socket removal, bind and publication across processes.
// The OS releases SQLite's lock if a starter dies. Keep the lock file at its stable path.
let startup: Database.Database
try {
  startup = new Database(join(directory, 'holder-startup.sqlite'), { timeout: 15_000 })
  startup.exec('BEGIN IMMEDIATE')
} catch (error) {
  log('Could not start the terminal holder', error)
  process.exit(1)
}
try {
  const found = await probe(socketPath)
  // A second launch, such as a retried supervisor job, leaves the running holder in charge.
  if (found === 'live') {
    startup.close()
    process.exit(0)
  }
  if (found === 'stale') {
    if (!lstatSync(socketPath).isSocket())
      throw new Error(`Terminal holder path is not a socket: ${socketPath}`)
    rmSync(socketPath)
  }
  const listener = createServer(accept)
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(socketPath, () => {
      listener.off('error', reject)
      resolve()
    })
  })
  server = listener
  server.on('error', (error) => {
    log('Terminal holder socket failed', error)
    void shutdown('socket error', true)
  })
  socketIdentity = identity(socketPath)
  // Publish the key and state only after this process owns the listening socket.
  writePrivate(protocol.HOLDER_KEY_FILE, key.toString('hex'))
  writePrivate(
    protocol.HOLDER_STATE_FILE,
    JSON.stringify({ pid: process.pid, v: protocol.HOLDER_PROTOCOL }),
  )
  log('Terminal holder ready', process.pid)
} catch (error) {
  // Nothing was published. A socket this process bound is removed with it.
  log('Could not start the terminal holder', error)
  if (socketIdentity && identity(socketPath) === socketIdentity) rmSync(socketPath, { force: true })
  startup.close()
  process.exit(1)
}
startup.close()

setInterval(() => {
  if (stopping || !socketIdentity) return
  // A deleted or replaced socket means no runtime can reach these programs again. A long data
  // path keeps the socket in a temporary folder, so a removed data folder counts too.
  if (identity(socketPath) !== socketIdentity) {
    void shutdown('its socket was removed', true)
    return
  }
  if (directoryIdentity() !== ownDirectory) {
    void shutdown('its data folder was removed', true)
    return
  }
  const now = Date.now()
  for (const held of terminals.values()) {
    if (held.exited) {
      // An exit status waits for a runtime. Without one for a day, it is no longer useful.
      if (!client && now - Math.max(held.exitedAt ?? now, lastClientAt) > 86_400_000) {
        held.screen.dispose()
        terminals.delete(held.id)
      }
      continue
    }
    sampleForeground(held)
    sampleHookActivity(held)
  }
  // The runtime disconnects once it holds nothing. A connected runtime keeps the holder ready.
  if (terminals.size || client) idleSince = now
  else if (now - idleSince > 10_000) void shutdown('no terminals remain', false)
}, 500)
