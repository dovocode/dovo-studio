import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { readConnection } from '../../api/src/connection.js'
import { runtimeOwnerToken } from '../../api/src/owner-token.js'
let processHandle: ChildProcess | undefined
let connection: Promise<{ address: string; token: string }> | undefined
async function existingRuntime() {
  let saved: ReturnType<typeof readConnection>
  try {
    saved = readConnection(join(app.getPath('userData'), 'runtime-connection.json'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  try {
    const response = await fetch(saved.address + '/api/snapshot', {
      headers: { Authorization: `Bearer ${saved.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const snapshot: unknown = await response.json()
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      !('owner' in snapshot) ||
      snapshot.owner !== true
    )
      throw new Error('Owner access is required')
    return { address: saved.address, token: saved.token }
  } catch {
    try {
      process.kill(saved.pid, 0)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return undefined
      throw error
    }
    throw new Error(
      `A runtime is already running for this workspace (process ${saved.pid}) but cannot be reached at ${saved.address}. Check its server log before starting another runtime.`,
    )
  }
}
export function startLocalRuntime(directory: string) {
  connection ??= (async () => {
    const existing = await existingRuntime()
    if (existing) return existing
    return new Promise<{ address: string; token: string }>((resolve, reject) => {
      const token = runtimeOwnerToken(app.getPath('userData'), process.env.DOVO_OWNER_TOKEN)
      const listenPath = join(app.getPath('userData'), 'runtime-listen.json')
      let saved: { port: string; host: string } | undefined
      for (const path of [listenPath, join(app.getPath('userData'), 'runtime-connection.json')]) {
        let value: unknown
        try {
          value = JSON.parse(readFileSync(path, 'utf8'))
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
          throw error
        }
        if (
          typeof value !== 'object' ||
          !value ||
          !('address' in value) ||
          typeof value.address !== 'string'
        )
          throw new Error('Invalid saved runtime listening address')
        const address = new URL(value.address)
        saved = {
          port: address.port || (address.protocol === 'https:' ? '443' : '80'),
          host:
            'bindHost' in value && typeof value.bindHost === 'string'
              ? value.bindHost
              : address.hostname,
        }
        break
      }
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DOVO_OWNER_TOKEN: token,
        DOVO_DATABASE_PATH: join(app.getPath('userData'), 'runtime.sqlite'),
        PORT: process.env.DOVO_PORT ?? saved?.port ?? '8787',
        DOVO_HOST: process.env.DOVO_HOST ?? saved?.host ?? '127.0.0.1',
      }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(
        app.isPackaged
          ? join(process.resourcesPath, 'runtime/bin/node')
          : (process.env.DOVO_NODE_PATH ?? 'node'),
        [
          app.isPackaged
            ? join(process.resourcesPath, 'runtime/dist/index.js')
            : join(directory, '../../api/dist/index.js'),
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
      )
      processHandle = child
      let diagnostics = ''
      child.stdout?.on('data', (data) => console.log(String(data).trim()))
      child.stderr?.on('data', (data) => {
        diagnostics = (diagnostics + String(data)).slice(-4000)
      })
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('Local runtime did not start within 30 seconds'))
      }, 30000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Local runtime exited (${code}). ${diagnostics}`))
        connection = undefined
      })
      child.on('message', (message) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'ready' &&
          'port' in message &&
          typeof message.port === 'number'
        ) {
          clearTimeout(timeout)
          const host = ['0.0.0.0', '::'].includes(env.DOVO_HOST ?? '') ? '127.0.0.1' : env.DOVO_HOST
          const address =
            'address' in message && typeof message.address === 'string'
              ? message.address
              : `http://${host}:${message.port}`
          try {
            writeFileSync(
              listenPath + '.tmp',
              JSON.stringify({ address, bindHost: env.DOVO_HOST }),
              {
                mode: 0o600,
              },
            )
            renameSync(listenPath + '.tmp', listenPath)
            resolve({ address, token })
          } catch (error) {
            child.kill()
            reject(error)
          }
        }
      })
    })
  })().catch((error) => {
    connection = undefined
    throw error
  })
  return connection
}
export async function stopLocalRuntime() {
  const child = processHandle
  if (!child || child.exitCode !== null) {
    connection = undefined
    return
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
  processHandle = undefined
  connection = undefined
}
