import type { Activity } from '../storage/activity.js'
import { defaultShell } from './shell.js'
import { commandsSchema, type CommandSettings } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { TerminalInfo } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
import { HttpError } from '../errors.js'
type Session = {
  info: TerminalInfo
  process: pty.IPty
  buffer: string
  listeners: Set<(data: string) => void>
}
export class Terminals {
  constructor(
    private settings: () => CommandSettings = () => commandsSchema.parse({}),
    private activity?: Pick<Activity, 'add'>,
  ) {}
  private sessions = new Map<string, Session>()
  list() {
    return [...this.sessions.values()].map((s) => s.info)
  }
  create(taskId: string, cwd: string) {
    if (this.sessions.size >= 20)
      throw new HttpError(409, 'Close a terminal before opening another (limit 20)')
    const settings = this.settings()
    const shell = settings.shell || defaultShell()
    const id = randomUUID(),
      process = pty.spawn(shell, settings.shellArgs, {
        name: 'xterm-256color',
        cols: 100,
        rows: 24,
        cwd,
        env: processEnvironment(),
      })
    const session: Session = {
      info: { id, taskId, title: `Terminal ${this.sessions.size + 1}`, exited: false },
      process,
      buffer: '',
      listeners: new Set(),
    }
    this.sessions.set(id, session)
    this.activity?.add('terminal', id, 'Shell started', {
      taskId,
      cwd,
      shell,
      args: settings.shellArgs,
    })
    process.onData((data) => {
      session.buffer = (session.buffer + data).slice(-1024 * 1024)
      for (const listener of session.listeners) listener(data)
    })
    process.onExit(({ exitCode }) => {
      session.info = { ...session.info, exited: true, exitCode }
      if (this.sessions.has(id))
        this.activity?.add('terminal', id, 'Shell exited', { taskId, exitCode })
      for (const listener of session.listeners) listener(`\r\n[Process exited ${exitCode}]\r\n`)
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
    this.activity?.add('terminal', id, 'Terminal closed', { taskId: session.info.taskId })
    this.sessions.delete(id)
  }
  dispose() {
    for (const id of this.sessions.keys()) this.close(id)
  }
}
