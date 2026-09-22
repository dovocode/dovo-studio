import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { isIP } from 'node:net'

export interface ServerConfig {
  version: 1
  host: string
  port: number
  databasePath: string
  publicAddress?: string
}
export function serverDirectory(value?: string) {
  return resolve(
    value ??
      (process.env.DOVO_DATABASE_PATH
        ? dirname(process.env.DOVO_DATABASE_PATH)
        : join(homedir(), '.dovo')),
  )
}
export function publicOrigin(value: string) {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    ['0.0.0.0', '[::]'].includes(url.hostname)
  )
    throw new Error(
      'Public address must be a reachable HTTP(S) origin, including the runtime port; 0.0.0.0 is a bind address.',
    )
  return url.origin
}
export function validateServerConfig(value: unknown, directory: string): ServerConfig {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('host' in value) ||
    typeof value.host !== 'string' ||
    !('port' in value) ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    !('databasePath' in value) ||
    typeof value.databasePath !== 'string'
  )
    throw new Error(
      'Invalid server configuration: expected a host, port from 1 to 65535, and database path.',
    )
  if (!['localhost', 'local', 'tailscale', 'netbird'].includes(value.host) && !isIP(value.host))
    throw new Error(
      'Host must be an IP address, localhost, local, tailscale, or netbird. Use --public-address for a private DNS name.',
    )
  const databasePath = resolve(value.databasePath)
  if (dirname(databasePath) !== resolve(directory))
    throw new Error(
      'The database must be inside --data-dir so the connection and credentials stay with its workspace.',
    )
  if (
    'publicAddress' in value &&
    value.publicAddress !== undefined &&
    typeof value.publicAddress !== 'string'
  )
    throw new Error('Public address must be a URL.')
  return {
    version: 1,
    host: value.host,
    port: value.port,
    databasePath,
    ...('publicAddress' in value && typeof value.publicAddress === 'string'
      ? { publicAddress: publicOrigin(value.publicAddress) }
      : {}),
  }
}
export function readServerConfig(directory: string): ServerConfig {
  const path = join(directory, 'server.json')
  if (!existsSync(path))
    throw new Error(
      `Server is not configured. Run pnpm server setup --data-dir ${JSON.stringify(directory)} first.`,
    )
  return validateServerConfig(JSON.parse(readFileSync(path, 'utf8')), directory)
}
export function writePrivateJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}
export function setupServer(
  directory: string,
  options: { host?: string; port?: string; database?: string; publicAddress?: string } = {},
) {
  let saved: Partial<ServerConfig> = {}
  if (existsSync(join(directory, 'server.json'))) saved = readServerConfig(directory)
  else if (existsSync(join(directory, 'runtime-listen.json'))) {
    const listen: unknown = JSON.parse(readFileSync(join(directory, 'runtime-listen.json'), 'utf8'))
    if (
      !listen ||
      typeof listen !== 'object' ||
      !('address' in listen) ||
      typeof listen.address !== 'string'
    )
      throw new Error(
        'Invalid runtime-listen.json. Correct the saved listening address before setup.',
      )
    const address = new URL(listen.address)
    saved = {
      port: Number(address.port || (address.protocol === 'https:' ? 443 : 80)),
      host:
        'bindHost' in listen && typeof listen.bindHost === 'string'
          ? listen.bindHost
          : address.hostname.replace(/^\[|\]$/g, ''),
    }
  }
  const config = validateServerConfig(
    {
      version: 1,
      host: options.host ?? saved.host ?? '0.0.0.0',
      port: options.port === undefined ? (saved.port ?? 51464) : Number(options.port),
      databasePath: options.database
        ? resolve(options.database)
        : (saved.databasePath ?? join(directory, 'runtime.sqlite')),
      publicAddress: options.publicAddress ?? saved.publicAddress,
    },
    directory,
  )
  writePrivateJson(join(directory, 'server.json'), config)
  return config
}
