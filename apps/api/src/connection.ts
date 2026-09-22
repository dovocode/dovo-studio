import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
export function publishConnection(directory: string, connection: LocalConnection) {
  const path = join(directory, 'runtime-connection.json')
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(connection), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  return () => {
    if (existsSync(path) && readConnection(path).pid === connection.pid) unlinkSync(path)
  }
}
export function connectionPaths() {
  if (process.env.DOVO_DATABASE_PATH)
    return [join(dirname(process.env.DOVO_DATABASE_PATH), 'runtime-connection.json')]
  const home = homedir()
  const appData =
    process.platform === 'darwin'
      ? join(home, 'Library/Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(home, 'AppData/Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(home, '.config'))
  return [join(home, '.dovo'), join(appData, '@dovo/desktop'), join(appData, 'Dovo Studio')]
    .map((directory) => join(directory, 'runtime-connection.json'))
    .filter(existsSync)
}
