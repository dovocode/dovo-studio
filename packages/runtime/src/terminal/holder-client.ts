import { execFile, spawn } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { closeSync, openSync, readFileSync, statSync, truncateSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import type { IDisposable, IPty } from 'node-pty'
import type { TerminalHookActivity } from './hook-activity.js'
import {
  HOLDER_KEY_FILE,
  HOLDER_PROTOCOL,
  HOLDER_STATE_FILE,
  splitText,
  ensurePrivateDirectory,
  holderSocketPath,
  lineReader,
  type HolderMessage,
  type HolderRequest,
  type HolderReplayScreen,
  type HolderRootActivity,
  type HolderSpawn,
  type HolderTerminalState,
} from './holder-protocol.js'
import {
  launchTerminalHolder,
  stopTerminalHolder,
  terminalHolderSupervisor,
} from './holder-supervisor.js'

const execute = promisify(execFile)

/**
 * `missing`: no holder runs, or it does not know the terminal, so its programs have ended.
 * `unreachable`: a holder runs but does not answer now. `incompatible`: it uses another protocol.
 * `failed`: the holder could not start or rejected the request.
 */
export type HolderFailureKind = 'missing' | 'unreachable' | 'incompatible' | 'failed'
export class HolderError extends Error {
  constructor(
    readonly kind: HolderFailureKind,
    message: string,
  ) {
    super(message)
  }
}
class HolderKeyUnavailable extends HolderError {}
/** Input that was not sent. The caller reports it; nothing is retried later. */
export class HolderInputError extends Error {}
/** Input kept before the holder confirms a launch. More is refused, not buffered without limit. */
export const HELD_INPUT_QUEUE_LIMIT = 256 * 1024
const holderError = (error: unknown, kind: HolderFailureKind = 'failed') =>
  error instanceof HolderError
    ? error
    : new HolderError(kind, error instanceof Error ? error.message : String(error))

/** The node-pty surface that Terminals uses. A held terminal implements it over the holder socket. */
export type TerminalProcess = Pick<
  IPty,
  'pid' | 'process' | 'write' | 'resize' | 'pause' | 'resume' | 'kill' | 'onData' | 'onExit'
>

type Listener<T> = (value: T) => void
type RestoredOutput = {
  screen: HolderReplayScreen
  rawPrefix: string
  replay: string
  rawGap: boolean
  resize?: { cols: number; rows: number }
}
function event<T>(listeners: Set<Listener<T>>) {
  return (listener: Listener<T>): IDisposable => {
    listeners.add(listener)
    return { dispose: () => listeners.delete(listener) }
  }
}
function emit<T>(listeners: Set<Listener<T>>, value: T) {
  for (const listener of [...listeners])
    try {
      listener(value)
    } catch (error) {
      console.error('Held terminal listener failed', error)
    }
}

export class HeldTerminal implements TerminalProcess {
  pid = 0
  process = ''
  /** The holder acknowledged this terminal on the current connection. */
  ready = false
  /** It was acknowledged at least once. A later failure cannot fall back to a new local shell. */
  established = false
  /** The create may have reached the holder without a reply. Only attach from here. */
  creationUncertain = false
  exited = false
  replayingChildSnapshot = false
  earlyExit?: Extract<HolderMessage, { t: 'exit' }>
  rootActivity?: HolderRootActivity
  private earlyOutput: (string | HolderRootActivity)[] = []
  private closing = false
  private closingTask?: Promise<void>
  private settleAdmission: (error?: HolderError) => void = () => {}
  private admission = new Promise<void>((resolve, reject) => {
    this.settleAdmission = (error) => (error ? reject(error) : resolve())
  })
  /** Output offset already delivered. A reconnect asks only for later output. */
  received = 0
  private queue: string[] = []
  private queued = 0
  private size?: { cols: number; rows: number }
  private paused = false
  private dataListeners = new Set<Listener<string>>()
  private exitListeners = new Set<Listener<{ exitCode: number; signal?: number }>>()
  private readyListeners = new Set<Listener<RestoredOutput | undefined>>()
  private rootActivityListeners = new Set<Listener<HolderRootActivity>>()
  private childrenListeners = new Set<
    Listener<NonNullable<HolderTerminalState['childActivities']>>
  >()
  readonly onChildSnapshot = event(this.childrenListeners)
  private failureListeners = new Set<Listener<HolderError>>()
  readonly onData = event(this.dataListeners)
  readonly onExit = event(this.exitListeners)
  readonly onReady = event(this.readyListeners)
  readonly onRootActivity = event(this.rootActivityListeners)
  readonly onFailure = event(this.failureListeners)
  constructor(
    private holder: TerminalHolder,
    readonly id: string,
    readonly spawn?: HolderSpawn,
    readonly initialInput?: string,
  ) {
    // Existing synchronous callers may never wait for admission.
    void this.admission.catch(() => {})
  }
  waitForAdmission() {
    return this.admission
  }
  inputAtTurn(data: string, capture: (hook: TerminalHookActivity | null) => number) {
    return this.holder.inputAtTurn(this, data, capture)
  }
  /** Throws `HolderInputError` when input cannot reach this program now. It is never replayed. */
  write(data: string) {
    if (this.exited || this.closing) return
    if (this.ready) {
      for (const piece of splitText(data))
        this.holder.send({ t: 'input', id: this.id, data: piece })
      return
    }
    if (this.established)
      throw new HolderInputError('The terminal holder is reconnecting. Input was not sent.')
    if (this.creationUncertain)
      throw new HolderInputError('Terminal startup is not confirmed yet. Input was not sent.')
    // Input before the first acknowledgement belongs to this launch and is sent once after it.
    if (this.queued + data.length > HELD_INPUT_QUEUE_LIMIT)
      throw new HolderInputError('The terminal has not started yet. Input was not sent.')
    this.queue.push(data)
    this.queued += data.length
  }
  resize(cols: number, rows: number) {
    this.size = { cols, rows }
    if (this.ready) this.holder.send({ t: 'resize', id: this.id, cols, rows })
  }
  pause() {
    this.paused = true
    if (this.ready) this.holder.send({ t: 'pause', id: this.id })
  }
  resume() {
    this.paused = false
    if (this.ready) this.holder.send({ t: 'resume', id: this.id })
  }
  kill() {
    void this.close().catch((error: unknown) => console.error('Held terminal close failed', error))
  }
  /**
   * Explicit close ends the program in the holder, then reports the exit like a local PTY. If
   * the holder cannot confirm it, the terminal stays open so that the caller can try again.
   */
  close() {
    this.closingTask ??= (async () => {
      this.closing = true
      try {
        await this.holder.close(this.id)
        this.finish(0)
      } catch (error) {
        this.closing = false
        throw error
      } finally {
        this.closingTask = undefined
      }
    })()
    return this.closingTask
  }
  get isClosing() {
    return this.closing
  }
  /** Input that never reached a holder. The caller sends it to its fallback shell. */
  takeQueue() {
    const queue = this.queue
    this.queue = []
    this.queued = 0
    return queue
  }
  /** @internal */
  loseCreateReply() {
    this.creationUncertain = true
    this.takeQueue()
  }
  /** @internal */
  cancelAdmission() {
    this.settleAdmission(new HolderError('failed', 'The terminal closed before it started'))
  }
  /** Retry after `unreachable` or `incompatible`. */
  reattach() {
    if (!this.exited && !this.closing) this.holder.bind(this)
  }
  /** @internal */
  accept(state: HolderTerminalState, replay: string, screen?: HolderReplayScreen, rawPrefix = '') {
    const rawGap = state.end - replay.length - rawPrefix.length > this.received
    if (!screen && (rawGap || (!this.established && !this.spawn))) screen = { kind: 'unavailable' }
    if (
      screen?.kind === 'checkpoint' &&
      (!Number.isSafeInteger(screen.offset) ||
        screen.offset < 0 ||
        screen.offset + replay.length !== state.end ||
        !Number.isSafeInteger(screen.cols) ||
        screen.cols < 2 ||
        screen.cols > 500 ||
        !Number.isSafeInteger(screen.rows) ||
        screen.rows < 1 ||
        screen.rows > 300 ||
        typeof screen.ansi !== 'string' ||
        screen.ansi.length > 1024 * 1024)
    )
      screen = { kind: 'unavailable' }
    const restore = screen && { screen, rawPrefix, replay, rawGap, resize: this.size }
    if (state.exited)
      this.earlyExit ??= {
        t: 'exit',
        id: this.id,
        exitCode: state.exitCode ?? 0,
        rootActivity: state.rootActivity,
      }
    this.pid = state.pid
    this.process = state.process
    this.rootActivity = state.rootActivity
    this.ready = true
    this.established = true
    if (this.size) this.holder.send({ t: 'resize', id: this.id, ...this.size })
    if (this.paused) this.holder.send({ t: 'pause', id: this.id })
    const queued = this.takeQueue()
    if (!this.earlyExit) for (const data of queued) this.write(data)
    this.replayingChildSnapshot = state.childActivities !== undefined
    try {
      emit(this.readyListeners, restore)
      if (!restore) this.deliver(replay)
    } finally {
      this.replayingChildSnapshot = false
    }
    if (state.childActivities) emit(this.childrenListeners, state.childActivities)
    // Output that rolled out of the holder's buffer during an outage is gone. Continue after it.
    this.received = state.end
    for (const output of this.earlyOutput.splice(0)) {
      if (typeof output === 'string') this.deliver(output)
      else this.reportRootActivity(output)
    }
    this.settleAdmission()
  }
  /** @internal */
  deliver(data: string) {
    if (!data.length || this.exited) return
    if (!this.ready) {
      this.earlyOutput.push(data)
      return
    }
    this.received += data.length
    emit(this.dataListeners, data)
  }
  /** @internal */
  reportRootActivity(root: HolderRootActivity) {
    if (!this.ready) {
      this.earlyOutput.push(root)
      return
    }
    this.rootActivity = root
    emit(this.rootActivityListeners, root)
  }
  /** @internal */
  finish(exitCode: number, rootActivity?: HolderRootActivity) {
    if (this.exited) return
    if (rootActivity) this.rootActivity = rootActivity
    this.exited = true
    this.ready = false
    this.earlyOutput.length = 0
    emit(this.exitListeners, { exitCode })
  }
  /** @internal */
  fail(error: HolderError) {
    this.settleAdmission(error)
    if (this.exited) return
    this.ready = false
    this.earlyOutput.length = 0
    this.earlyExit = undefined
    emit(this.failureListeners, error)
  }
}

type Requested =
  | Omit<Extract<HolderRequest, { t: 'create' }>, 'r'>
  | Omit<Extract<HolderRequest, { t: 'attach' }>, 'r'>
  | Omit<Extract<HolderRequest, { t: 'close' }>, 'r'>
  | Omit<Extract<HolderRequest, { t: 'send' }>, 'r'>
type Reply = Extract<HolderMessage, { t: 'reply' }>
type Pending = {
  resolve: (message: Reply) => void
  reject: (error: HolderError) => void
}
class Connection {
  private pending = new Map<number, Pending>()
  private next = 1
  closed = false
  constructor(
    readonly socket: Socket,
    private onMessage: (message: HolderMessage) => void,
    private onClose: () => void,
  ) {
    const read = lineReader(
      (line) => {
        let message: HolderMessage
        try {
          message = JSON.parse(line) as HolderMessage
        } catch {
          socket.destroy()
          return
        }
        if (message.t === 'reply') {
          const pending = this.pending.get(message.r)
          this.pending.delete(message.r)
          pending?.resolve(message)
        } else this.onMessage(message)
      },
      () => socket.destroy(),
    )
    socket.on('data', (chunk: string) => read(chunk))
    socket.on('close', () => {
      this.closed = true
      for (const pending of this.pending.values())
        pending.reject(new HolderError('unreachable', 'The terminal holder connection closed'))
      this.pending.clear()
      this.onClose()
    })
  }
  send(message: HolderRequest) {
    if (!this.closed) this.socket.write(JSON.stringify(message) + '\n')
  }
  request(message: Requested): Promise<Reply>
  request<A>(message: Requested, capture: (reply: Reply) => A): Promise<A>
  request<A>(message: Requested, capture?: (reply: Reply) => A) {
    if (this.closed)
      return Promise.reject(new HolderError('unreachable', 'The terminal holder connection closed'))
    const r = this.next++
    return new Promise<Reply | A>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(r)
        reject(new HolderError('unreachable', 'The terminal holder did not answer'))
      }, 10_000)
      this.pending.set(r, {
        resolve: (reply) => {
          clearTimeout(timer)
          try {
            // Capture in wire order, before the parser reads later output in this chunk.
            resolve(capture ? capture(reply) : reply)
          } catch (error) {
            reject(error)
          }
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.send({ ...message, r })
    })
  }
}

function openSocket(path: string, timeout: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(path)
    socket.setEncoding('utf8')
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new HolderError('unreachable', 'The terminal holder did not accept a connection'))
    }, timeout)
    socket.once('connect', () => {
      clearTimeout(timer)
      // Held programs never keep a stopping runtime alive.
      socket.unref()
      socket.removeAllListeners('error')
      socket.on('error', () => {})
      resolve(socket)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
          ? new HolderError('missing', 'No terminal holder is running')
          : new HolderError('unreachable', error.message),
      )
    })
  })
}

/**
 * Start a holder. `abandon` is present only when this call created a new holder job or process.
 * An existing job may already hold programs, so a caller never stops it.
 */
export type HolderLauncher = (location: { helper: string; directory: string }) => Promise<{
  /** Stop the holder this call started, after it failed to open its socket. */
  abandon?: () => Promise<void>
}>

const defaultHelper = () => {
  const module = fileURLToPath(import.meta.url)
  return join(dirname(module), `holder${extname(module)}`)
}

/** Without a service manager the holder leaves the runtime's process group and session. */
export const launchHolder: HolderLauncher = async ({ helper, directory }) => {
  const supervisor = terminalHolderSupervisor()
  if (supervisor) {
    const created = await launchTerminalHolder({ helper, directory }, supervisor)
    return created ? { abandon: () => stopTerminalHolder(directory, supervisor) } : {}
  }
  const log = join(directory, 'holder.log')
  try {
    if (statSync(log).size > 1024 * 1024) truncateSync(log)
  } catch {}
  const output = openSync(log, 'a', 0o600)
  try {
    // The holder gets no runtime credentials. Each shell receives its environment per request.
    const env: Record<string, string> = {}
    for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'LOGNAME'])
      if (process.env[key]) env[key] = process.env[key]
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    const child = spawn(process.execPath, [helper, directory], {
      cwd: directory,
      detached: true,
      env,
      stdio: ['ignore', output, output],
    })
    child.on('error', (error) => console.error('Terminal holder failed to start', error))
    child.unref()
    return {
      abandon: async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      },
    }
  } finally {
    closeSync(output)
  }
}

/** Client for one private holder directory. One connection serves every held terminal. */
export class TerminalHolder {
  readonly socketPath: string
  private connection?: Promise<Connection>
  private terminals = new Map<string, HeldTerminal>()
  private closes = 0
  private launching?: Promise<void>
  constructor(
    readonly directory: string,
    private options: { helper?: string; launch?: HolderLauncher; startTimeout?: number } = {},
  ) {
    this.socketPath = holderSocketPath(directory)
  }

  /** Create when `spawn` is set; otherwise only reattach to an existing program. */
  open(id: string, spawn?: HolderSpawn, initialInput?: string) {
    const terminal = new HeldTerminal(this, id, spawn, initialInput)
    this.terminals.set(id, terminal)
    this.bind(terminal)
    return terminal
  }

  /** Stop routing events to a terminal without ending its program. */
  release(id: string) {
    this.terminals.get(id)?.cancelAdmission()
    this.terminals.delete(id)
    this.idle()
  }

  async inputAtTurn(
    terminal: HeldTerminal,
    data: string,
    capture: (hook: TerminalHookActivity | null) => number,
  ) {
    const connection = await this.connection
    if (
      !connection ||
      connection.closed ||
      this.terminals.get(terminal.id) !== terminal ||
      !terminal.ready ||
      terminal.isClosing
    )
      throw new HolderInputError('The terminal holder is reconnecting. Input was not sent.')
    const receipt = await connection
      .request({ t: 'send', id: terminal.id, data }, (reply) =>
        reply.ok ? { ok: true as const, turn: capture(reply.hookActivity ?? null) } : reply,
      )
      .catch(() => {
        // The holder may have written before losing the reply. Never replay this input.
        throw new HolderInputError('Delivery could not be confirmed. Input may have been sent.')
      })
    if (!receipt.ok) throw new HolderInputError(receipt.message)
    return receipt.turn
  }

  /**
   * End a program and forget it. A missing holder or terminal already means it ended. The
   * terminal keeps its registration until then, so a failed close leaves it reachable.
   */
  async close(id: string) {
    const terminal = this.terminals.get(id)
    terminal?.cancelAdmission()
    // The program's exit can arrive before the reply. Keep the connection until the reply.
    this.closes++
    try {
      const connection = await this.connect(false)
      const reply = await connection.request({ t: 'close', id })
      if (!reply.ok) throw new HolderError('failed', reply.message)
    } catch (error) {
      if (!(error instanceof HolderError && error.kind === 'missing')) throw holderError(error)
    } finally {
      this.closes--
    }
    if (this.terminals.get(id) === terminal) this.terminals.delete(id)
    this.idle()
  }

  /** Close the connection. Held programs keep running for the next runtime. */
  disconnect() {
    for (const terminal of this.terminals.values()) terminal.cancelAdmission()
    this.terminals.clear()
    const connection = this.connection
    this.connection = undefined
    void connection?.then(
      (open) => open.socket.end(),
      () => {},
    )
  }

  /** @internal */
  send(message: HolderRequest) {
    void this.connection?.then(
      (open) => open.send(message),
      () => {},
    )
  }

  /** @internal */
  bind(terminal: HeldTerminal) {
    void this.establish(terminal).catch((error: unknown) => {
      if (this.terminals.get(terminal.id) !== terminal) return
      terminal.fail(holderError(error))
    })
  }

  private async establish(terminal: HeldTerminal) {
    const launch = Boolean(terminal.spawn && !terminal.established)
    for (let attempt = 0; ; attempt++) {
      try {
        const create = launch && !terminal.creationUncertain
        const connection = await this.connect(create)
        // A close that started first wins. Never send a create for a terminal being closed.
        if (this.terminals.get(terminal.id) !== terminal || terminal.exited || terminal.isClosing)
          return
        const reply = create
          ? await connection
              .request({
                t: 'create',
                id: terminal.id,
                spawn: terminal.spawn!,
                initialInput: terminal.initialInput,
                screen: true,
              })
              .catch((error: unknown) => {
                terminal.loseCreateReply()
                throw error
              })
          : await connection.request({
              t: 'attach',
              id: terminal.id,
              screen: true,
              ...(terminal.received ? { from: terminal.received } : {}),
            })
        if (this.terminals.get(terminal.id) !== terminal || terminal.exited) return
        if (!reply.ok) throw new HolderError(reply.missing ? 'missing' : 'failed', reply.message)
        if (
          reply.terminal?.id !== terminal.id ||
          !Number.isSafeInteger(reply.terminal.pid) ||
          reply.terminal.pid < 1
        ) {
          if (create) terminal.loseCreateReply()
          throw new HolderError('incompatible', 'Invalid terminal admission reply')
        }
        terminal.accept(reply.terminal, reply.replay ?? '', reply.screen, reply.rawPrefix)
        if (terminal.earlyExit) this.dispatch(terminal.earlyExit)
        return
      } catch (error) {
        const failure = holderError(error)
        // After sending create, a lost reply only authorizes an attach to the same terminal.
        if (!launch || attempt > 0 || !['unreachable', 'missing'].includes(failure.kind))
          throw failure
      }
    }
  }

  private idle() {
    if (this.terminals.size || this.closes) return
    // An idle connection would keep the holder alive with nothing to hold.
    this.disconnect()
  }

  private connect(launch: boolean): Promise<Connection> {
    const current = this.connection
    if (current)
      return current.then(
        (open) => (open.closed ? this.reconnect(current, launch) : open),
        (error: unknown) => {
          // A failed attach-only connection must not stop a create from launching a holder.
          if (launch && error instanceof HolderError && error.kind === 'missing')
            return this.reconnect(current, launch)
          throw error
        },
      )
    return this.reconnect(undefined, launch)
  }

  private reconnect(previous: Promise<Connection> | undefined, launch: boolean) {
    if (this.connection !== previous) return this.connect(launch)
    const attempt = this.handshake(launch)
    this.connection = attempt
    attempt.catch(() => {
      if (this.connection === attempt) this.connection = undefined
    })
    return attempt
  }

  private async handshake(launch: boolean) {
    try {
      ensurePrivateDirectory(this.directory)
      if (dirname(this.socketPath) !== this.directory)
        ensurePrivateDirectory(dirname(this.socketPath))
    } catch (error) {
      throw holderError(error)
    }
    let socket: Socket
    try {
      socket = await openSocket(this.socketPath, 3000)
    } catch (error) {
      const failure = holderError(error)
      if (failure.kind !== 'missing') throw failure
      // A starting holder has not opened its socket yet. A stopped one left no live process.
      if (await this.running()) socket = await this.waitForSocket()
      else if (!launch) throw failure
      else socket = await this.start()
    }
    // A holder publishes its key just after it starts listening. Read it again briefly.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.authenticate(socket)
      } catch (error) {
        if (!(error instanceof HolderKeyUnavailable) || attempt >= 4) throw error
      }
      await delay(100)
      socket = await openSocket(this.socketPath, 3000)
    }
  }

  private async start() {
    this.launching ??= (async () => {
      const launcher = this.options.launch ?? launchHolder
      const launched = await launcher({
        helper: this.options.helper ?? defaultHelper(),
        directory: this.directory,
      })
      try {
        ;(await this.waitForSocket()).destroy()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // An existing job may own programs. Report it as unreachable and leave it running.
        if (!launched.abandon)
          throw new HolderError('unreachable', `The terminal holder did not answer: ${message}`)
        // A holder that opened its socket at the last moment is in use now. Keep it.
        const late = await openSocket(this.socketPath, 1000).catch(() => undefined)
        if (late) {
          late.destroy()
          return
        }
        // This call created the holder and no runtime ever reached it, so it holds no programs.
        await launched.abandon().catch((stopError: unknown) => {
          console.error('Could not stop the terminal holder after a failed start', stopError)
        })
        throw new HolderError('failed', `The terminal holder did not start: ${message}`)
      }
    })().finally(() => {
      this.launching = undefined
    })
    await this.launching
    return openSocket(this.socketPath, 3000)
  }

  private async waitForSocket() {
    const deadline = Date.now() + (this.options.startTimeout ?? 10_000)
    while (true) {
      try {
        return await openSocket(this.socketPath, 3000)
      } catch (error) {
        if (Date.now() >= deadline) throw holderError(error, 'unreachable')
      }
      await delay(50)
    }
  }

  /** The recorded holder process still runs for this directory. */
  private async running() {
    let pid: number
    try {
      const state = JSON.parse(readFileSync(join(this.directory, HOLDER_STATE_FILE), 'utf8')) as {
        pid?: unknown
      }
      if (!Number.isInteger(state.pid)) return false
      pid = state.pid as number
      process.kill(pid, 0)
    } catch {
      return false
    }
    try {
      // A reused PID belongs to another program. The holder's arguments name its directory.
      const { stdout } = await execute('/bin/ps', ['-o', 'args=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 2000,
      })
      return stdout.includes(this.directory)
    } catch {
      return false
    }
  }

  private authenticate(socket: Socket) {
    return new Promise<Connection>((resolve, reject) => {
      let settled = false
      const fail = (error: HolderError) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        reject(error)
      }
      const timer = setTimeout(
        () => fail(new HolderError('unreachable', 'The terminal holder did not answer')),
        5000,
      )
      let key: string
      try {
        key = readFileSync(join(this.directory, HOLDER_KEY_FILE), 'utf8').trim()
      } catch (error) {
        const failure = holderError(error, 'unreachable')
        fail(
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? new HolderKeyUnavailable('unreachable', failure.message)
            : failure,
        )
        return
      }
      const connection = new Connection(
        socket,
        (message) => {
          if (!settled) {
            if (message.t === 'denied')
              return fail(new HolderKeyUnavailable('unreachable', message.message))
            if (message.t !== 'hello')
              return fail(new HolderError('incompatible', 'Unexpected terminal holder reply'))
            if (message.v !== HOLDER_PROTOCOL)
              return fail(
                new HolderError(
                  'incompatible',
                  `The running terminal holder uses protocol ${message.v}. This runtime uses ${HOLDER_PROTOCOL}.`,
                ),
              )
            settled = true
            clearTimeout(timer)
            resolve(connection)
            // Close programs that no runtime terminal claims, such as an unacknowledged create.
            for (const state of message.terminals)
              if (!this.terminals.has(state.id)) connection.send({ t: 'close', r: 0, id: state.id })
            return
          }
          this.dispatch(message)
        },
        () => {
          fail(new HolderError('unreachable', 'The terminal holder closed the connection'))
          void this.lost()
        },
      )
      connection.send({ t: 'hello', v: HOLDER_PROTOCOL, key })
    })
  }

  private dispatch(message: HolderMessage) {
    if (message.t === 'hello' || message.t === 'denied' || message.t === 'reply') return
    const terminal = this.terminals.get(message.id)
    if (!terminal) return
    if (message.t === 'data') terminal.deliver(message.data)
    else if (message.t === 'activity') terminal.reportRootActivity(message.root)
    else if (message.t === 'process') terminal.process = message.name
    else if (message.t === 'exit') {
      if (!terminal.ready) {
        // An exit can arrive in the same socket read as the admission reply.
        terminal.earlyExit = message
        return
      }
      terminal.finish(message.exitCode, message.rootActivity)
      // The runtime has recorded the exit. The holder can forget it.
      this.terminals.delete(message.id)
      this.send({ t: 'close', r: 0, id: message.id })
      this.idle()
    }
  }

  private async lost() {
    const affected = [...this.terminals.values()].filter((terminal) => terminal.ready)
    // Input during the outage is dropped. It must not run later in a process the user cannot see.
    for (const terminal of affected) terminal.ready = false
    if (!affected.length) return
    const kind = (await this.running()) ? 'unreachable' : 'missing'
    for (const terminal of affected)
      if (this.terminals.get(terminal.id) === terminal && !terminal.ready)
        terminal.fail(
          new HolderError(
            kind,
            kind === 'missing'
              ? 'The terminal holder stopped'
              : 'Lost the connection to the terminal holder',
          ),
        )
  }
}
