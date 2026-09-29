import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lockSync } from 'proper-lockfile'

export const localSettingsPath = () => join(homedir(), '.dovo', 'settings.json')

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
    const next = { ...document, [section]: update(document[section]) }
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
    release()
  }
}
