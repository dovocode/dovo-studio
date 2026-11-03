import type { AcpLaunch } from '../agents/execution/types.js'
import { decode, updateTerminalSchema, STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import type { Activity } from '../storage/activity.js'
import { defaultShell, shellArguments } from './shell.js'
import { commandsSchema, type CommandSettings } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import type * as pty from 'node-pty'
import type { TerminalInfo, UpdateTerminal } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
import { HttpError } from '../errors.js'
import { canSleepTerminal, stopUnixTerminal } from './stop-terminal.js'
import { TerminalMetadata } from './metadata.js'
import { isDeepStrictEqual } from 'node:util'
import {
  TerminalRecovery,
  recoveryCommand,
  validateRecoveryShell,
  type TerminalRecoveryRecord,
} from './recovery.js'
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
/** UTF-16 character cap, matching String.slice even at a surrogate boundary. */
class RetainedOutput {
  private chunks: (string | undefined)[] = []
  private head = 0
  private length = 0
  append(data: string) {
    const cap = 1024 * 1024
    if (!data.length) return
    if (data.length >= cap) {
      this.chunks = [data.slice(-cap)]
      this.head = 0
      this.length = cap
      return
    }
    this.length += data.length
    // Coalesce tiny PTY writes without repeatedly copying the entire replay window.
    const tail = this.chunks.at(-1)
    if (tail !== undefined && tail.length < 4096) {
      const take = Math.min(4096 - tail.length, data.length)
      this.chunks[this.chunks.length - 1] = tail + data.slice(0, take)
      data = data.slice(take)
    }
    if (data.length) this.chunks.push(data)
    while (this.length > cap) {
      const first = this.chunks[this.head]!
      const remove = Math.min(this.length - cap, first.length)
      this.length -= remove
      if (remove === first.length) this.chunks[this.head++] = undefined
      else this.chunks[this.head] = first.slice(remove)
    }
    if (this.head >= 128 && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }
  read() {
    return this.chunks.slice(this.head).join('')
  }
}
type Session = {
  directory: string
  initialTitle: string
  command: string
  launch: AcpLaunch
  info: TerminalInfo
  process?: pty.IPty
  recovery?: TerminalRecoveryRecord
  output: RetainedOutput
  readonly buffer: string
  listeners: Set<(data: string) => void>
  pressures: Set<symbol>
}
export class Terminals {
  private pendingEnsure = new Map<string, Promise<TerminalInfo>>()
  private exits = new Set<Promise<void>>()
  private shutdowns = new Set<Promise<void>>()
  private sleeping = new Map<string, Promise<void>>()
  private sleepChecks = new WeakMap<Session, TerminalInfo['activity']>()
  private disposing = false
  private recoveryTimer?: ReturnType<typeof setInterval>
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private activity?: Pick<Activity, 'add'>,
    private serverEnvironment: (taskId: string) => Record<string, string> = () => ({}),
    private recovery?: TerminalRecovery,
  ) {
    for (const record of recovery?.list() ?? []) {
      try {
        if (!record.info.directory) throw new Error('Retained terminal has no directory')
        this.createCommand(
          record.info.taskId,
          record.info.directory,
          { ...record.shell, args: [...record.shell.args], env: {} },
          record.info.title,
          record.info.checkoutId,
          record.info.repositoryId,
          record.info,
          record,
        )
      } catch (error) {
        console.error('Could not retain terminal', record.info.id, error)
      }
    }
    if (recovery) {
      this.recoveryTimer = setInterval(() => this.syncRecovery(), 500)
      this.recoveryTimer.unref()
    }
  }
  private sessions = new Map<string, Session>()
  supportsRecovery() {
    return Boolean(this.recovery)
  }
  list() {
    return [...this.sessions.values()].map((s) => s.info)
  }
  checkCapacity() {
    if (
      this.sessions.size >= 20 &&
      ![...this.sessions.values()].some(
        (session) => session.info.exited && !session.info.pinned && !session.listeners.size,
      )
    )
      throw new HttpError(409, 'Close a terminal before opening another (limit 20)')
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
  create(taskId: string, cwd: string, checkoutId?: string, repositoryId?: string) {
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
      repositoryId,
    )
  }
  createCommand(
    taskId: string,
    cwd: string,
    launch: AcpLaunch,
    title: string,
    checkoutId?: string,
    repositoryId?: string,
    workspace?: Pick<TerminalInfo, 'shellId' | 'directory' | 'execution' | 'checkoutBranch'> & {
      rememberSession?: boolean
    },
    restored?: TerminalRecoveryRecord,
  ) {
    // Retained output is bounded by the same cap, but finished unattended shells
    // must not permanently consume slots needed by new work. Pinned and attached output stays.
    for (const [id, session] of this.sessions) {
      if (this.sessions.size < 20) break
      if (session.info.exited && !session.info.pinned && !session.listeners.size)
        void this.close(id)
    }
    if (this.sessions.size >= 20)
      throw new HttpError(409, 'Close a terminal before opening another (limit 20)')
    const id = restored?.info.id ?? randomUUID()
    const output = new RetainedOutput()
    const { rememberSession, ...details } = workspace ?? {}
    if (rememberSession && !this.recovery)
      throw new HttpError(409, 'Session recovery is unavailable on this runtime')
    if (restored || rememberSession) {
      if (taskId !== STUDIO_TERMINAL_SCOPE)
        throw new Error('Recovery is only available for standalone terminals')
      validateRecoveryShell(launch)
    }
    const info: TerminalInfo = restored
      ? { ...restored.info, dormant: true }
      : {
          id,
          taskId,
          directory: cwd,
          ...(checkoutId ? { checkoutId } : {}),
          ...(repositoryId ? { repositoryId } : {}),
          ...details,
          title,
          exited: false,
        }
    delete info.activity
    const session: Session = {
      directory: cwd,
      initialTitle: title,
      command: launch.command,
      launch,
      info,
      output,
      get buffer() {
        return output.read()
      },
      listeners: new Set(),
      pressures: new Set(),
      ...(restored || (rememberSession && this.recovery)
        ? {
            recovery: restored ?? { info, shell: { command: launch.command, args: launch.args } },
          }
        : {}),
    }
    this.sessions.set(id, session)
    if (restored) this.readRecovery(session)
    if (info.snoozedUntil && Date.parse(info.snoozedUntil) <= Date.now()) delete info.snoozedUntil
    if (restored && (info.settledAt || info.snoozedUntil || info.exited)) {
      this.persist(session)
    } else {
      try {
        this.start(session)
      } catch (error) {
        if (!restored) {
          this.sessions.delete(id)
          if (session.recovery) this.recovery?.remove(id)
          throw error
        }
        session.info = {
          ...session.info,
          dormant: true,
          recoveryError: error instanceof Error ? error.message : String(error),
        }
        this.persist(session)
      }
    }
    return session.info
  }
  private persist(session: Session) {
    if (
      !session.recovery ||
      !this.recovery ||
      this.disposing ||
      this.sessions.get(session.info.id) !== session
    )
      return
    const info = session.info.recoveryError?.startsWith('Could not save terminal recovery:')
      ? { ...session.info, recoveryError: undefined }
      : session.info
    const record = { ...session.recovery, info }
    try {
      this.recovery.put(record)
      session.recovery = record
      session.info = info
    } catch (error) {
      const message = `Could not save terminal recovery: ${error instanceof Error ? error.message : String(error)}`
      if (session.info.recoveryError !== message)
        console.error('Terminal recovery persistence failed', session.info.id, error)
      session.info = { ...session.info, recoveryError: message }
    }
  }
  private readRecovery(session: Session) {
    if (!session.recovery || !this.recovery) return
    try {
      const target = this.recovery.event(session.info.id)
      if (
        target === undefined ||
        ((!target || !session.info.recoverySetup) &&
          isDeepStrictEqual(target ?? undefined, session.recovery.target))
      )
        return
      session.recovery = { ...session.recovery, target: target ?? undefined }
      session.info = {
        ...session.info,
        recoveryProgram: target?.provider,
        recoveryError: undefined,
        ...(target ? { recoverySetup: undefined } : {}),
      }
      this.persist(session)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (session.info.recoveryError !== message) {
        session.info = { ...session.info, recoveryError: message }
        this.persist(session)
      }
    }
  }
  private syncRecovery(wake = true) {
    for (const session of this.sessions.values()) {
      this.readRecovery(session)
      if (
        wake &&
        !this.disposing &&
        session.info.dormant &&
        !this.sleeping.has(session.info.id) &&
        !session.info.exited &&
        !session.info.settledAt &&
        session.info.snoozedUntil &&
        Date.parse(session.info.snoozedUntil) <= Date.now()
      ) {
        session.info = { ...session.info, snoozedUntil: undefined }
        try {
          this.start(session)
        } catch (error) {
          session.info = {
            ...session.info,
            recoveryError: error instanceof Error ? error.message : String(error),
          }
        }
        this.persist(session)
      }
      if (wake) this.maybeSleep(session)
    }
  }
  /** A checkpointed, explicitly idle agent can release its PTY. Working and unreported jobs stay live. */
  private maybeSleep(session: Session) {
    const target = session.recovery?.target
    if (
      this.disposing ||
      !target ||
      session.info.recoveryError ||
      ['tmux', 'herdr'].includes(target.provider) ||
      !(session.info.settledAt || session.info.snoozedUntil) ||
      !session.process ||
      session.info.exited ||
      !['idle', 'done'].includes(session.info.activity?.state ?? '') ||
      session.info.activity?.app !== target.provider ||
      this.sleepChecks.get(session) === session.info.activity ||
      this.sleeping.has(session.info.id)
    )
      return
    const terminal = session.process,
      id = session.info.id
    this.sleepChecks.set(session, session.info.activity)
    let exited = false
    const shutdown = (async () => {
      if (!(await canSleepTerminal(terminal.pid, target.provider))) return
      // Inspection is asynchronous. Restore, new work, close or shutdown may have won the race.
      if (
        this.disposing ||
        this.sessions.get(id) !== session ||
        session.process !== terminal ||
        session.info.exited ||
        !(session.info.settledAt || session.info.snoozedUntil) ||
        !['idle', 'done'].includes(session.info.activity?.state ?? '') ||
        session.recovery?.target !== target ||
        session.info.recoveryError
      )
        return
      terminal.onExit(() => {
        exited = true
      })
      this.recovery?.freeze(id)
      session.process = undefined
      session.pressures.clear()
      session.info = { ...session.info, dormant: true, activity: undefined }
      this.persist(session)
      await stopUnixTerminal(terminal, () => exited)
    })()
      .catch((error: unknown) => {
        if (!exited) session.process = terminal
        session.info = {
          ...session.info,
          dormant: exited,
          recoveryError: `Could not put terminal to sleep: ${error instanceof Error ? error.message : String(error)}`,
        }
        this.persist(session)
        console.error('Terminal sleep failed', id, error)
      })
      .finally(() => this.sleeping.delete(id))
    this.sleeping.set(id, shutdown)
    this.shutdowns.add(shutdown)
    void shutdown.finally(() => this.shutdowns.delete(shutdown))
  }
  private start(session: Session) {
    const { info, launch, output } = session
    const id = info.id,
      taskId = info.taskId
    const cwd = session.recovery?.target?.directory ?? session.directory
    if (!statSync(cwd).isDirectory()) throw new Error(`Terminal folder is not a directory: ${cwd}`)
    session.info = { ...session.info, recoveryError: undefined }
    const resume = session.recovery?.target
      ? recoveryCommand(session.recovery.target, launch.command)
      : undefined
    const inherited = processEnvironment()
    delete inherited.PORT
    const env = { ...inherited, ...launch.env, ...this.serverEnvironment(taskId) }
    delete env.DOVO_OWNER_TOKEN
    delete env.ELECTRON_RUN_AS_NODE
    delete env.DOVO_TERMINAL_RECOVERY_DIRECTORY
    if (taskId === STUDIO_TERMINAL_SCOPE) {
      delete env.TMUX
      delete env.TMUX_PANE
      delete env.HC_SCOPE
    }
    if (session.recovery && this.recovery) {
      try {
        Object.assign(env, this.recovery.environment(id, env.PATH ?? ''))
        session.info = {
          ...session.info,
          recoverySetup:
            'Codex recovery uses the Dovo hook. If prompted, review it with /hooks. Agent integrations load on their next start.',
        }
      } catch (error) {
        session.info = {
          ...session.info,
          recoveryError: error instanceof Error ? error.message : String(error),
        }
      }
    }
    const terminal = loadPty().spawn(launch.command, launch.args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 24,
      cwd,
      env,
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    })
    session.process = terminal
    session.info = { ...session.info, dormant: false, exited: false, exitCode: undefined }
    this.persist(session)
    const metadata = new TerminalMetadata((event) => {
      const info = { ...session.info }
      if (event.type === 'title') {
        if (event.title === undefined) delete info.terminalTitle
        else info.terminalTitle = event.title
      } else {
        if (event.activity === undefined) delete info.activity
        else info.activity = event.activity
      }
      info.title = info.customTitle ?? info.terminalTitle ?? session.initialTitle
      // Runtime snapshot sync includes list() in its 200 ms change signature.
      if (!isDeepStrictEqual(info, session.info)) {
        session.info = info
        this.persist(session)
      }
    })
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
      if (session.process !== terminal) return
      output.append(data)
      metadata.write(data)
      notify(session.listeners, data)
    })
    terminal.onExit(({ exitCode }) => {
      if (session.process !== terminal) {
        resolveExit()
        this.exits.delete(exited)
        return
      }
      metadata.endProcess()
      this.readRecovery(session)
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
      this.persist(session)
      notify(session.listeners, `\r\n[Process exited ${exitCode}]\r\n`)
      this.exits.delete(exited)
      resolveExit()
    })
    if (resume) terminal.write(resume + '\r')
  }
  get(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new HttpError(404, 'Terminal not found')
    return session
  }
  async update(input: UpdateTerminal) {
    const { id, title, pinned, settled, snoozedUntil } = decode(updateTerminalSchema, input)
    const session = this.get(id)
    if (snoozedUntil != null && Date.parse(snoozedUntil) <= Date.now())
      throw new HttpError(400, 'Choose a future snooze time')
    const info = { ...session.info }
    if (title !== undefined) {
      if (title === null) delete info.customTitle
      else info.customTitle = title.trim()
      info.title = info.customTitle ?? info.terminalTitle ?? session.initialTitle
    }
    if (pinned !== undefined) info.pinned = pinned
    if (settled !== undefined) {
      if (settled) info.settledAt = new Date().toISOString()
      else delete info.settledAt
      delete info.snoozedUntil
    }
    // An explicit future snooze wins over settled in a combined update.
    if (snoozedUntil !== undefined) {
      if (snoozedUntil === null) delete info.snoozedUntil
      else {
        info.snoozedUntil = snoozedUntil
        delete info.settledAt
      }
    }
    session.info = info
    if (settled === false || snoozedUntil === null) this.sleepChecks.delete(session)
    if (
      session.info.dormant &&
      !session.info.exited &&
      (settled === false || snoozedUntil === null)
    ) {
      await this.sleeping.get(id)
      if (this.sessions.get(id) !== session) throw new HttpError(404, 'Terminal was closed')
      if (!session.info.dormant || session.process) return session.info
      if (session.info.settledAt || session.info.snoozedUntil) return session.info
      try {
        this.start(session)
      } catch (error) {
        session.info = {
          ...session.info,
          recoveryError: error instanceof Error ? error.message : String(error),
        }
      }
    }
    this.persist(session)
    this.maybeSleep(session)
    this.activity?.add('terminal', id, 'Terminal updated', { taskId: info.taskId })
    return session.info
  }
  attach(id: string, listener: (data: string) => void) {
    const session = this.get(id)
    listener(session.buffer)
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }
  /** Each subscriber owns its pressure independently; releasing one cannot resume another. */
  pressure(id: string) {
    const session = this.get(id)
    const key = Symbol('terminal subscriber')
    return (paused: boolean) => {
      if (paused) {
        if (session.pressures.has(key) || session.info.exited) return
        const first = session.pressures.size === 0
        session.pressures.add(key)
        if (first) session.process?.pause()
      } else if (session.pressures.delete(key) && !session.pressures.size && !session.info.exited) {
        session.process?.resume()
      }
    }
  }
  input(id: string, data: string) {
    const session = this.get(id)
    if (!session.info.exited) session.process?.write(data)
  }
  resize(id: string, cols: number, rows: number) {
    const session = this.get(id)
    if (!session.info.exited) session.process?.resize(cols, rows)
  }
  close(id: string) {
    const session = this.get(id)
    let shutdown = this.sleeping.get(id) ?? Promise.resolve()
    if (!this.disposing && session.recovery) {
      this.recovery?.freeze(id)
      this.recovery?.remove(id)
    }
    if (!session.info.exited && session.process) {
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
    clearInterval(this.recoveryTimer)
    this.syncRecovery(false)
    for (const session of this.sessions.values()) {
      this.persist(session)
      if (session.recovery) this.recovery?.freeze(session.info.id)
    }
    this.disposing = true
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
