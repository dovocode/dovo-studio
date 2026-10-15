import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
export interface LocalConnection {
  address: string
  token: string
  pid: number
  bindHost?: string
}
export function readConnection(path: string): LocalConnection {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('address' in value) ||
    typeof value.address !== 'string' ||
    !('token' in value) ||
    typeof value.token !== 'string' ||
    value.token.length < 32 ||
    !('pid' in value) ||
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid < 1
  )
    throw new Error(`Invalid runtime connection file: ${path}`)
  const url = new URL(value.address)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(`Invalid runtime address in ${path}`)
  return {
    address: url.origin,
    token: value.token,
    pid: value.pid,
    bindHost:
      'bindHost' in value && typeof value.bindHost === 'string' ? value.bindHost : url.hostname,
  }
}
export async function publishConnection(directory: string, connection: LocalConnection) {
  const path = join(directory, 'runtime-connection.json')
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(connection), {
    mode: 0o600,
  })
  chmodSync(temporary, 0o600)
  try {
    // Windows scanners/readers may briefly prevent replacement of the previous
    // discovery file. Keep the old file intact until atomic replacement succeeds.
    const deadline = Date.now() + 1000
    for (;;) {
      try {
        await rename(temporary, path)
        break
      } catch (error) {
        if (
          process.platform !== 'win32' ||
          !(
            error instanceof Error &&
            'code' in error &&
            (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')
          ) ||
          Date.now() >= deadline
        )
          throw error
        await delay(25)
      }
    }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return () => {
    let saved: LocalConnection
    try {
      saved = readConnection(path)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        console.warn('Could not verify runtime discovery file ownership; leaving it in place.')
      return
    }
    if (saved.pid === connection.pid) unlinkSync(path)
  }
}
export function connectionPaths() {
  if (process.env.DOVO_DATABASE_PATH)
    return [join(dirname(process.env.DOVO_DATABASE_PATH), 'runtime-connection.json')]
  if (process.env.DOVO_DATA_ROOT)
    return [process.env.DOVO_DATA_ROOT, join(process.env.DOVO_DATA_ROOT, 'desktop')]
      .map((directory) => join(directory, 'runtime-connection.json'))
      .filter(existsSync)
  const home = homedir()
  const appData =
    process.platform === 'darwin'
      ? join(home, 'Library/Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(home, 'AppData/Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(home, '.config'))
  return [
    join(home, '.dovo'),
    join(home, '.dovo', 'desktop'),
    join(appData, '@dovo/desktop'),
    join(appData, 'Dovo Studio'),
  ]
    .map((directory) => join(directory, 'runtime-connection.json'))
    .filter(existsSync)
}
