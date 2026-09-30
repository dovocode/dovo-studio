import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { decode, serverUpdateStatusSchema, type ServerUpdateStatus } from '@dovo/protocol'
import { HttpError } from '../errors.js'

const directory = () =>
  dirname(process.env.DOVO_DATABASE_PATH ?? join(homedir(), '.dovo', 'runtime.sqlite'))
const statusPath = () => join(directory(), 'server-update-status.json')
const recordPath = () => join(directory(), 'server-service.json')
function writeStatus(value: ServerUpdateStatus) {
  const temporary = `${statusPath()}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }), {
    mode: 0o600,
  })
  renameSync(temporary, statusPath())
}

export function canUpdateServer() {
  if (process.env.DOVO_SERVER_DISTRIBUTION !== 'archive' || !existsSync(recordPath())) return false
  try {
    const record: unknown = JSON.parse(readFileSync(recordPath(), 'utf8'))
    if (
      !record ||
      typeof record !== 'object' ||
      !('launcher' in record) ||
      typeof record.launcher !== 'string'
    )
      return false
    const launcher = resolve(record.launcher)
    return (
      process.platform === 'linux' &&
      launcher.startsWith(join(homedir(), '.local', 'share', 'dovo', 'server') + '/')
    )
  } catch {
    return false
  }
}

export function serverUpdateStatus(): ServerUpdateStatus {
  try {
    const state = decode(serverUpdateStatusSchema, JSON.parse(readFileSync(statusPath(), 'utf8')))
    const deadline = state.status === 'queued' ? 45_000 : 15 * 60 * 1000
    if (
      ['queued', 'downloading', 'installing'].includes(state.status) &&
      state.updatedAt &&
      Date.now() - Date.parse(state.updatedAt) > deadline
    )
      return {
        ...state,
        status: 'error',
        error:
          'Update helper stopped before reporting completion. Check server-update.log and retry.',
      }
    return state
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { status: 'idle' }
    throw error
  }
}
export function startServerUpdate(version: string) {
  if (!canUpdateServer())
    throw new HttpError(409, 'This server uses an external installer. Update it on its host.')
  if (!/^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(version))
    throw new HttpError(400, 'Invalid release version')
  if (
    serverUpdateStatus().status === 'queued' ||
    serverUpdateStatus().status === 'downloading' ||
    serverUpdateStatus().status === 'installing'
  )
    throw new HttpError(409, 'A server update is already running')
  const entrypoint = process.argv[1]
  const cli = entrypoint && join(dirname(entrypoint), 'server-cli.js')
  if (!cli || !existsSync(cli))
    throw new HttpError(409, 'This server cannot launch its update helper')
  writeStatus({ status: 'queued', version })
  const log = openSync(join(directory(), 'server-update.log'), 'a', 0o600)
  let child
  try {
    // A detached process still belongs to the runtime's systemd cgroup and is killed on stop.
    // Give the updater its own user service so it can restart Dovo and verify the new runtime.
    const logPath = join(directory(), 'server-update.log')
    child = spawn(
      'systemd-run',
      [
        '--user',
        '--collect',
        '--quiet',
        `--unit=dovo-server-update-${randomUUID()}`,
        '--property=Type=exec',
        `--property=StandardOutput=append:${logPath}`,
        `--property=StandardError=append:${logPath}`,
        '--setenv=DOVO_SERVER_DISTRIBUTION=archive',
        ...(process.env.DOVO_RELEASE_VERSION
          ? [`--setenv=DOVO_RELEASE_VERSION=${process.env.DOVO_RELEASE_VERSION}`]
          : []),
        process.execPath,
        cli,
        'remote-update',
        '--data-dir',
        directory(),
        '--version',
        version,
      ],
      { stdio: ['ignore', log, log] },
    )
  } catch (error) {
    writeStatus({
      status: 'error',
      version,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    closeSync(log)
  }
  child.once('error', (error) => writeStatus({ status: 'error', version, error: error.message }))
  child.once('exit', (code) => {
    if (code !== 0)
      writeStatus({
        status: 'error',
        version,
        error: `Could not start update service (exit ${code}). Check server-update.log.`,
      })
  })
  child.unref()
  return { status: 'queued', version }
}
