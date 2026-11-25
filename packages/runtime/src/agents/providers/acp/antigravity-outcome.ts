import Database from 'better-sqlite3'
import { lstatSync, realpathSync, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
import type { AcpLaunch } from '../../execution/types.js'
import { ProviderFailure, providerFailureKind } from '../../execution/provider-failure.js'

const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino
const owned = (file: Stats) => !process.getuid || process.getuid() === file.uid
function optionalStat(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
const privateFile = (file: Stats | undefined) =>
  !file || (file.isFile() && file.nlink === 1 && owned(file))
const lastStep = mutableStruct({ step_type: Schema.Number, payload: Schema.Unknown })

function antigravityQuotaResetAt(message: string) {
  const duration = /\bResets in (?:(\d{1,3})h)?(?:(\d{1,3})m)?(?:(\d{1,3})s)?(?=[.\s]|$)/.exec(
    message,
  )
  if (!duration) return
  const [, hours, minutes, seconds] = duration
  const delay =
    (Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000
  return delay > 0 ? Date.now() + delay : undefined
}

/** Only inspect an owned ACP session, and only rows that this prompt added. The log format is optional. */
export function watchAntigravityOutcome(launch: AcpLaunch, sessionId: string) {
  if (launch.sandbox || !/^[\w-]{1,128}$/.test(sessionId)) return
  const profile =
    launch.env.GEMINI_HOME ??
    process.env.GEMINI_HOME ??
    join(launch.env.HOME ?? homedir(), '.gemini')
  if (!isAbsolute(profile)) return
  try {
    const root = realpathSync(profile)
    const parent = join(root, 'antigravity-acp', 'conversations')
    const directory = lstatSync(parent)
    if (!directory.isDirectory() || !owned(directory) || realpathSync(parent) !== parent) return
    const path = join(parent, `${sessionId}.db`)
    let before = optionalStat(path)
    if (!privateFile(before)) return
    const read = <T>(inspect: (db: Database.Database) => T) => {
      if (!sameFile(lstatSync(parent), directory) || realpathSync(parent) !== parent) return
      const file = optionalStat(path)
      if (!file || !privateFile(file) || (before && !sameFile(file, before))) return
      if (!['-wal', '-shm', '-journal'].every((suffix) => privateFile(optionalStat(path + suffix))))
        return
      const db = new Database(path, { readonly: true, fileMustExist: true, timeout: 0 })
      try {
        db.pragma('trusted_schema = OFF')
        if (!sameFile(file, lstatSync(path))) return
        if (
          !db
            .prepare(
              "SELECT 1 FROM pragma_table_list('steps') WHERE type='table' AND schema='main'",
            )
            .get()
        )
          return
        const result = inspect(db)
        if (
          sameFile(file, lstatSync(path)) &&
          sameFile(directory, lstatSync(parent)) &&
          realpathSync(parent) === parent
        ) {
          before ??= file
          return result
        }
      } finally {
        db.close()
      }
    }
    const index = before
      ? read((db) => db.prepare('SELECT coalesce(max(idx), -1) FROM steps').pluck().get())
      : -1
    if (typeof index !== 'number' || !Number.isSafeInteger(index)) return
    return () => {
      try {
        const row = read((db) =>
          db
            .prepare(
              'SELECT step_type, CASE WHEN step_type = 17 THEN substr(CAST(step_payload AS BLOB), 1, 16384) END AS payload FROM steps WHERE idx > ? ORDER BY idx DESC LIMIT 1',
            )
            .get(index),
        )
        if (!row) return
        const step = decode(lastStep, row)
        if (step.step_type !== 17 || !Buffer.isBuffer(step.payload)) return
        const message = step.payload.toString('utf8')
        const kind = providerFailureKind(message)
        const detail = /\bauth_not_found\b/i.test(message)
          ? 'Antigravity reported 503 auth_not_found.'
          : 'Antigravity recorded a provider error for this turn.'
        const error = new Error(detail)
        return kind === 'unknown'
          ? error
          : new ProviderFailure(
              kind,
              error,
              kind === 'quota' ? antigravityQuotaResetAt(message) : undefined,
            )
      } catch {
        // Versions with a different log layout still report their ACP stop reason.
        return undefined
      }
    }
  } catch {
    return undefined
  }
}
