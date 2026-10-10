import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'

const recordSchema = mutableStruct({ at: Schema.String, message: Schema.String })
const cache = new Map<string, { at: string; message: string } | null>()
export function recordLastCrash(databasePath: string, error: unknown) {
  if (databasePath === ':memory:') return
  const record = {
    at: new Date().toISOString(),
    message: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(
      0,
      1000,
    ),
    stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
  }
  const file = lastCrashFile(databasePath)
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 })
  cache.set(file, record)
}
/** The runtime process writes this file when it exits on an uncaught exception. It is read
 * once per start and shown in Devices & runtime until dismissed. */
export function lastCrashFile(databasePath: string) {
  return join(dirname(databasePath), 'last-crash.json')
}
export function readLastCrash(databasePath: string) {
  if (databasePath === ':memory:') return undefined
  const file = lastCrashFile(databasePath)
  if (!cache.has(file)) {
    let value: { at: string; message: string } | null = null
    try {
      const parsed = decodeResult(recordSchema, JSON.parse(readFileSync(file, 'utf8')))
      if (parsed.success) value = { at: parsed.data.at, message: parsed.data.message }
    } catch {
      value = null
    }
    cache.set(file, value)
  }
  return cache.get(file) ?? undefined
}
export function clearLastCrash(databasePath: string) {
  if (databasePath === ':memory:') return
  const file = lastCrashFile(databasePath)
  cache.set(file, null)
  try {
    unlinkSync(file)
  } catch {
    // Already gone.
  }
}
