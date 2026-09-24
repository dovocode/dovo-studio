import {
  runtimeRequest,
  runtimeRestartSchema,
  responses,
  RUNTIME_PROTOCOL_VERSION,
} from '@dovo/protocol'
import { homedir } from 'node:os'
import { ensureBackgroundRuntime, stopBackgroundRuntimeForUpdate } from './background-runtime.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { Effect, Exit, Scope } from 'effect'
import { readConnection } from '../../api/src/connection.js'
import { runtimeOwnerToken } from '../../api/src/owner-token.js'
type Connection = {
  address: string
  token: string
}
const lifecycle = Effect.runSync(Effect.makeSemaphore(1))
let updateOwner: symbol | undefined
let networkPort: string | undefined
let owned:
  | {
      child: ChildProcess
      scope: Scope.CloseableScope
      connection: Connection
    }
  | undefined
const failure = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)))
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null
class RuntimeCompatibilityError extends Error {}
const existingRuntime = (requireCompatible = true) =>
  Effect.gen(function* () {
    const saved = yield* Effect.try({
      try: () => {
        try {
          return readConnection(join(app.getPath('userData'), 'runtime-connection.json'))
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
          throw error
        }
      },
      catch: failure,
    })
    if (!saved) return undefined
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(saved.address + '/api/snapshot', {
          headers: {
            Authorization: `Bearer ${saved.token}`,
          },
          redirect: 'error',
          signal,
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
        if (
          requireCompatible &&
          (!('protocolVersion' in snapshot) ||
            snapshot.protocolVersion !== RUNTIME_PROTOCOL_VERSION)
        )
          throw new RuntimeCompatibilityError(
            'The running runtime is incompatible with this desktop build. Update or restart its background service before reconnecting.',
          )
        return {
          address: saved.address,
          token: saved.token,
        }
      },
      catch: failure,
    }).pipe(
      Effect.timeoutFail({
        duration: '3 seconds',
        onTimeout: () => new Error('Runtime health check timed out'),
      }),
      Effect.catchAll((cause) =>
        cause instanceof RuntimeCompatibilityError
          ? Effect.fail(cause)
          : Effect.try({
              try: () => {
                try {
                  process.kill(saved.pid, 0)
                } catch (error) {
                  if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
                    return undefined
                  throw error
                }
                throw new Error(
                  `A runtime is already running for this workspace (process ${saved.pid}) but cannot be reached at ${saved.address}. Check its server log before starting another runtime.`,
                  {
                    cause,
                  },
                )
              },
              catch: failure,
            }),
      ),
    )
  })

// Subscribe before signalling so a fast exit cannot be missed. Interruption removes the listener.
function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  return Effect.async<void, Error>((resume) => {
    if (exited(child) || child.pid === undefined) {
      resume(Effect.void)
      return
    }
    const done = () => resume(Effect.void)
    child.once('exit', done)
    try {
      child.kill(signal)
    } catch (error) {
      child.removeListener('exit', done)
      resume(Effect.fail(failure(error)))
    }
    return Effect.sync(() => child.removeListener('exit', done))
  })
}
function stopChild(child: ChildProcess) {
  return terminate(child, 'SIGTERM').pipe(
    Effect.interruptible,
    Effect.timeoutFail({
      duration: '5 seconds',
      onTimeout: () => new Error('Runtime did not stop gracefully'),
    }),
    Effect.catchAll(() =>
      terminate(child, 'SIGKILL').pipe(
        Effect.interruptible,
        Effect.timeoutFail({
          duration: '5 seconds',
          onTimeout: () => new Error('Runtime did not exit after SIGKILL'),
        }),
      ),
    ),
    // A failed finalizer must remain visible, and must not allow another process over the database.
    Effect.orDie,
  )
}
const runtimeOptions = () =>
  Effect.try({
    try: () => {
      const token = runtimeOwnerToken(app.getPath('userData'), process.env.DOVO_OWNER_TOKEN)
      const listenPath = join(app.getPath('userData'), 'runtime-listen.json')
      let saved:
        | {
            port: string
            host: string
          }
        | undefined
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
        PORT: networkPort ?? process.env.DOVO_PORT ?? saved?.port ?? '8787',
        DOVO_HOST: process.env.DOVO_HOST ?? saved?.host ?? '127.0.0.1',
      }
      delete env.ELECTRON_RUN_AS_NODE
      return {
        token,
        listenPath,
        env,
      }
    },
    catch: failure,
  })

function launch(directory: string) {
  return Effect.gen(function* () {
    const options = yield* runtimeOptions()
    const { token, listenPath, env } = options
    let cleanupProcess = () => {}
    yield* Effect.addFinalizer(() => Effect.sync(() => cleanupProcess()))
    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          spawn(
            app.isPackaged
              ? join(
                  process.resourcesPath,
                  'runtime/bin',
                  process.platform === 'win32' ? 'node.exe' : 'node',
                )
              : (process.env.DOVO_NODE_PATH ?? 'node'),
            [
              app.isPackaged
                ? join(process.resourcesPath, 'runtime/dist/index.js')
                : join(directory, '../../api/dist/index.js'),
            ],
            {
              env,
              stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            },
          ),
        catch: failure,
      }),
      stopChild,
    )
    let diagnostics = ''
    const stdout = (data: Buffer) => console.log(String(data).trim())
    const stderr = (data: Buffer) => {
      diagnostics = (diagnostics + String(data)).slice(-4000)
    }
    const reportError = (error: Error) => console.error('Local runtime process error:', error)
    child.stdout?.on('data', stdout)
    child.stderr?.on('data', stderr)
    child.on('error', reportError)
    cleanupProcess = () => {
      child.stdout?.removeListener('data', stdout)
      child.stderr?.removeListener('data', stderr)
      child.removeListener('error', reportError)
    }
    let cleanup = () => {}
    const connection = yield* Effect.async<Connection, Error>((resume) => {
      const error = (cause: Error) => resume(Effect.fail(cause))
      const exit = (code: number | null, signal: NodeJS.Signals | null) =>
        resume(Effect.fail(new Error(`Local runtime exited (${signal ?? code}). ${diagnostics}`)))
      const message = (value: unknown) => {
        if (
          typeof value !== 'object' ||
          !value ||
          !('type' in value) ||
          value.type !== 'ready' ||
          !('port' in value) ||
          typeof value.port !== 'number'
        )
          return
        const port = value.port
        resume(
          Effect.try({
            try: () => {
              const host = ['0.0.0.0', '::'].includes(env.DOVO_HOST ?? '')
                ? '127.0.0.1'
                : env.DOVO_HOST
              const address =
                'address' in value && typeof value.address === 'string'
                  ? value.address
                  : `http://${host}:${port}`
              writeFileSync(
                listenPath + '.tmp',
                JSON.stringify({
                  address,
                  bindHost: env.DOVO_HOST,
                }),
                {
                  mode: 0o600,
                },
              )
              renameSync(listenPath + '.tmp', listenPath)
              return {
                address,
                token,
              }
            },
            catch: failure,
          }),
        )
      }
      child.once('error', error)
      child.once('exit', exit)
      child.on('message', message)
      cleanup = () => {
        child.removeListener('error', error)
        child.removeListener('exit', exit)
        child.removeListener('message', message)
      }
    }).pipe(
      Effect.timeoutFail({
        duration: '30 seconds',
        onTimeout: () => new Error('Local runtime did not start within 30 seconds'),
      }),
      Effect.ensuring(Effect.sync(() => cleanup())),
    )
    return {
      child,
      connection,
    }
  })
}
export function startLocalRuntime(
  directory: string,
  options: { allowIncompatible?: boolean } = {},
) {
  return Effect.runPromise(
    lifecycle.withPermits(1)(
      Effect.gen(function* () {
        if (updateOwner)
          return yield* Effect.fail(
            new Error(
              'Runtime update is in progress. Wait for installation or recovery to finish.',
            ),
          )
        if (owned && !exited(owned.child)) return owned.connection
        if (owned) {
          yield* Scope.close(owned.scope, Exit.void)
          owned = undefined
        }
        // External servers belong to their supervisor. Re-read discovery after a service restart.
        const existing = yield* existingRuntime(!options.allowIncompatible)
        if (existing) return existing
        if (app.isPackaged && process.platform === 'darwin') {
          const { env } = yield* runtimeOptions()
          const uid = process.getuid?.()
          if (uid === undefined)
            return yield* Effect.fail(new Error('Cannot determine the Mac login session'))
          yield* ensureBackgroundRuntime({
            home: homedir(),
            uid,
            directory: app.getPath('userData'),
            node: join(process.resourcesPath, 'runtime/bin/node'),
            entrypoint: join(process.resourcesPath, 'runtime/dist/index.js'),
            host: env.DOVO_HOST ?? '127.0.0.1',
            port: env.PORT ?? '8787',
            ownerToken: process.env.DOVO_OWNER_TOKEN,
            environment: process.env,
            path: env.PATH ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
          })
          return yield* Effect.gen(function* () {
            while (true) {
              const connection = yield* existingRuntime(!options.allowIncompatible)
              if (connection) return connection
              yield* Effect.sleep(100)
            }
          }).pipe(
            Effect.timeoutFail({
              duration: '30 seconds',
              onTimeout: () =>
                new Error(
                  'Mac background runtime did not become ready. Check runtime-service.log.',
                ),
            }),
          )
        }
        const scope = yield* Scope.make()
        const result = yield* launch(directory).pipe(
          Scope.extend(scope),
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
        )
        owned = {
          ...result,
          scope,
        }
        return result.connection
      }),
    ),
  )
}
export function stopLocalRuntime() {
  return Effect.runPromise(
    lifecycle.withPermits(1)(
      Effect.gen(function* () {
        if (!owned) return
        yield* Scope.close(owned.scope, Exit.void)
        owned = undefined
      }),
    ),
  )
}

/** Updating the installed bundle also updates its supervised runtime, unlike ordinary Quit. */
export async function prepareLocalRuntimeUpdate(directory: string) {
  const owner = Symbol('runtime update')
  try {
    await Effect.runPromise(
      lifecycle.withPermits(1)(
        Effect.gen(function* () {
          if (updateOwner)
            return yield* Effect.fail(new Error('A runtime update is already in progress'))
          updateOwner = owner
          if (owned) {
            yield* Scope.close(owned.scope, Exit.void)
            owned = undefined
            return
          }
          const uid = process.getuid?.()
          if (!app.isPackaged || process.platform !== 'darwin' || uid === undefined)
            return yield* Effect.fail(
              new Error('Stop the externally managed runtime before updating desktop.'),
            )
          const connection = yield* Effect.try({
            try: () => readConnection(join(app.getPath('userData'), 'runtime-connection.json')),
            catch: failure,
          })
          yield* stopBackgroundRuntimeForUpdate(app.getPath('userData'), uid, connection.pid)
        }),
      ),
    )
  } catch (cause) {
    if (updateOwner !== owner) throw cause
    await Effect.runPromise(
      lifecycle.withPermits(1)(
        Effect.sync(() => {
          updateOwner = undefined
        }),
      ),
    )
    try {
      await startLocalRuntime(directory, { allowIncompatible: true })
    } catch (recovery) {
      throw new AggregateError([cause, recovery], 'Update preparation and runtime recovery failed')
    }
    throw cause
  }
  let recovery: Promise<void> | undefined
  return () =>
    (recovery ??= (async () => {
      await Effect.runPromise(
        lifecycle.withPermits(1)(
          Effect.sync(() => {
            if (updateOwner !== owner) throw new Error('Runtime update ownership changed')
            updateOwner = undefined
          }),
        ),
      )
      await startLocalRuntime(directory, { allowIncompatible: true })
    })())
}

/** Explicit desktop action; never silently widen a listener on ordinary startup. */
export async function localRuntimeNetwork(directory: string, address: string) {
  const local = await startLocalRuntime(directory)
  if (local.address !== address) return { local: false, host: '', canChange: false }
  const discovery = readConnection(join(app.getPath('userData'), 'runtime-connection.json'))
  return {
    local: true,
    host: discovery.bindHost ?? new URL(discovery.address).hostname,
    canChange:
      ['127.0.0.1', 'localhost'].includes(new URL(local.address).hostname) &&
      !process.env.DOVO_HOST &&
      (!!owned || (app.isPackaged && process.platform === 'darwin')),
  }
}
export async function setLocalRuntimeNetwork(directory: string, address: string, enabled: boolean) {
  const status = await localRuntimeNetwork(directory, address)
  if (!status.local || !status.canChange)
    throw new Error(
      'This listener is managed outside the desktop app. Change DOVO_HOST and restart it through its supervisor.',
    )
  const local = await startLocalRuntime(directory)
  // The runtime checks for workers and closes task admission in one synchronous step.
  const lease = await runtimeRequest(
    local,
    local.address,
    '/api/runtime/prepare-restart',
    {},
    runtimeRestartSchema,
  )
  const release = async () => {
    try {
      await runtimeRequest(
        local,
        local.address,
        '/api/runtime/cancel-restart',
        lease,
        responses.ok,
        'POST',
        3000,
      )
    } catch {
      /* Shutdown may have removed the listener; any unreleased lease expires after 60 seconds. */
    }
  }
  const path = join(app.getPath('userData'), 'runtime-listen.json')
  const previous = { address: local.address, bindHost: status.host }
  const save = (value: typeof previous) => {
    writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(path + '.tmp', path)
  }
  let restart: () => Promise<void>
  try {
    restart = await prepareLocalRuntimeUpdate(directory)
  } catch (error) {
    await release()
    throw error
  }
  networkPort = new URL(local.address).port || '80'
  try {
    save({ address: local.address, bindHost: enabled ? '0.0.0.0' : '127.0.0.1' })
    await restart()
  } catch (cause) {
    try {
      save(previous)
      try {
        await restart()
      } catch {
        await startLocalRuntime(directory)
      }
    } catch (recovery) {
      throw new AggregateError([cause, recovery], 'Network change and runtime recovery failed')
    }
    throw cause
  } finally {
    networkPort = undefined
    await release()
  }
  return localRuntimeNetwork(directory, address)
}
