import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lockSync } from 'proper-lockfile'

export const localSettingsPath = () =>
  process.env.DOVO_SETTINGS_PATH ?? join(homedir(), '.dovo', 'settings.json')

function readDocument(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must contain a JSON object`)
  return value as Record<string, unknown>
}

export function readLocalSettingsSection(section: string, path = localSettingsPath()): unknown {
  return readDocument(path)[section]
}

export function writeLocalSettingsSection(
  section: string,
  update: (previous: unknown) => unknown,
  path = localSettingsPath(),
) {
  writeLocalSettingsSections((document) => ({ [section]: update(document[section]) }), path)
}

/** Replaces the returned sections in one atomic file write. Other sections stay unchanged.
 * `update` reads the current document while the lock is held. Return undefined to write nothing. */
export function writeLocalSettingsSections(
  update: (previous: Readonly<Record<string, unknown>>) => Record<string, unknown> | undefined,
  path = localSettingsPath(),
) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let release: (() => void) | undefined
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      release = lockSync(path, { realpath: false })
      break
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ELOCKED' ||
        attempt === 19
      )
        throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  if (!release) throw new Error('Could not lock settings')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const document = readDocument(path)
    const sections = update(document)
    if (!sections) return
    const next = { ...document, ...sections }
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
    release()
  }
}
