import type { AcpLaunch } from '../agents/execution/types.js'
import { decode } from '@dovo/protocol'
import type { Activity } from '../storage/activity.js'
import { defaultShell, shellArguments } from './shell.js'
import { commandsSchema, type CommandSettings } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type * as pty from 'node-pty'
import type { TerminalInfo } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
import { HttpError } from '../errors.js'
import { stopUnixTerminal } from './stop-terminal.js'
// node-pty is a native addon that is only needed once a terminal is opened. Loading it
// lazily keeps it (and its native binding) out of the runtime's startup module graph.
let ptyModule: typeof pty | undefined
function loadPty() {
  ptyModule ??= createRequire(import.meta.url)('node-pty') as typeof pty
  return ptyModule
}
function notify(listeners: Set<(data: string) => void>, data: string) {
  for (const listener of listeners) {
    try {
      listener(data)
    } catch (error) {
      // A disconnected client must not stop the shell or the other attached clients.
      console.error('Terminal client failed', error)
    }
  }
}
type Session = {
  info: TerminalInfo
  process: pty.IPty
  buffer: string
  listeners: Set<(data: string) => void>
}
export class Terminals {
  private pendingEnsure = new Map<string, Promise<TerminalInfo>>()
  private exits = new Set<Promise<void>>()
  private shutdowns = new Set<Promise<void>>()
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private activity?: Pick<Activity, 'add'>,
  ) {}
  private sessions = new Map<string, Session>()
  list() {
    return [...this.sessions.values()].map((s) => s.info)
  }
  /** Reuse a live shell, even when two clients open the terminal at the same time. */
  ensure(
    taskId: string,
    directory: () => Promise<string>,
    checkoutId?: string,
    authorize: () => void = () => {},
  ): Promise<TerminalInfo> {
    authorize()
    const open = this.list().find(
      (session) =>
        session.taskId === taskId && session.checkoutId === checkoutId && !session.exited,
    )
    if (open) return Promise.resolve(open)
    const pending = this.pendingEnsure.get(`${taskId}:${checkoutId ?? ''}`)
    if (pending)
      return pending.then((terminal) => {
        authorize()
        return terminal
      })
    const result = directory()
      .then((cwd) => {
        authorize()
        return (
          this.list().find(
            (session) =>
              session.taskId === taskId && session.checkoutId === checkoutId && !session.exited,
          ) ?? this.create(taskId, cwd, checkoutId)
        )
      })
      .finally(() => this.pendingEnsure.delete(`${taskId}:${checkoutId ?? ''}`))
    this.pendingEnsure.set(`${taskId}:${checkoutId ?? ''}`, result)
    return result
  }
  create(taskId: string, cwd: string, checkoutId?: string) {
    const settings = this.settings()
    return this.createCommand(
      taskId,
      cwd,
      {
        command: settings.shell || defaultShell(),
        args: shellArguments(settings),
        env: {},
      },
      `Terminal ${this.sessions.size + 1}${checkoutId ? ' · linked checkout' : ''}`,
      checkoutId,
    )
  }
  createCommand(
    taskId: string,
    cwd: string,
    launch: AcpLaunch,
    title: string,
    checkoutId?: string,
  ) {
    // Retained output is bounded by the same cap, but finished unattended shells
    // must not permanently consume slots needed by new work. Attached output stays.
    for (const [id, session] of this.sessions) {
      if (this.sessions.size < 20) break
      if (session.info.exited && !session.listeners.size) void this.close(id)
    }
    if (this.sessions.size >= 20)
      throw new HttpError(409, 'Close a terminal before opening another (limit 20)')
    const inherited = processEnvironment()
    // PORT selects Dovo's own listener. Project servers must use their own defaults;
    // an explicit command environment can still select a port.
    delete inherited.PORT
    const env = { ...inherited, ...launch.env }
    delete env.DOVO_OWNER_TOKEN
    delete env.ELECTRON_RUN_AS_NODE
    const id = randomUUID(),
      terminal = loadPty().spawn(launch.command, launch.args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 24,
        cwd,
        env,
        // The OS ConPTY path enumerates processes after closing the console, then
        // kills a potentially recycled PID five seconds later (node-pty #967).
        // The bundled ConPTY owns teardown without that delayed process sweep.
        ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
      })
    const session: Session = {
      info: {
        id,
        taskId,
        ...(checkoutId ? { checkoutId } : {}),
        title,
        exited: false,
      },
      process: terminal,
      buffer: '',
      listeners: new Set(),
    }
    this.sessions.set(id, session)
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    this.exits.add(exited)
    this.activity?.add('terminal', id, 'Shell started', {
      taskId,
      cwd,
      command: launch.command,
    })
    terminal.onData((data) => {
      session.buffer = (session.buffer + data).slice(-1024 * 1024)
      notify(session.listeners, data)
    })
    terminal.onExit(({ exitCode }) => {
      session.info = {
        ...session.info,
        exited: true,
        exitCode,
      }
      if (this.sessions.has(id))
        this.activity?.add('terminal', id, 'Shell exited', {
          taskId,
          exitCode,
        })
      notify(session.listeners, `\r\n[Process exited ${exitCode}]\r\n`)
      this.exits.delete(exited)
      resolveExit()
    })
    return session.info
  }
  get(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new HttpError(404, 'Terminal not found')
    return session
  }
  attach(id: string, listener: (data: string) => void) {
    const session = this.get(id)
    listener(session.buffer)
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }
  input(id: string, data: string) {
    const session = this.get(id)
    if (!session.info.exited) session.process.write(data)
  }
  resize(id: string, cols: number, rows: number) {
    const session = this.get(id)
    if (!session.info.exited) session.process.resize(cols, rows)
  }
  close(id: string) {
    const session = this.get(id)
    let shutdown = Promise.resolve()
    if (!session.info.exited) {
      if (process.platform === 'win32') session.process.kill()
      else shutdown = stopUnixTerminal(session.process, () => session.info.exited)
    }
    this.shutdowns.add(shutdown)
    void shutdown.then(
      () => this.shutdowns.delete(shutdown),
      (error) => console.error('Terminal shutdown failed', error),
    )
    this.activity?.add('terminal', id, 'Terminal closed', {
      taskId: session.info.taskId,
    })
    this.sessions.delete(id)
    return shutdown
  }
  async dispose() {
    for (const id of this.sessions.keys()) void this.close(id)
    // kill() can be deferred until a Windows PTY is ready. Closing the list entry
    // does not mean its process and working-directory handles have been released.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([...this.exits, ...this.shutdowns]).then((results) => {
          const failures: unknown[] = []
          for (const result of results)
            if (result.status === 'rejected') failures.push(result.reason)
          if (failures.length) throw new AggregateError(failures, 'Terminal shutdown failed')
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Terminal processes did not exit during shutdown')),
            10_000,
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
}
