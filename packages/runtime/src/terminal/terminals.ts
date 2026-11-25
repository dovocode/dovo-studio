import { sandboxLaunch, type SandboxSession } from '../sandbox/launcher.js'
import type { AcpLaunch } from '../agents/execution/types.js'
import {
  decode,
  decodeResult,
  terminalTitleSchema,
  updateTerminalSchema,
  STUDIO_TERMINAL_SCOPE,
  terminalChildActivityLimit,
  redactCredentialText,
  type terminalChildrenResultSchema,
  type terminalChildNoticeSchema,
} from '@dovo/protocol'
import type { Activity } from '../storage/activity.js'
import { commandCheckLaunch, defaultShell, shellArguments } from './shell.js'
import { commandsSchema, type CommandSettings } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import type * as pty from 'node-pty'
import type { TerminalInfo, UpdateTerminal } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
import { HttpError, errorMessage } from '../errors.js'
import { canSleepTerminal, stopUnixTerminal } from './stop-terminal.js'
import { TerminalMetadata, updateChildActivities } from './metadata.js'
import {
  HeldTerminal,
  HolderInputError,
  TerminalHolder,
  type HolderError,
  type TerminalProcess,
} from './holder-client.js'
import { TerminalScreenState } from './screen.js'
import {
  TERMINAL_SEQUENCE_GROUND,
  skipTerminalSnapshotContinuation,
  terminalSequenceStateAfter,
} from './replay-boundary.js'
import type { HolderRootActivity } from './holder-protocol.js'
import { hookActivityHistory, type TerminalHookActivity } from './hook-activity.js'
import {
  advanceTerminalTurn,
  closeWorkingTurns,
  restoreHookTurnIds,
  initialTerminalTurnProgress,
  type TerminalTurnProgress,
} from './turn-state.js'
import { isDeepStrictEqual, stripVTControlCharacters } from 'node:util'
import {
  TerminalRecovery,
  recoveryCommand,
  validateRecoveryShell,
  type TerminalRecoveryRecord,
} from './recovery.js'
import type { RecoveryIntegrationProvider } from './recovery-integrations.js'
// node-pty is a native addon that is only needed once a terminal is opened. Loading it
// lazily keeps it (and its native binding) out of the runtime's startup module graph.
let ptyModule: typeof pty | undefined
function loadPty() {
  ptyModule ??= createRequire(import.meta.url)('node-pty') as typeof pty
  return ptyModule
}
function notifyObservers(session: Session, event: 'change' | 'close') {
  for (const observer of [...session.observers])
    try {
      observer(event)
    } catch (error) {
      console.error('Terminal status observer failed', session.info.id, error)
    }
}
const holderErrorPrefix = 'Waiting for the terminal holder: '
const integrationNames = {
  codex: 'Codex',
  claude: 'Claude',
  pi: 'Pi',
  opencode: 'OpenCode',
} satisfies Record<RecoveryIntegrationProvider, string>
const sleepErrorPrefix = 'Could not put terminal to sleep: '
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
  prefixState = TERMINAL_SEQUENCE_GROUND
  truncated = false
  discardPrefix() {
    this.chunks = []
    this.head = 0
    this.length = 0
    this.prefixState = TERMINAL_SEQUENCE_GROUND
    this.truncated = true
  }
  append(data: string) {
    const cap = 1024 * 1024
    if (!data.length) return
    if (this.length + data.length > cap) this.truncated = true
    if (data.length >= cap) {
      for (const chunk of this.chunks.slice(this.head))
        if (chunk) this.prefixState = terminalSequenceStateAfter(this.prefixState, chunk)
      this.prefixState = terminalSequenceStateAfter(this.prefixState, data, 0, data.length - cap)
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
      this.prefixState = terminalSequenceStateAfter(this.prefixState, first, 0, remove)
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
  process?: TerminalProcess
  /** A holder terminal waiting to reattach after its holder stopped answering. */
  held?: HeldTerminal
  holderRetryAt?: number
  /** The program ended during an explicit close. */
  closeEnded?: boolean
  /** A workspace request waits for the holder to confirm this launch. */
  confirmLaunch?: boolean
  exited?: Promise<void>
  recovery?: TerminalRecoveryRecord
  output: RetainedOutput
  screen: TerminalScreenState
  screenFromCheckpoint?: boolean
  readonly buffer: string
  listeners: Set<(data: string) => void>
  screenReplays: Map<(data: string) => void, (fallback?: string) => void>
  /** Status observers. `persist` reports every info change; `close` reports removal once. */
  observers: Set<(event: 'change' | 'close') => void>
  pressures: Set<symbol>
  activityEvent?: string
  childActivityProcess?: string
  activityProcess?: string
  metadataActivityAt?: number
  hookActivityAt?: number
  holderTurn?: number
  turnProgress: TerminalTurnProgress
  trackedInputs?: number
}
type WorkspaceTerminalOptions = Pick<
  TerminalInfo,
  'shellId' | 'directory' | 'execution' | 'checkoutBranch' | 'customTitle' | 'parentTerminalId'
> & {
  rememberSession?: boolean
  beforeSpawn?: () => void
  initialInput?: string
  /** The caller reports the launch only after the holder confirms it. No local fallback. */
  confirmLaunch?: boolean
}
function childNoticeState(
  info: TerminalInfo,
): typeof terminalChildNoticeSchema.Type.state | undefined {
  if (info.exited) return 'exited'
  const state = info.activity?.state
  if (state === 'blocked' || state === 'done' || state === 'error') return state
  if (state === 'idle' && info.turn) return 'done'
}
export class Terminals {
  private pendingEnsure = new Map<string, Promise<TerminalInfo>>()
  private exits = new Set<Promise<void>>()
  private shutdowns = new Set<Promise<void>>()
  private sleeping = new Map<string, Promise<void>>()
  private sleepChecks = new WeakMap<Session, TerminalInfo['activity']>()
  private disposing = false
  /** Thread terminals of a sandboxed thread start a shell inside its container. */
  private sandbox?: {
    required: (taskId: string) => boolean
    current: (taskId: string) => SandboxSession | undefined
  }
  setSandbox(sandbox: NonNullable<Terminals['sandbox']>) {
    this.sandbox = sandbox
  }
  private recoveryTimer?: ReturnType<typeof setInterval>
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private activity?: Pick<Activity, 'add'>,
    private serverEnvironment: (taskId: string) => Record<string, string> = () => ({}),
    private recovery?: TerminalRecovery,
    options: { holder?: TerminalHolder | false } = {},
  ) {
    // Unix keeps remembered standalone shells in a separate holder process. Windows and
    // in-memory runtimes keep the reopen-and-resume recovery.
    this.holder =
      options.holder === false
        ? undefined
        : (options.holder ??
          (recovery && process.platform !== 'win32'
            ? new TerminalHolder(recovery.holderDirectory)
            : undefined))
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
    // A child or parent may have been opened without session recovery.
    for (const session of this.sessions.values()) {
      const { id, parentTerminalId, childNotices } = session.info
      const notices = childNotices?.filter(
        (notice) => this.sessions.get(notice.terminalId)?.info.parentTerminalId === id,
      )
      if (
        (parentTerminalId && !this.sessions.has(parentTerminalId)) ||
        notices?.length !== childNotices?.length
      ) {
        session.info = {
          ...session.info,
          parentTerminalId:
            parentTerminalId && this.sessions.has(parentTerminalId) ? parentTerminalId : undefined,
          childNotices: notices?.length ? notices : undefined,
        }
        this.persist(session)
      }
    }
    this.recoveryTimer = setInterval(() => this.syncRecovery(), 500)
    this.recoveryTimer.unref()
  }
  private sessions = new Map<string, Session>()
  private closing = new Map<string, Promise<void>>()
  private holder?: TerminalHolder
  supportsRecovery() {
    return Boolean(this.recovery)
  }
  /** Remembered shells and their running commands survive a runtime restart. */
  supportsLiveRecovery() {
    return Boolean(this.recovery && this.holder)
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
  createCheck(taskId: string, cwd: string, command: string, title?: string, checkoutId?: string) {
    return this.createCommand(
      taskId,
      cwd,
      commandCheckLaunch(command),
      title ?? 'Command check',
      checkoutId,
    )
  }
  async checkSummary(id: string, waitMs: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const session = this.get(id)
    if (waitMs && !session.info.exited)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          session.listeners.delete(onData)
          signal.removeEventListener('abort', done)
          resolve()
        }
        const onData = () => {
          if (session.info.exited) done()
        }
        const timer = setTimeout(done, waitMs)
        session.listeners.add(onData)
        signal.addEventListener('abort', done, { once: true })
      })
    signal.throwIfAborted()
    const output = redactCredentialText(stripVTControlCharacters(session.buffer))
    const failedTests = new Set<string>()
    if (session.info.exited && session.info.exitCode !== 0)
      for (const line of output.split(/\r?\n/).reverse()) {
        const name =
          /^\s*(?:FAIL(?:ED)?\s+|--- FAIL:\s+|not ok\s+(?:\d+\s+-?\s*)?|[×✗]\s+)(\S.*)/.exec(
            line,
          )?.[1]
        if (name) failedTests.add(name.trim().slice(0, 200))
        if (failedTests.size === 12) break
      }
    return {
      id,
      running: !session.info.exited,
      exitCode: session.info.exitCode,
      turn: session.info.turn ?? 0,
      ...(session.info.activity ? { activity: session.info.activity } : {}),
      outputTail: output.slice(-3000),
      outputTruncated: output.length > 3000,
      ...(failedTests.size ? { failedTests: [...failedTests] } : {}),
    }
  }
  onCheckExit(id: string, report: (exitCode: number | undefined, tail: string) => void) {
    const session = this.get(id)
    void session.exited
      ?.then(() => {
        const tail = redactCredentialText(stripVTControlCharacters(session.buffer.slice(-3000)))
        report(session.info.exitCode, tail)
      })
      .catch((error: unknown) => console.error('Could not record terminal check result', error))
  }
  async createWorkspaceCommand(
    cwd: string,
    launch: AcpLaunch,
    title: string,
    repositoryId: string | undefined,
    options: WorkspaceTerminalOptions,
  ) {
    const { id } = this.createCommand(
      STUDIO_TERMINAL_SCOPE,
      cwd,
      launch,
      title,
      undefined,
      repositoryId,
      { ...options, confirmLaunch: true },
    )
    const { held } = this.get(id)
    if (held) {
      try {
        await held.waitForAdmission()
      } catch (error) {
        throw this.admissionFailure(id, held, error)
      } finally {
        // Later restarts of this terminal, such as after a lost holder, may fall back again.
        const session = this.sessions.get(id)
        if (session) delete session.confirmLaunch
      }
    } else if (options.initialInput !== undefined) this.input(id, options.initialInput)
    const info = this.get(id).info
    if (info.recoveryError?.startsWith('Could not save terminal recovery:'))
      throw new HttpError(503, info.recoveryError)
    return info
  }
  /**
   * Maps a failed held launch to receipt semantics. A launch the holder certainly never created
   * is a confirmed rejection (4xx with `mutationRejected`), so the same request can run again.
   * A launch that may exist is uncertain (503), so a retry can never start a duplicate.
   */
  private admissionFailure(id: string, held: HeldTerminal, error: unknown) {
    const session = this.sessions.get(id)
    const reason = errorMessage(error)
    if (this.disposing)
      return new HttpError(
        503,
        'The Dovo runtime stopped before the terminal holder confirmed the launch.',
      )
    if (!session) return new HttpError(409, 'The terminal closed before it started')
    if (held.established || held.creationUncertain)
      return new HttpError(503, `Could not confirm terminal startup: ${reason}`)
    // The holder never created it, so its startup command never ran. Forget the attempt.
    void this.remove(session)
    return new HttpError(
      409,
      `Could not start the terminal: ${reason}. Nothing ran, so you can try again.`,
      { mutationRejected: true },
    )
  }
  createCommand(
    taskId: string,
    cwd: string,
    launch: AcpLaunch,
    title: string,
    checkoutId?: string,
    repositoryId?: string,
    workspace?: WorkspaceTerminalOptions,
    restored?: TerminalRecoveryRecord,
  ) {
    if (!restored && workspace?.parentTerminalId) {
      if (taskId !== STUDIO_TERMINAL_SCOPE)
        throw new HttpError(400, 'Only standalone terminals can launch child terminals')
      this.validateChildLaunch(workspace.parentTerminalId)
    }
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
    const { rememberSession, beforeSpawn, initialInput, confirmLaunch, ...details } =
      workspace ?? {}
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
          title: details.customTitle ?? title,
          exited: false,
        }
    info.turn ??= 0
    info.seenTurn ??= 0
    info.seenRevision ??= 0
    // A stopped PTY cannot send its final report again after a restart.
    const asleep = restored?.info.dormant && !restored.held && (info.settledAt || info.snoozedUntil)
    const lastState = info.activity?.state
    const keepLastReport = info.exited
      ? lastState === 'done' || lastState === 'error'
      : asleep && (lastState === 'done' || lastState === 'idle')
    if (!keepLastReport) delete info.activity
    if (!restored?.held) delete info.childActivities
    delete info.foregroundProcess
    delete info.integrationError
    let screenPressure: ((paused: boolean) => void) | undefined
    const session: Session = {
      ...(confirmLaunch ? { confirmLaunch } : {}),
      directory: cwd,
      initialTitle: title,
      command: launch.command,
      launch,
      info,
      output,
      screen: new TerminalScreenState(100, 24, (paused) => screenPressure?.(paused)),
      get buffer() {
        return output.read()
      },
      listeners: new Set(),
      screenReplays: new Map(),
      observers: new Set(),
      pressures: new Set(),
      holderTurn: restored?.holderTurn,
      turnProgress: restored?.turnProgress ?? initialTerminalTurnProgress(),
      ...(restored || (rememberSession && this.recovery)
        ? {
            recovery: restored ?? { info, shell: { command: launch.command, args: launch.args } },
          }
        : {}),
    }
    this.sessions.set(id, session)
    screenPressure = this.pressure(id)
    if (restored) this.readRecovery(session)
    if (info.snoozedUntil && Date.parse(info.snoozedUntil) <= Date.now()) delete info.snoozedUntil
    if (restored?.held && !info.exited && this.holder) {
      // The program may still run in the holder. Never start a second shell before asking it.
      this.attachHeld(session, this.holder)
    } else if (restored && (info.settledAt || info.snoozedUntil || info.exited)) {
      this.persist(session)
    } else {
      try {
        this.start(session, beforeSpawn, initialInput)
      } catch (error) {
        if (!restored) {
          this.sessions.delete(id)
          session.screen.dispose()
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
  private persist(session: Session, notifyParent = true) {
    // Every status source ends here: PTY reports, hook and foreground polls, start and exit.
    notifyObservers(session, 'change')
    if (notifyParent) this.publishChild(session)
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
    const record = {
      ...session.recovery,
      info,
      holderTurn: session.holderTurn,
      turnProgress: session.turnProgress,
    }
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
  private publishChild(
    session: Session,
    removed = false,
    parentTerminalId = session.info.parentTerminalId,
  ) {
    const { id, turn = 0 } = session.info
    if (this.disposing || !parentTerminalId) return
    if (!removed && this.sessions.get(id) !== session) return
    const parent = this.sessions.get(parentTerminalId)
    if (!parent) return
    const current = parent.info.childNotices ?? []
    const previous = current.find((notice) => notice.terminalId === id)
    const state = removed ? undefined : childNoticeState(session.info)
    if ((state && (state !== previous?.state || turn !== previous.turn)) || (removed && previous)) {
      const notices = current.filter((notice) => notice.terminalId !== id)
      if (state) notices.push({ terminalId: id, state, turn })
      parent.info = {
        ...parent.info,
        childNotices: notices.length ? notices.slice(-terminalChildActivityLimit) : undefined,
      }
      this.persist(parent, false)
    } else notifyObservers(parent, 'change')
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
      this.readStatus(session)
      if (
        wake &&
        !this.disposing &&
        session.held &&
        !session.process &&
        session.holderRetryAt !== undefined &&
        session.holderRetryAt <= Date.now()
      ) {
        session.holderRetryAt = undefined
        session.held.reattach()
      }
      if (
        wake &&
        !this.disposing &&
        !session.held &&
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
  private readStatus(session: Session, publish = true, hookAtInput?: TerminalHookActivity | null) {
    if (!session.process || session.info.exited || session.info.dormant) return
    if (
      session.process instanceof HeldTerminal &&
      !session.process.ready &&
      !session.process.exited
    )
      return
    const info = { ...session.info }
    const previousTurnProgress = session.turnProgress
    const holderActivity =
      session.process instanceof HeldTerminal ? session.process.rootActivity : undefined
    try {
      // node-pty uses tcgetpgrp on Unix. Windows exposes the launch executable instead,
      // which cannot tell us whether an interactive shell is idle.
      const foregroundProcess = this.foreground(session)
      if (foregroundProcess && !isDeepStrictEqual(info.foregroundProcess, foregroundProcess)) {
        // A report belongs to the foreground job that emitted it. Returning to the
        // shell or starting another command invalidates that job's old activity.
        if (
          !holderActivity?.merged &&
          info.foregroundProcess &&
          session.activityProcess !== foregroundProcess.name
        ) {
          if (!holderActivity) {
            const ended = closeWorkingTurns(session.turnProgress)
            session.turnProgress = ended.progress
            info.turn = Math.min(Number.MAX_SAFE_INTEGER, (info.turn ?? 0) + ended.count)
          }
          delete info.activity
          session.metadataActivityAt = undefined
          session.hookActivityAt = undefined
        }
        if (info.foregroundProcess && session.childActivityProcess !== foregroundProcess.name)
          delete info.childActivities
        info.foregroundProcess = foregroundProcess
      }
      if (!holderActivity?.merged && this.recovery && info.taskId === STUDIO_TERMINAL_SCOPE) {
        let event = hookAtInput
        if (event === undefined && !session.trackedInputs) event = this.recovery.activity(info.id)
        if (event && event.id !== session.activityEvent) {
          session.activityEvent = event.id
          const current = event.at > (session.metadataActivityAt ?? 0)
          for (const transition of hookActivityHistory(
            event,
            session.turnProgress.hookSequence ?? 0,
            session.turnProgress.hook.turn,
          )) {
            this.updateTurn(
              session,
              info,
              'hook',
              transition.state ?? undefined,
              transition.turn,
              current && !transition.skipped,
              transition.turnId,
            )
          }
          if (event.sequence !== undefined)
            session.turnProgress = { ...session.turnProgress, hookSequence: event.sequence }
          if (
            this.updateTurn(
              session,
              info,
              'hook',
              event.activity?.state,
              event.turn,
              current,
              event.turnId ?? event.activity?.turnId,
            )
          ) {
            info.activity = event.activity ?? undefined
            session.activityProcess = info.foregroundProcess?.name
            session.hookActivityAt = event.at
          }
          session.turnProgress = restoreHookTurnIds(
            session.turnProgress,
            event.openTurns,
            event.completedTurns,
          )
        }
      }
      if (
        !holderActivity?.merged &&
        info.integrationError?.startsWith('Could not read terminal status:')
      )
        delete info.integrationError
    } catch (error) {
      info.integrationError = `Could not read terminal status: ${error instanceof Error ? error.message : String(error)}`
    }
    if (
      !isDeepStrictEqual(previousTurnProgress, session.turnProgress) ||
      !isDeepStrictEqual(info, session.info)
    ) {
      session.info = info
      if (publish) this.persist(session)
    }
  }
  private updateTurn(
    session: Session,
    info: TerminalInfo,
    source: 'osc' | 'hook',
    state: NonNullable<TerminalInfo['activity']>['state'] | undefined,
    turn: number | undefined,
    current: boolean,
    turnId?: string,
  ) {
    const next = advanceTerminalTurn(
      session.turnProgress,
      source,
      state === 'working',
      turn,
      current,
      turnId,
    )
    session.turnProgress = next.progress
    info.turn = Math.min(Number.MAX_SAFE_INTEGER, (info.turn ?? 0) + next.count)
    return next.apply
  }
  /** Apply the holder's count once, regardless of how much output replayed. */
  private applyHolderActivity(session: Session, root: HolderRootActivity) {
    if (root.merged) {
      const { merged } = root
      const previous = session.holderTurn ?? 0
      const info = { ...session.info, activity: merged.activity ?? undefined }
      info.turn = Math.min(
        Number.MAX_SAFE_INTEGER,
        (info.turn ?? 0) + Math.max(0, merged.turn - previous),
      )
      if (merged.hookError)
        info.integrationError = `Could not read terminal status: ${merged.hookError}`
      else if (info.integrationError?.startsWith('Could not read terminal status:'))
        delete info.integrationError
      session.holderTurn = merged.turn
      if (isDeepStrictEqual(info, session.info) && merged.turn === previous) return false
      session.info = info
      return true
    }
    if (!root.at) return false
    const info = { ...session.info }
    const previousTurnProgress = session.turnProgress
    if (
      this.updateTurn(
        session,
        info,
        'osc',
        root.activity?.state,
        root.turn,
        root.at >= (session.hookActivityAt ?? 0),
        root.activity?.turnId,
      )
    ) {
      session.activityProcess = this.foreground(session)?.name
      info.activity = root.activity ?? undefined
    }
    session.metadataActivityAt = root.at
    const changed =
      !isDeepStrictEqual(previousTurnProgress, session.turnProgress) ||
      !isDeepStrictEqual(info, session.info)
    if (changed) session.info = info
    return changed
  }
  private foreground(session: Session) {
    if (!session.process || !['linux', 'darwin'].includes(process.platform)) return
    const name = basename(session.process.process).replace(/^-/, '')
    if (!decodeResult(terminalTitleSchema, name).success) return
    return {
      name,
      idle: ['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'nu', 'pwsh'].includes(name),
    }
  }
  /** A checkpointed, explicitly idle agent can release its PTY. Working and unreported jobs stay live. */
  private maybeSleep(session: Session) {
    const target = session.recovery?.target
    if (
      !this.recoveryTimer ||
      !target ||
      this.closing.has(session.info.id) ||
      session.info.recoveryError ||
      ['tmux', 'herdr'].includes(target.provider) ||
      !(session.info.settledAt || session.info.snoozedUntil) ||
      !session.process ||
      session.info.exited ||
      !['idle', 'done'].includes(session.info.activity?.state ?? '') ||
      session.info.childActivities?.some(({ activity }) =>
        ['working', 'blocked'].includes(activity.state),
      ) ||
      session.info.activity?.app !== target.provider ||
      this.sleepChecks.get(session) === session.info.activity ||
      this.sleeping.has(session.info.id)
    )
      return
    const terminal = session.process,
      id = session.info.id
    this.sleepChecks.set(session, session.info.activity)
    let exited = false
    let frozen = false
    const shutdown = (async () => {
      if (!(await canSleepTerminal(terminal.pid, target.provider))) return
      // Inspection is asynchronous. Restore, new work, close or shutdown may have won the race.
      if (
        !this.recoveryTimer ||
        this.sessions.get(id) !== session ||
        this.closing.has(id) ||
        session.process !== terminal ||
        session.info.exited ||
        !(session.info.settledAt || session.info.snoozedUntil) ||
        !['idle', 'done'].includes(session.info.activity?.state ?? '') ||
        session.info.childActivities?.some(({ activity }) =>
          ['working', 'blocked'].includes(activity.state),
        ) ||
        session.recovery?.target !== target ||
        session.info.recoveryError
      )
        return
      terminal.onExit(() => {
        exited = true
      })
      // Keep the checkpoint when the agent emits SessionEnd during shutdown.
      // A failed stop must release this marker so the live program can report again.
      this.recovery?.freeze(id)
      frozen = true
      session.process = undefined
      session.info = { ...session.info, dormant: true }
      if (terminal instanceof HeldTerminal) await terminal.close()
      else await stopUnixTerminal(terminal, () => exited)
      if (this.sessions.get(id) !== session) return
      session.held = undefined
      if (session.recovery) session.recovery = { ...session.recovery, held: false }
      session.pressures.clear()
      session.info = { ...session.info, childActivities: undefined, foregroundProcess: undefined }
      this.persist(session)
    })()
      .catch((error: unknown) => {
        if (this.sessions.get(id) !== session) return
        let message = errorMessage(error)
        if (!exited) {
          if (frozen) {
            try {
              this.recovery?.unfreeze(id)
            } catch (unfreezeError) {
              message += `. Could not resume terminal reports: ${errorMessage(unfreezeError)}`
            }
          }
          if (!(terminal instanceof HeldTerminal && !terminal.ready)) session.process = terminal
        }
        session.info = {
          ...session.info,
          dormant: !session.process,
          recoveryError: sleepErrorPrefix + message,
        }
        this.persist(session)
        console.error('Terminal sleep failed', id, error)
      })
      .finally(() => this.sleeping.delete(id))
    this.sleeping.set(id, shutdown)
    this.shutdowns.add(shutdown)
    void shutdown.finally(() => this.shutdowns.delete(shutdown))
  }
  /** A thread terminal for a sandboxed thread runs `bash -l` inside the container. The
   * thread's container must be ready; a sandboxed thread never falls back to the host. */
  private sandboxLaunch(taskId: string, cwd: string, launch: AcpLaunch, env: NodeJS.ProcessEnv) {
    if (!this.sandbox?.required(taskId)) return undefined
    const session = this.sandbox.current(taskId)
    if (!session)
      throw new HttpError(409, 'The thread sandbox is not running. Open the terminal again.')
    return sandboxLaunch(
      {
        ...session,
        explicitEnv: new Set([
          ...Object.keys(launch.env),
          ...Object.keys(this.serverEnvironment(taskId)),
          'TERM',
        ]),
      },
      { command: 'bash', args: ['-l'], env: { ...env, TERM: 'xterm-256color' }, cwd },
      { tty: true },
    )
  }
  private start(session: Session, beforeSpawn?: () => void, initialInput?: string) {
    const { info, launch } = session
    const id = info.id,
      taskId = info.taskId
    const cwd = session.recovery?.target?.directory ?? session.directory
    if (!statSync(cwd).isDirectory()) throw new Error(`Terminal folder is not a directory: ${cwd}`)
    session.info = {
      ...session.info,
      recoveryError: undefined,
      activity: undefined,
      foregroundProcess: undefined,
      integrationError: undefined,
    }
    delete session.info.childActivities
    session.childActivityProcess = undefined
    session.activityEvent = undefined
    session.activityProcess = undefined
    session.metadataActivityAt = undefined
    session.hookActivityAt = undefined
    session.holderTurn = undefined
    session.turnProgress = initialTerminalTurnProgress()
    const resume = session.recovery?.target
      ? recoveryCommand(session.recovery.target, launch.command)
      : undefined
    const inherited = processEnvironment()
    delete inherited.PORT
    const env = { ...inherited, ...launch.env, ...this.serverEnvironment(taskId) }
    delete env.DOVO_OWNER_TOKEN
    delete env.DOVO_TERMINAL_ID
    delete env.ELECTRON_RUN_AS_NODE
    // A shell is not the runtime. Programs started from it must not manage the holder's service.
    delete env.DOVO_TERMINAL_HOLDER_SUPERVISOR
    delete env.DOVO_TERMINAL_RECOVERY_DIRECTORY
    delete env.DOVO_TERMINAL_STATUS_DIRECTORY
    if (taskId === STUDIO_TERMINAL_SCOPE) {
      env.DOVO_TERMINAL_ID = id
      delete env.TMUX
      delete env.TMUX_PANE
      delete env.HC_SCOPE
    }
    if (taskId === STUDIO_TERMINAL_SCOPE && this.recovery) {
      try {
        Object.assign(env, this.recovery.environment(id, env.PATH ?? '', Boolean(session.recovery)))
        const failures = this.recovery.integrationFailures
        session.info = {
          ...session.info,
          ...(failures.length
            ? {
                integrationError: failures
                  .map(
                    ({ provider, message }) =>
                      `Could not install the ${integrationNames[provider]} terminal integration: ${message}`,
                  )
                  .join(' '),
              }
            : {}),
          ...(session.recovery
            ? {
                recoverySetup:
                  'Codex status and recovery use the Dovo hook. If prompted, review it with /hooks. Agent integrations load on their next start.',
              }
            : {}),
        }
      } catch (error) {
        session.info = {
          ...session.info,
          integrationError: `Could not install terminal integrations: ${error instanceof Error ? error.message : String(error)}`,
          ...(session.recovery
            ? { recoveryError: error instanceof Error ? error.message : String(error) }
            : {}),
        }
      }
    }
    const wrapped = this.sandboxLaunch(taskId, cwd, launch, env)
    const spawnLocal = () => {
      const terminal = loadPty().spawn(
        wrapped?.command ?? launch.command,
        wrapped?.args ?? launch.args,
        {
          name: 'xterm-256color',
          cols: 100,
          rows: 24,
          cwd,
          env: wrapped?.env ?? env,
          ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
        },
      )
      if (wrapped)
        terminal.onExit(() => {
          void wrapped
            .release()
            .catch((error: unknown) =>
              console.error('Could not stop sandboxed terminal processes', id, error),
            )
        })
      return terminal
    }
    // A remembered standalone shell runs in the holder so that it outlives this runtime.
    const holder =
      !wrapped && session.recovery && taskId === STUDIO_TERMINAL_SCOPE ? this.holder : undefined
    if (!holder) loadPty()
    beforeSpawn?.()
    if (session.recovery) session.recovery = { ...session.recovery, held: Boolean(holder) }
    let terminal: TerminalProcess
    if (holder) {
      const shellEnvironment: Record<string, string> = {}
      for (const [key, value] of Object.entries(env))
        if (value !== undefined) shellEnvironment[key] = value
      const held = holder.open(
        id,
        {
          file: launch.command,
          args: launch.args,
          cwd,
          env: shellEnvironment,
          cols: 100,
          rows: 24,
        },
        initialInput,
      )
      session.held = held
      terminal = held
    } else {
      terminal = spawnLocal()
      session.held = undefined
    }
    this.run(session, terminal, { resume, fallback: spawnLocal })
  }
  /**
   * A launch rejected before it could run can fall back for a caller using the synchronous API.
   * A stopped holder ended its programs, so the remembered shell reopens as after a reboot.
   * An unreachable or incompatible holder may still run the program, so nothing else starts.
   */
  private holderFailed(
    session: Session,
    terminal: HeldTerminal,
    error: HolderError,
    fallback?: () => TerminalProcess,
  ) {
    const id = session.info.id
    if (this.disposing || this.sessions.get(id) !== session || session.held !== terminal) return
    session.process = undefined
    session.pressures.clear()
    terminal.resume()
    session.info = { ...session.info, activity: undefined, foregroundProcess: undefined }
    if (
      error.kind !== 'missing' &&
      (terminal.established || !terminal.spawn || terminal.creationUncertain)
    ) {
      session.holderRetryAt = Date.now() + 3000
      session.info = {
        ...session.info,
        dormant: true,
        recoveryError: `${holderErrorPrefix}${error.message}`,
      }
      this.persist(session)
      return
    }
    delete session.info.childActivities
    // Neither case can reach this program again. Resolve its exit and forget it in the holder.
    session.held = undefined
    const queued = terminal.takeQueue()
    terminal.finish(-1)
    void this.holder
      ?.close(id)
      .catch((closeError: unknown) =>
        console.error('Could not close held terminal', id, closeError),
      )
    if (session.recovery) session.recovery = { ...session.recovery, held: false }
    if (
      !terminal.established &&
      (terminal.creationUncertain || terminal.initialInput !== undefined || session.confirmLaunch)
    ) {
      session.info = {
        ...session.info,
        exited: true,
        exitCode: -1,
        dormant: false,
        recoveryError: `Could not confirm terminal startup: ${error.message}`,
      }
      this.persist(session)
      return
    }
    if (!terminal.established && fallback) {
      try {
        const local = fallback()
        this.run(session, local, {})
        for (const data of queued) local.write(data)
        session.info = {
          ...session.info,
          integrationError: `Live recovery is unavailable: ${error.message}. This shell stops when the Dovo runtime restarts.`,
        }
      } catch (spawnError) {
        session.info = {
          ...session.info,
          exited: true,
          integrationError: `Could not start the terminal: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
        }
      }
      this.persist(session)
      return
    }
    session.info = { ...session.info, dormant: true }
    if (!session.info.settledAt && !session.info.snoozedUntil)
      try {
        this.start(session)
        session.info = {
          ...session.info,
          integrationError:
            'The earlier shell and its commands ended because the terminal holder stopped, for example after a computer restart. This is a new shell.',
        }
      } catch (startError) {
        session.info = {
          ...session.info,
          recoveryError: startError instanceof Error ? startError.message : String(startError),
        }
      }
    this.persist(session)
  }
  /** Reattach to a remembered program in the holder without running any command. */
  private attachHeld(session: Session, holder: TerminalHolder) {
    session.info = {
      ...session.info,
      recoveryError: undefined,
      activity: undefined,
      foregroundProcess: undefined,
      integrationError: undefined,
    }
    const terminal = holder.open(session.info.id)
    session.held = terminal
    this.run(session, terminal, { attached: true })
  }
  private run(
    session: Session,
    terminal: TerminalProcess,
    {
      resume,
      fallback,
      attached,
    }: { resume?: string; fallback?: () => TerminalProcess; attached?: boolean },
  ) {
    const { output } = session
    const id = session.info.id,
      taskId = session.info.taskId
    session.process = terminal
    session.holderRetryAt = undefined
    session.screen.resize(100, 24)
    session.info = { ...session.info, dormant: false, exited: false, exitCode: undefined }
    this.readStatus(session)
    this.persist(session)
    let replaying = false
    const metadata = new TerminalMetadata((event) => {
      const info = { ...session.info }
      const previousTurnProgress = session.turnProgress
      if (event.type === 'title') {
        if (event.title === undefined) delete info.terminalTitle
        else info.terminalTitle = event.title
      } else if (event.type === 'children') {
        if (terminal instanceof HeldTerminal && terminal.replayingChildSnapshot) return
        if (!event.id && !info.childActivities) return
        this.sleepChecks.delete(session)
        const children = updateChildActivities(info.childActivities, event)
        if (children) info.childActivities = children
        else delete info.childActivities
        if (event.activity) {
          try {
            session.childActivityProcess = this.foreground(session)?.name
          } catch (error) {
            info.integrationError = `Could not read terminal status: ${error instanceof Error ? error.message : String(error)}`
          }
        }
      } else {
        if (terminal instanceof HeldTerminal && terminal.rootActivity) return
        session.metadataActivityAt = Date.now()
        if (
          !replaying &&
          !this.updateTurn(
            session,
            info,
            'osc',
            event.activity?.state,
            undefined,
            true,
            event.turnId ?? event.activity?.turnId,
          )
        ) {
          if (
            info.turn !== session.info.turn ||
            !isDeepStrictEqual(previousTurnProgress, session.turnProgress)
          ) {
            session.info = info
            this.persist(session)
          }
          return
        }
        try {
          const foreground = this.foreground(session)
          session.activityProcess = foreground?.name
          if (foreground) {
            if (
              info.foregroundProcess &&
              info.foregroundProcess.name !== foreground.name &&
              session.childActivityProcess !== foreground.name
            )
              delete info.childActivities
            info.foregroundProcess = foreground
          }
        } catch (error) {
          info.integrationError = `Could not read terminal status: ${error instanceof Error ? error.message : String(error)}`
        }
        if (event.activity === undefined) delete info.activity
        else info.activity = event.activity
      }
      info.title = info.customTitle ?? info.terminalTitle ?? session.initialTitle
      // Runtime snapshot sync includes list() in its 200 ms change signature.
      if (
        !isDeepStrictEqual(previousTurnProgress, session.turnProgress) ||
        !isDeepStrictEqual(info, session.info)
      ) {
        session.info = info
        this.persist(session)
      }
    })
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    session.exited = exited
    this.exits.add(exited)
    this.activity?.add('terminal', id, attached ? 'Shell reattached' : 'Shell started', {
      taskId,
      cwd: session.recovery?.target?.directory ?? session.directory,
      command: session.launch.command,
    })
    if (terminal instanceof HeldTerminal) {
      terminal.onRootActivity((root) => {
        if (this.sessions.get(id) !== session || session.process !== terminal) return
        if (terminal.earlyExit) return
        if (this.applyHolderActivity(session, root)) this.persist(session)
      })
      terminal.onChildSnapshot((children) => {
        if (this.sessions.get(id) !== session || session.process !== terminal) return
        session.childActivityProcess = this.foreground(session)?.name
        const next = children.length ? children : undefined
        if (isDeepStrictEqual(session.info.childActivities, next)) return
        this.sleepChecks.delete(session)
        session.info = { ...session.info, childActivities: next }
        this.persist(session)
      })
      terminal.onReady((restored) => {
        if (this.sessions.get(id) !== session || session.held !== terminal) return
        session.process = terminal
        session.holderRetryAt = undefined
        // A note about refused input ends once input can reach the program again.
        if (session.info.integrationError?.endsWith('Input was not sent.'))
          session.info = { ...session.info, integrationError: undefined }
        if (restored) {
          const { screen, rawPrefix, replay, rawGap, resize } = restored
          if (rawGap) output.discardPrefix()
          const raw = rawPrefix + replay
          output.append(raw)
          session.screenFromCheckpoint = screen.kind === 'checkpoint'
          let fallback: string | undefined
          if (screen.kind === 'checkpoint') {
            session.screen.restore(screen.cols, screen.rows, screen.ansi)
            session.screen.write(replay)
            if (resize) session.screen.resize(resize.cols, resize.rows)
            if (screen.ansi.length + replay.length <= 1024 * 1024) fallback = screen.ansi + replay
          } else session.screen.dispose()
          // Checkpoint bytes restore display state only. Keep the raw transcript and
          // activity metadata tied to the original PTY output.
          replaying = true
          try {
            metadata.write(raw)
          } finally {
            replaying = false
          }
          notify(
            new Set(
              [...session.listeners].filter((listener) => !session.screenReplays.has(listener)),
            ),
            raw,
          )
          for (const reseed of session.screenReplays.values()) reseed(fallback)
        }
        if (session.info.dormant || session.info.recoveryError?.startsWith(holderErrorPrefix))
          session.info = { ...session.info, dormant: false, recoveryError: undefined }
        // The exit event carries the holder's final cursor. Publish it with final status.
        if (terminal.earlyExit) return
        // A runtime can stop after freezing a checkpoint but before closing the PTY.
        // Once a new runtime attaches to that live PTY, allow hooks to report again.
        if (attached && !this.disposing && !this.sleeping.has(id) && !this.closing.has(id)) {
          try {
            this.recovery?.unfreeze(id)
          } catch (error) {
            session.info = {
              ...session.info,
              recoveryError: `Could not resume terminal reports: ${errorMessage(error)}`,
            }
          }
        }
        if (terminal.rootActivity) this.applyHolderActivity(session, terminal.rootActivity)
        this.readStatus(session, false)
        this.persist(session)
      })
      terminal.onFailure((error) => this.holderFailed(session, terminal, error, fallback))
    }
    terminal.onData((data) => {
      if (session.process !== terminal) return
      output.append(data)
      session.screen.write(data)
      metadata.write(data)
      notify(session.listeners, data)
    })
    terminal.onExit(({ exitCode }) => {
      // An explicit close ends the program. Observers see the close, not a separate exit.
      if (session.process === terminal && this.closing.has(id)) {
        session.closeEnded = true
        session.info = { ...session.info, exited: true, exitCode }
      }
      if (session.process !== terminal || session.closeEnded) {
        resolveExit()
        this.exits.delete(exited)
        return
      }
      this.readStatus(session, false)
      const holderActivity = terminal instanceof HeldTerminal ? terminal.rootActivity : undefined
      if (holderActivity) this.applyHolderActivity(session, holderActivity)
      if (!holderActivity?.merged) {
        const ended = closeWorkingTurns(session.turnProgress)
        session.info = {
          ...session.info,
          turn: Math.min(Number.MAX_SAFE_INTEGER, (session.info.turn ?? 0) + ended.count),
        }
      }
      session.turnProgress = initialTerminalTurnProgress()
      session.holderTurn = undefined
      if (session.recovery?.held) session.recovery = { ...session.recovery, held: false }
      session.held = undefined
      session.info = {
        ...session.info,
        activity: ['done', 'error'].includes(session.info.activity?.state ?? '')
          ? session.info.activity
          : undefined,
        foregroundProcess: undefined,
        exited: true,
        exitCode,
      }
      metadata.endProcess()
      this.readRecovery(session)
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
  validateChildLaunch(parentId: string) {
    const parent = this.getStandaloneParent(parentId)
    if (
      parent.info.exited ||
      parent.info.dormant ||
      !parent.process ||
      (parent.held && !parent.held.ready) ||
      this.closing.has(parentId)
    )
      throw new HttpError(409, 'Open the parent terminal before launching a child')
  }
  private getStandaloneParent(id: string) {
    const parent = this.get(id)
    if (parent.info.taskId !== STUDIO_TERMINAL_SCOPE)
      throw new HttpError(400, 'Choose a standalone parent terminal')
    return parent
  }
  private childrenOf(id: string) {
    return [...this.sessions.values()].filter((session) => session.info.parentTerminalId === id)
  }
  async waitForChildren(
    id: string,
    until: 'any' | 'all',
    waitMs: number,
    signal: AbortSignal,
  ): Promise<typeof terminalChildrenResultSchema.Type> {
    signal.throwIfAborted()
    this.getStandaloneParent(id)
    const check = () => {
      const children = this.childrenOf(id).map((session) => session.info)
      if (until === 'all') {
        const ready = children.every(
          ({ exited, activity }) => exited || (activity && activity.state !== 'working'),
        )
        return { children, ready }
      }
      const ready = children.filter(childNoticeState)
      return ready.length || !children.length
        ? { children: ready, ready: true }
        : { children, ready: false }
    }
    const current = check()
    if (current.ready || !waitMs) return current
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        unsubscribe()
        signal.removeEventListener('abort', abort)
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(check())
      }, waitMs)
      const unsubscribe = this.observe(id, (event) => {
        if (event === 'close') {
          cleanup()
          reject(new HttpError(409, 'The parent terminal was closed while waiting'))
          return
        }
        const result = check()
        if (result.ready) {
          cleanup()
          resolve(result)
        }
      })
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  async update(input: UpdateTerminal) {
    const { id, title, pinned, settled, snoozedUntil, view, parentTerminalId } = decode(
      updateTerminalSchema,
      input,
    )
    const session = this.get(id)
    if (snoozedUntil != null && Date.parse(snoozedUntil) <= Date.now())
      throw new HttpError(400, 'Choose a future snooze time')
    const info = { ...session.info }
    const oldParent = info.parentTerminalId
    if (
      (settled !== undefined || snoozedUntil !== undefined) &&
      info.recoveryError?.startsWith(sleepErrorPrefix)
    ) {
      delete info.recoveryError
      this.sleepChecks.delete(session)
    }
    if (parentTerminalId === null) {
      if (info.taskId !== STUDIO_TERMINAL_SCOPE)
        throw new HttpError(400, 'Choose a standalone child terminal')
      delete info.parentTerminalId
    }
    if (view) {
      if (
        !view.turn ||
        view.turn !== info.turn ||
        view.expectedRevision !== (info.seenRevision ?? 0)
      )
        throw new HttpError(409, 'Terminal activity changed. Refresh the terminal.')
      info.seenTurn = view.seen ? view.turn : view.turn - 1
      info.seenRevision = view.expectedRevision + 1
    }
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
    if (parentTerminalId === null && oldParent) {
      // The parent wait must see the new membership before it wakes.
      this.persist(session)
      this.publishChild(session, true, oldParent)
    }
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
      // The holder may still run this program. Ask again rather than start a second shell.
      if (session.held) {
        session.holderRetryAt = undefined
        session.held.reattach()
        return session.info
      }
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
    // Viewing a completion changes only the shared read cursor.
    if (!view || [title, pinned, settled, snoozedUntil].some((change) => change !== undefined)) {
      this.maybeSleep(session)
      this.activity?.add('terminal', id, 'Terminal updated', { taskId: info.taskId })
    }
    return session.info
  }
  attach(id: string, listener: (data: string) => void) {
    const session = this.get(id)
    listener(session.buffer)
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }
  attachScreen(id: string, replay: (data: string) => void, live: (data: string) => void) {
    const session = this.get(id)
    type Capture = { raw: string; prefixState: number; queued: string[]; length: number }
    let pending: Capture | undefined
    let continuation = TERMINAL_SEQUENCE_GROUND
    const writeLive = (data: string) => {
      if (continuation === TERMINAL_SEQUENCE_GROUND) return live(data)
      const result = skipTerminalSnapshotContinuation(continuation, data)
      continuation = result.state
      if (result.data.length) live(result.data)
    }
    const finish = (capture: Capture, screen?: string) => {
      if (
        pending !== capture ||
        this.sessions.get(id) !== session ||
        !session.listeners.has(listener)
      )
        return
      pending = undefined
      try {
        continuation = TERMINAL_SEQUENCE_GROUND
        if (screen === undefined && capture.prefixState !== TERMINAL_SEQUENCE_GROUND) {
          const clipped = skipTerminalSnapshotContinuation(capture.prefixState, capture.raw)
          continuation = clipped.state
          replay(clipped.data)
        } else replay(screen ?? capture.raw)
        if (capture.queued.length) writeLive(capture.queued.join(''))
      } catch (error) {
        console.error('Terminal client failed', error)
      }
    }
    const listener = (data: string) => {
      if (pending && pending.length + data.length > 64 * 1024) finish(pending)
      if (!pending) writeLive(data)
      else if (data.length) {
        pending.queued.push(data)
        pending.length += data.length
      }
    }
    const reseed = (fallback?: string) => {
      const capture = {
        raw: fallback ?? session.buffer,
        prefixState: fallback === undefined ? session.output.prefixState : TERMINAL_SEQUENCE_GROUND,
        queued: [],
        length: 0,
      }
      pending = capture
      if (!session.screenFromCheckpoint && !session.output.truncated && !session.screen.alternate) {
        finish(capture)
        return
      }
      void session.screen.replay().then(
        (screen) => finish(capture, screen),
        () => finish(capture),
      )
    }
    session.listeners.add(listener)
    session.screenReplays.set(listener, reseed)
    reseed()
    return () => {
      pending = undefined
      session.listeners.delete(listener)
      session.screenReplays.delete(listener)
    }
  }
  async screen(id: string, lines?: number) {
    const terminal = this.get(id)
    if (terminal.held && !terminal.held.ready)
      throw new HttpError(409, 'Terminal screen is waiting for live recovery.')
    const snapshot = await terminal.screen.screen(id, lines, redactCredentialText)
    this.get(id)
    if (!snapshot)
      throw new HttpError(409, 'Terminal screen is unavailable. Read the output summary.')
    return snapshot
  }
  /**
   * Reports status changes without output, such as a hook report or exit. `close` arrives once,
   * after which the observer is removed. Call the returned function to stop earlier.
   */
  observe(id: string, observer: (event: 'change' | 'close') => void) {
    const session = this.get(id)
    session.observers.add(observer)
    return () => {
      session.observers.delete(observer)
    }
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
  /** Input that cannot reach a held program throws 503 and is noted on the terminal. */
  input(id: string, data: string) {
    const session = this.get(id)
    if (session.info.exited) return
    try {
      if (session.process) session.process.write(data)
      else if (session.held && !session.held.exited)
        throw new HolderInputError('The terminal holder is reconnecting. Input was not sent.')
    } catch (error) {
      if (!(error instanceof HolderInputError)) throw error
      if (session.info.integrationError !== error.message) {
        session.info = { ...session.info, integrationError: error.message }
        this.persist(session)
      }
      throw new HttpError(503, error.message)
    }
  }
  async inputAtTurn(id: string, data: string) {
    const session = this.get(id)
    const process = session.process
    if (session.info.exited) throw new HttpError(409, 'The terminal has exited.')
    if (session.held && !session.held.ready)
      throw new HttpError(503, 'The terminal holder is reconnecting. Input was not sent.')
    if (!process) throw new HttpError(409, 'Open the terminal before sending input.')
    if (process instanceof HeldTerminal) {
      if (!process.rootActivity)
        throw new HttpError(
          409,
          'Tracked input requires a newer terminal holder. Input was not sent.',
        )
      session.trackedInputs = (session.trackedInputs ?? 0) + 1
      try {
        return await process.inputAtTurn(data, (hook) => {
          this.readStatus(session, true, hook)
          return session.info.turn ?? 0
        })
      } catch (error) {
        if (!(error instanceof HolderInputError)) throw error
        throw new HttpError(503, error.message)
      } finally {
        session.trackedInputs--
      }
    }
    this.readStatus(session)
    const turn = session.info.turn ?? 0
    this.input(id, data)
    return turn
  }
  resize(id: string, cols: number, rows: number) {
    const session = this.get(id)
    if (!session.info.exited && session.process) {
      session.process.resize(cols, rows)
      session.screen.resize(cols, rows)
    }
  }
  close(id: string): Promise<void> {
    const session = this.get(id)
    const pending = this.closing.get(id)
    if (pending) return pending
    const sleeping = this.sleeping.get(id)
    if (sleeping && !this.disposing)
      return sleeping.then(() => (this.sessions.get(id) === session ? this.close(id) : undefined))
    const held = !this.disposing && !session.info.exited && this.holder ? session.held : undefined
    const direct = !this.disposing && !session.info.exited ? session.process : undefined
    let stop: Promise<void> | undefined
    if (held) {
      stop = held.close().catch((error: unknown) => {
        if (!session.closeEnded)
          throw new HttpError(
            503,
            `The terminal holder did not confirm the close, so the program may still run. Try again. ${errorMessage(error)}`,
          )
      })
    } else if (!this.disposing && session.recovery?.held && !session.info.exited && this.holder) {
      stop = this.holder.close(id)
    } else if (direct && !(direct instanceof HeldTerminal)) {
      if (process.platform === 'win32') {
        direct.kill()
        stop = session.exited
      } else
        stop = stopUnixTerminal(direct, () => Boolean(session.closeEnded || session.info.exited))
    }
    if (stop) {
      // Keep the terminal, its recovery record and its children until shutdown succeeds.
      const closing = stop
        .then(() => {
          if (this.sessions.get(id) !== session) return
          session.held = undefined
          session.process = undefined
          if (session.recovery) session.recovery = { ...session.recovery, held: false }
          return this.remove(session, true)
        })
        .finally(() => this.closing.delete(id))
      this.closing.set(id, closing)
      closing.catch((error: unknown) => console.error('Terminal close failed', id, error))
      return closing
    }
    return this.remove(session)
  }
  private remove(session: Session, explicit = !this.disposing) {
    const id = session.info.id
    let shutdown = this.sleeping.get(id) ?? Promise.resolve()
    // A runtime shutdown leaves a held program running and its status hooks reporting.
    const keep = !explicit && Boolean(session.recovery?.held && this.holder)
    if (session.info.taskId === STUDIO_TERMINAL_SCOPE && !keep) this.recovery?.freeze(id)
    if (explicit && session.recovery) {
      this.recovery?.remove(id)
    }
    if (keep) {
      this.holder?.release(id)
      if (session.exited) this.exits.delete(session.exited)
    } else if (!session.info.exited && session.process instanceof HeldTerminal) {
      shutdown = session.process.close()
    } else if (!session.info.exited && session.process) {
      if (process.platform === 'win32') session.process.kill()
      else shutdown = stopUnixTerminal(session.process, () => session.info.exited)
    } else if (session.recovery?.held && this.holder) {
      // An unreachable holder may still run it. Close it now, or when the holder answers again.
      shutdown = this.holder.close(id)
    }
    if (!session.recovery && session.info.taskId === STUDIO_TERMINAL_SCOPE && this.recovery) {
      const recovery = this.recovery
      shutdown = shutdown.finally(() => recovery.clearSession(id))
    }
    this.shutdowns.add(shutdown)
    void shutdown.then(
      () => this.shutdowns.delete(shutdown),
      (error) => {
        this.shutdowns.delete(shutdown)
        console.error('Terminal shutdown failed', error)
      },
    )
    this.activity?.add('terminal', id, 'Terminal closed', {
      taskId: session.info.taskId,
    })
    this.sessions.delete(id)
    if (explicit) {
      for (const child of this.childrenOf(id)) {
        child.info = { ...child.info, parentTerminalId: undefined }
        this.persist(child)
      }
      this.publishChild(session, true)
    }
    session.screen.dispose()
    session.screenReplays.clear()
    notifyObservers(session, 'close')
    session.observers.clear()
    return shutdown
  }
  async dispose() {
    clearInterval(this.recoveryTimer)
    this.recoveryTimer = undefined
    // A sleep may have frozen the hooks but not yet committed the dormant state.
    // Keep the holder connected until that operation commits or restores reporting.
    if (this.sleeping.size) await Promise.all(this.sleeping.values())
    this.syncRecovery(false)
    for (const session of this.sessions.values()) {
      this.persist(session)
      if (session.recovery && !(session.recovery.held && this.holder))
        this.recovery?.freeze(session.info.id)
    }
    this.disposing = true
    for (const id of this.sessions.keys()) void this.close(id)
    this.holder?.disconnect()
    // kill() can be deferred until a Windows PTY is ready. Closing the list entry
    // does not mean its process and working-directory handles have been released.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([...this.exits, ...this.shutdowns, ...this.closing.values()]).then(
          (results) => {
            const failures: unknown[] = []
            for (const result of results)
              if (result.status === 'rejected') failures.push(result.reason)
            if (failures.length) throw new AggregateError(failures, 'Terminal shutdown failed')
          },
        ),
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
