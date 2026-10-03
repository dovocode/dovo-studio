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
  ): Promise<TerminalInfo> {
    const open = this.list().find(
      (session) =>
        session.taskId === taskId && session.checkoutId === checkoutId && !session.exited,
    )
    if (open) return Promise.resolve(open)
    const pending = this.pendingEnsure.get(`${taskId}:${checkoutId ?? ''}`)
    if (pending) return pending
    const result = directory()
      .then(
        (cwd) =>
          this.list().find(
            (session) =>
              session.taskId === taskId && session.checkoutId === checkoutId && !session.exited,
          ) ?? this.create(taskId, cwd, checkoutId),
      )
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
    if (this.sessions.size >= 20)
      throw new HttpError(409, 'Close a terminal before opening another (limit 20)')
    const env = { ...processEnvironment(), ...launch.env }
    delete env.DOVO_OWNER_TOKEN
    delete env.ELECTRON_RUN_AS_NODE
    const id = randomUUID(),
      process = loadPty().spawn(launch.command, launch.args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 24,
        cwd,
        env,
      })
    const session: Session = {
      info: {
        id,
        taskId,
        ...(checkoutId ? { checkoutId } : {}),
        title,
        exited: false,
      },
      process,
      buffer: '',
      listeners: new Set(),
    }
    this.sessions.set(id, session)
    this.activity?.add('terminal', id, 'Shell started', {
      taskId,
      cwd,
      command: launch.command,
    })
    process.onData((data) => {
      session.buffer = (session.buffer + data).slice(-1024 * 1024)
      notify(session.listeners, data)
    })
    process.onExit(({ exitCode }) => {
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
    if (!session.info.exited) session.process.kill()
    this.activity?.add('terminal', id, 'Terminal closed', {
      taskId: session.info.taskId,
    })
    this.sessions.delete(id)
  }
  dispose() {
    for (const id of this.sessions.keys()) this.close(id)
  }
}
