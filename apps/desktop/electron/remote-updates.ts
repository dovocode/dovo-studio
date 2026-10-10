import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DesktopUpdateState, ServerUpdateStatus } from '@dovo/protocol'

type Updater = {
  state: () => DesktopUpdateState
  remote: (action: 'download' | 'restart', version: string) => Promise<void>
  supported: boolean
  installedVersion?: string
}

/** Only the authenticated runtime proxies this private loopback endpoint to paired devices. */
export async function registerRemoteUpdates(
  directory: string,
  updater: Updater,
  sharedDirectory?: string,
) {
  if (!updater.supported) return
  const token = randomBytes(32).toString('hex')
  const paths = [...new Set([directory, ...(sharedDirectory ? [sharedDirectory] : [])])].map(
    (directory) => join(directory, 'desktop-update-host.json'),
  )
  let pending: { version: string; action: 'download' | 'restart' } | undefined
  let failure: { version: string; error: string } | undefined
  const status = (): ServerUpdateStatus => {
    const state = updater.state()
    if (failure)
      return {
        status:
          state.status === 'downloaded' && state.version === failure.version
            ? 'downloaded'
            : 'error',
        ...failure,
      }
    if (pending?.action === 'restart') return { status: 'installing', version: pending.version }
    if (
      pending &&
      (state.version !== pending.version ||
        !['downloading', 'downloaded', 'restarting'].includes(state.status))
    )
      return { status: 'queued', version: pending.version }
    return {
      status:
        state.status === 'restarting'
          ? 'installing'
          : state.status === 'available'
            ? 'idle'
            : state.status,
      version: state.version,
      progress: state.progress,
      transferred: state.transferred,
      total: state.total,
      error: state.error,
    }
  }
  const server = createServer((request, response) => {
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? '')
    const expected = Buffer.from(token)
    const reply = (code: number, value: unknown) => {
      response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(value))
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reply(401, { error: 'Unauthorized' })
      return
    }
    if (request.method === 'GET' && request.url === '/status') {
      reply(200, status())
      return
    }
    if (request.method !== 'POST' || !['/download', '/restart'].includes(request.url ?? '')) {
      reply(404, { error: 'Unknown update action' })
      return
    }
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (part: string) => {
      raw += part
      if (raw.length > 1024) request.destroy()
    })
    request.on('end', () => {
      try {
        const input: unknown = JSON.parse(raw)
        if (
          !input ||
          typeof input !== 'object' ||
          !('version' in input) ||
          typeof input.version !== 'string' ||
          !/^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(input.version)
        ) {
          reply(400, { error: 'Invalid release version' })
          return
        }
        if (pending) {
          reply(409, { error: 'A desktop update is already running' })
          return
        }
        const action = request.url === '/restart' ? 'restart' : 'download'
        const version = input.version
        failure = undefined
        pending = { action, version }
        reply(202, { status: action === 'restart' ? 'installing' : 'queued', version })
        void updater
          .remote(action, version)
          .catch((cause: unknown) => {
            failure = { version, error: cause instanceof Error ? cause.message : String(cause) }
          })
          .finally(() => {
            pending = undefined
          })
      } catch {
        reply(400, { error: 'Invalid update request' })
      }
    })
  })
  server.requestTimeout = 5000
  await new Promise<void>((resolve, reject) => {
    server.on('error', (error) => console.error('Desktop update listener error', error))
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind desktop updater')
  try {
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = `${path}.${process.pid}.tmp`
      writeFileSync(
        temporary,
        JSON.stringify({
          pid: process.pid,
          port: address.port,
          token,
          version: updater.installedVersion,
        }),
        { mode: 0o600 },
      )
      renameSync(temporary, path)
    }
  } catch (error) {
    server.close()
    throw error
  }
  return async () => {
    try {
      for (const path of paths) {
        // Keep the shared installation record so the target remains visible during app restart.
        // Its dead PID disables commands until the next app publishes a fresh bridge.
        if (
          sharedDirectory &&
          path === join(sharedDirectory, 'desktop-update-host.json') &&
          sharedDirectory !== directory
        )
          continue
        try {
          const current: unknown = JSON.parse(readFileSync(path, 'utf8'))
          if (
            current &&
            typeof current === 'object' &&
            'token' in current &&
            current.token === token
          )
            unlinkSync(path)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }
}
