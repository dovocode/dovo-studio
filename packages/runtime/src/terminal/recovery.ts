import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { decode, mutableStruct, terminalSchema, STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { quoteTerminalPaths } from './file-paths.js'
import { installRecoveryIntegrations } from './recovery-integrations.js'

export const recoveryTargetSchema = mutableStruct({
  provider: Schema.Literals(['codex', 'claude', 'pi', 'opencode', 'tmux', 'herdr']),
  sessionId: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(4000)),
  ),
  directory: Schema.String.pipe(Schema.check(Schema.isMaxLength(32768))),
})
export type RecoveryTarget = typeof recoveryTargetSchema.Type
const recordSchema = mutableStruct({
  info: terminalSchema,
  shell: mutableStruct({ command: Schema.String, args: Schema.Array(Schema.String) }),
  target: Schema.optional(recoveryTargetSchema),
})
export type TerminalRecoveryRecord = typeof recordSchema.Type
export function validateRecoveryShell(shell: TerminalRecoveryRecord['shell']) {
  const name = win32
    .basename(shell.command)
    .toLowerCase()
    .replace(/\.exe$/, '')
  const argumentsByShell: Record<string, readonly string[]> = {
    bash: ['-l', '-i', '-il', '-li', '--login', '--noprofile', '--norc'],
    zsh: ['-l', '-i', '-il', '-li', '-f'],
    sh: ['-l', '-i'],
    fish: ['-l', '-i', '--login', '--interactive', '--no-config'],
    nu: ['-l', '-i', '--login', '--interactive', '--no-config-file'],
    pwsh: ['-nologo', '-noprofile', '-noexit'],
    powershell: ['-nologo', '-noprofile', '-noexit'],
    cmd: ['/q', '/d'],
  }
  const allowed = argumentsByShell[name]
  if (!allowed || shell.args.some((arg) => !allowed.includes(arg.toLowerCase())))
    throw new Error(
      'Session recovery requires an interactive shell without startup command arguments. Turn off Remember session for this shell.',
    )
}
const documentSchema = mutableStruct({
  version: Schema.Literal(1),
  sessions: Schema.Array(recordSchema),
})
const eventSchema = mutableStruct({
  target: Schema.NullOr(recoveryTargetSchema),
})
const key = 'terminal-recovery:v1'

/** Only owning-runtime state is stored here. No tokens, shell environment or startup commands. */
export class TerminalRecovery {
  readonly directory: string
  private records = new Map<string, TerminalRecoveryRecord>()
  private installed = false
  constructor(
    private db: Database.Database,
    directory = join(dirname(resolve(db.name)), 'terminal-recovery'),
  ) {
    this.directory = directory
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      db.prepare('SELECT value FROM documents WHERE id = ?').get(key),
    )
    if (row) {
      const document = decode(documentSchema, JSON.parse(row.value))
      for (const record of document.sessions) {
        if (
          record.info.taskId !== STUDIO_TERMINAL_SCOPE ||
          !/^[a-f0-9-]{36}$/.test(record.info.id) ||
          !record.info.directory ||
          !isAbsolute(record.info.directory)
        )
          throw new Error('Invalid retained workspace terminal')
        this.records.set(record.info.id, record)
      }
    }
  }
  list() {
    return [...this.records.values()]
  }
  private save() {
    this.db
      .prepare(
        'INSERT INTO documents (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify({ version: 1, sessions: this.list() }))
  }
  put(record: TerminalRecoveryRecord) {
    this.records.set(record.info.id, decode(recordSchema, record))
    this.save()
  }
  remove(id: string) {
    this.records.delete(id)
    this.save()
    rmSync(this.sessionDirectory(id), { recursive: true, force: true })
  }
  private sessionDirectory(id: string) {
    return join(this.directory, id)
  }
  freeze(id: string) {
    const directory = this.sessionDirectory(id)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(join(directory, 'closing'), '', { mode: 0o600 })
  }
  event(id: string): RecoveryTarget | null | undefined {
    const file = join(this.sessionDirectory(id), 'state.json')
    if (!existsSync(file)) return undefined
    if (readFileSync(file).length > 65536) throw new Error('Terminal recovery event is too large')
    const event = decode(eventSchema, JSON.parse(readFileSync(file, 'utf8')))
    if (
      event.target &&
      (!isAbsolute(event.target.directory) || /\p{Cc}/u.test(event.target.directory))
    )
      throw new Error('Invalid recovery working directory')
    return event.target
  }
  environment(id: string, searchPath: string) {
    if (!this.installed) {
      installRecoveryIntegrations(this.directory)
      this.installed = true
    }
    const directory = this.sessionDirectory(id)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    rmSync(join(directory, 'closing'), { force: true })
    rmSync(join(directory, 'state.json'), { force: true })
    return {
      DOVO_TERMINAL_RECOVERY_DIRECTORY: directory,
      ...(process.platform !== 'win32'
        ? { PATH: `${join(this.directory, 'bin')}${delimiter}${searchPath}` }
        : {}),
    }
  }
}

export function recoveryCommand(target: RecoveryTarget, shell: string) {
  const { provider, sessionId, directory } = target
  if (/\p{Cc}/u.test(sessionId) || /\p{Cc}/u.test(directory) || !isAbsolute(directory))
    throw new Error('Invalid recovery target')
  if (
    ['codex', 'claude'].includes(provider) &&
    !/^[a-zA-Z0-9_-]+(?:-[a-zA-Z0-9_-]+)*$/.test(sessionId)
  )
    throw new Error('Invalid conversation ID')
  const args =
    provider === 'codex'
      ? ['codex', 'resume', sessionId, '--cd', directory]
      : provider === 'claude'
        ? ['claude', '--resume', sessionId]
        : provider === 'pi'
          ? ['pi', '--session', sessionId]
          : provider === 'opencode'
            ? ['opencode', directory, '--session', sessionId]
            : provider === 'tmux'
              ? ['tmux', 'attach-session', '-t', sessionId]
              : ['hc', 'attach', sessionId]
  if (win32.basename(shell).replace(/\.exe$/i, '') === 'nu') {
    const literal = (value: string) => {
      let fence = '#'
      while (value.includes(`'${fence}`)) fence += '#'
      return `r${fence}'${value}'${fence}`
    }
    return `^${args.map(literal).join(' ')}`
  }
  const quoted = quoteTerminalPaths(args, shell).trimEnd()
  return /(?:^|[/\\])(?:pwsh|powershell)(?:\.exe)?$/i.test(shell) ? `& ${quoted}` : quoted
}
