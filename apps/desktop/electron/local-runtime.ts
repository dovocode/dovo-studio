import { readListenAddress, writeListenAddress } from '@dovo/api/listen-address'
import { desktopRuntimeDirectory } from './runtime-data-directory.js'
import { runtimeRequest, RUNTIME_PROTOCOL_VERSION, mutableStruct } from '@dovo/protocol'
import { homedir } from 'node:os'
import { ensureBackgroundRuntime, stopBackgroundRuntimeForUpdate } from './background-runtime.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { Effect, Exit, Scope, Schema, Semaphore } from 'effect'
import { readConnection } from '@dovo/api/connection'
import { runtimeOwnerToken } from '@dovo/api/owner-token'
import {
  readWindowsRuntimeChoice,
  startWslRuntime,
  stopWslRuntime,
  wslRuntimeOwned,
  wslRuntimeConnection,
} from './windows-runtime.js'
type Connection = {
  address: string
  token: string
}
const lifecycle = Effect.runSync(Semaphore.make(1))
let updateOwner: symbol | undefined
let owned:
  | {
      child: ChildProcess
      scope: Scope.Closeable
      connection: Connection
      stopping?: boolean
    }
  | undefined
let relaunches = 0
let relaunchTimer: ReturnType<typeof setTimeout> | undefined
let relaunchAfter = 0
let quitting = false
const failure = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)))
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null
class RuntimeCompatibilityError extends Error {}
/** launchd restarts a runtime that fails at startup every few seconds. Name the reason from
 * its log instead of a generic timeout, so a busy port or stale lock can be acted on. */
function backgroundStartupFailure(port: string) {
  let tail = ''
  try {
    tail = readFileSync(join(desktopRuntimeDirectory(), 'runtime-service.log'), 'utf8').slice(-4000)
  } catch {
    /* No log yet: launchd has not started the runtime. */
  }
  const lines = tail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const reason = [...lines].reverse().find((line) => /fail|error|EADDRINUSE/i.test(line))
  if (/EADDRINUSE/.test(tail))
    return `The Mac background runtime cannot start because port ${port} is in use by another app. Quit that app, then reopen Dovo Studio.`
  return `The Mac background runtime did not become ready.${reason ? ` ${reason}` : ''} See runtime-service.log in the desktop data directory.`
}
const existingRuntime = (requireCompatible = true) =>
  Effect.gen(function* () {
    const saved = yield* Effect.try({
      try: () => {
        try {
          return readConnection(join(desktopRuntimeDirectory(), 'runtime-connection.json'))
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
      Effect.timeoutOrElse({
        duration: '3 seconds',
        orElse: () => Effect.fail((() => new Error('Runtime health check timed out'))()),
      }),
      Effect.catch((cause) =>
        cause instanceof RuntimeCompatibilityError
          ? Effect.fail(cause)
          : Effect.try({
              try: () => {
                try {
                  process.kill(saved.pid, 0)
                } catch (error) {
                  // ESRCH: gone. EPERM: after a reboot the recorded PID belongs to another
                  // user's process, never to this profile's runtime.
                  if (
                    error instanceof Error &&
                    'code' in error &&
                    (error.code === 'ESRCH' || error.code === 'EPERM')
                  )
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

// Windows has no SIGTERM: kill() there ends the process at once and no finalizer runs. The
// runtime treats a closed IPC channel as a shutdown request on every platform, so ask first.
function disconnect(child: ChildProcess) {
  return Effect.callback<void, Error>((resume) => {
    if (exited(child) || child.pid === undefined) {
      resume(Effect.void)
      return
    }
    if (!child.connected) {
      resume(Effect.fail(new Error('Runtime IPC channel is already closed')))
      return
    }
    const done = () => resume(Effect.void)
    child.once('exit', done)
    try {
      child.disconnect()
    } catch (error) {
      child.removeListener('exit', done)
      resume(Effect.fail(failure(error)))
    }
    return Effect.sync(() => child.removeListener('exit', done))
  })
}
// Subscribe before signalling so a fast exit cannot be missed. Interruption removes the listener.
function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  return Effect.callback<void, Error>((resume) => {
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
  return disconnect(child).pipe(
    Effect.interruptible,
    Effect.timeoutOrElse({
      duration: '5 seconds',
      orElse: () => Effect.fail((() => new Error('Runtime did not stop after disconnect'))()),
    }),
    Effect.catch(() =>
      terminate(child, 'SIGTERM').pipe(
        Effect.interruptible,
        Effect.timeoutOrElse({
          duration: '5 seconds',
          orElse: () => Effect.fail((() => new Error('Runtime did not stop gracefully'))()),
        }),
      ),
    ),
    Effect.catch(() =>
      terminate(child, 'SIGKILL').pipe(
        Effect.interruptible,
        Effect.timeoutOrElse({
          duration: '5 seconds',
          orElse: () => Effect.fail((() => new Error('Runtime did not exit after SIGKILL'))()),
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
      const token = runtimeOwnerToken(desktopRuntimeDirectory(), process.env.DOVO_OWNER_TOKEN)
      const listenPath = join(desktopRuntimeDirectory(), 'runtime-listen.json')
      let saved:
        | {
            port: string
            host: string
          }
        | undefined
      for (const path of [listenPath, join(desktopRuntimeDirectory(), 'runtime-connection.json')]) {
        try {
          const value = readListenAddress(path)
          saved = { port: String(value.port), host: value.host }
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
          throw error
        }
        break
      }
      const defaultPort = app.isPackaged ? '8787' : '8788'
      const savedPort =
        !app.isPackaged && (saved?.port === '8787' || saved?.port === '0') ? undefined : saved?.port
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DOVO_RELEASE_DISTRIBUTION: 'desktop',
        DOVO_DESKTOP_DUAL_LISTENER: '1',
        ...(app.isPackaged ? { DOVO_RELEASE_VERSION: app.getVersion() } : {}),
        DOVO_OWNER_TOKEN: token,
        DOVO_DATABASE_PATH: join(desktopRuntimeDirectory(), 'runtime.sqlite'),
        DOVO_SETTINGS_PATH: process.env.DOVO_SETTINGS_PATH,
        PORT:
          process.env.DOVO_PORT && process.env.DOVO_PORT !== '0'
            ? process.env.DOVO_PORT
            : (savedPort ?? process.env.DOVO_PORT ?? defaultPort),
        DOVO_HOST: process.env.DOVO_HOST ?? saved?.host ?? '127.0.0.1',
      }
      // Owned children get their credentials from this workspace, never an inherited supervisor file.
      delete env.DOVO_RUNTIME_ENV_FILE
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
              windowsHide: true,
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
    const startedAt = Date.now()
    // A runtime that dies after startup (native crash, OOM) is otherwise never noticed: the
    // renderer keeps retrying a dead address. Relaunch it on the same saved port, with a cap.
    const crashed = (code: number | null, signal: NodeJS.Signals | null) => {
      // Leave `owned` in place: startLocalRuntime sees the exited child and closes its scope.
      if (owned?.child !== child || owned.stopping || quitting) return
      const reason = `Local runtime exited (${signal ?? code}). ${diagnostics}`.trim()
      console.error(reason)
      // A runtime that stayed up for a while earned a fresh budget; one that dies at startup
      // backs off from two seconds to a minute so a bad port or lock does not spin.
      if (Date.now() - startedAt > 60_000) relaunches = 0
      if (relaunches >= 6) {
        relaunchAfter = Infinity
        console.error('Local runtime keeps exiting; not relaunching. Restart Dovo Studio.')
        void dialog.showMessageBox({
          type: 'error',
          title: app.getName(),
          message: 'The local runtime keeps stopping.',
          detail: `${reason.slice(-1500)}\n\nRestart Dovo Studio after fixing the cause. The runtime log in the data directory has the full output.`,
          buttons: ['OK'],
        })
        return
      }
      const delay = Math.min(60_000, 2_000 * 2 ** relaunches)
      relaunchAfter = Date.now() + delay
      relaunches++
      clearTimeout(relaunchTimer)
      relaunchTimer = setTimeout(() => {
        relaunchTimer = undefined
        if (quitting) return
        void startLocalRuntime(directory).catch((error: unknown) =>
          console.error('Local runtime relaunch failed:', error),
        )
      }, delay)
      relaunchTimer.unref()
    }
    child.stdout?.on('data', stdout)
    child.stderr?.on('data', stderr)
    child.on('error', reportError)
    child.on('exit', crashed)
    cleanupProcess = () => {
      child.stdout?.removeListener('data', stdout)
      child.stderr?.removeListener('data', stderr)
      child.removeListener('error', reportError)
      child.removeListener('exit', crashed)
    }
    let cleanup = () => {}
    const connection = yield* Effect.callback<Connection, Error>((resume) => {
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
              if (env.DOVO_DESKTOP_DUAL_LISTENER !== '1') {
                writeListenAddress(listenPath, { address, bindHost: env.DOVO_HOST })
              }
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
      Effect.timeoutOrElse({
        duration: '30 seconds',
        orElse: () =>
          Effect.fail((() => new Error('Local runtime did not start within 30 seconds'))()),
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
        if (quitting) return yield* Effect.fail(new Error('Dovo Studio is shutting down.'))
        if (updateOwner)
          return yield* Effect.fail(
            new Error(
              'Runtime update is in progress. Wait for installation or recovery to finish.',
            ),
          )
        if (process.platform === 'win32') {
          const choice = readWindowsRuntimeChoice()
          if (choice?.mode === 'wsl')
            return yield* Effect.tryPromise({
              try: () => startWslRuntime(choice.distribution),
              catch: failure,
            })
        }
        if (owned && !exited(owned.child)) return owned.connection
        if (Date.now() < relaunchAfter)
          return yield* Effect.fail(
            new Error(
              'Local runtime recovery is paused after a crash. Wait for automatic recovery or restart Dovo Studio.',
            ),
          )
        if (owned) {
          owned.stopping = true
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
            directory: desktopRuntimeDirectory(),
            node: join(process.resourcesPath, 'runtime/bin/node'),
            entrypoint: join(process.resourcesPath, 'runtime/dist/index.js'),
            host: env.DOVO_HOST ?? '127.0.0.1',
            port: env.PORT ?? '8787',
            ownerToken: process.env.DOVO_OWNER_TOKEN,
            environment: env,
            path: env.PATH ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
          })
          return yield* Effect.gen(function* () {
            while (true) {
              const connection = yield* existingRuntime(!options.allowIncompatible)
              if (connection) return connection
              yield* Effect.sleep(100)
            }
          }).pipe(
            Effect.timeoutOrElse({
              duration: '30 seconds',
              orElse: () =>
                Effect.fail((() => new Error(backgroundStartupFailure(env.PORT ?? '8787')))()),
            }),
          )
        }
        const scope = yield* Scope.make()
        const result = yield* launch(directory).pipe(
          Scope.provide(scope),
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
function stopOwnedRuntime() {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({ try: stopWslRuntime, catch: failure })
    if (!owned) return
    owned.stopping = true
    yield* Scope.close(owned.scope, Exit.void)
    owned = undefined
  })
}
/** Quit: stop the owned runtime and never relaunch it afterwards. */
export function stopLocalRuntime() {
  quitting = true
  clearTimeout(relaunchTimer)
  relaunchTimer = undefined
  return Effect.runPromise(lifecycle.withPermits(1)(stopOwnedRuntime()))
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
          if (wslRuntimeOwned()) {
            yield* Effect.tryPromise({ try: stopWslRuntime, catch: failure })
            return
          }
          if (owned) {
            owned.stopping = true
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
            try: () => readConnection(join(desktopRuntimeDirectory(), 'runtime-connection.json')),
            catch: failure,
          })
          yield* stopBackgroundRuntimeForUpdate(desktopRuntimeDirectory(), uid, connection.pid)
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
const externalStatusSchema = mutableStruct({
  enabled: Schema.Boolean,
  host: Schema.String,
  port: Schema.Number,
  error: Schema.optional(Schema.String),
})
export async function localRuntimeNetwork(directory: string, address: string) {
  const local = await startLocalRuntime(directory)
  if (local.address !== address) return { local: false, host: '', port: 0, canChange: false }
  const status = await runtimeRequest(
    local,
    local.address,
    '/api/runtime/network/read',
    {},
    externalStatusSchema,
  )
  return {
    local: true,
    host: status.enabled ? status.host : '127.0.0.1',
    port: status.port,
    error: status.error,
    canChange:
      !process.env.DOVO_HOST &&
      (!process.env.DOVO_PORT || process.env.DOVO_PORT === '0') &&
      (!!owned || wslRuntimeOwned() || (app.isPackaged && process.platform === 'darwin')),
  }
}

/** Switching environments stops only runtimes owned by this desktop. External servers stay intact. */
export function pauseLocalRuntime() {
  return Effect.runPromise(
    lifecycle.withPermits(1)(
      Effect.gen(function* () {
        const native = owned && !exited(owned.child) ? owned : undefined
        const connection = native?.connection ?? wslRuntimeConnection()
        if (connection) {
          const state = yield* Effect.tryPromise({
            try: () =>
              runtimeRequest(
                connection,
                connection.address,
                '/api/snapshot',
                undefined,
                mutableStruct({
                  workspace: mutableStruct({
                    tasks: Schema.Array(mutableStruct({ status: Schema.String })),
                  }),
                }),
                'GET',
              ),
            catch: failure,
          }).pipe(
            Effect.catch((cause) => {
              // A crash during this request has no live work to inspect. Never assume that a
              // still-running process is idle just because its HTTP listener is unreachable.
              if (native ? exited(native.child) : !wslRuntimeConnection())
                return Effect.succeed(undefined)
              return Effect.fail(
                new Error(
                  'Cannot check active work on the current runtime. Reconnect to it or stop it before switching execution environments.',
                  { cause },
                ),
              )
            }),
          )
          if (state?.workspace.tasks.some((task) => task.status === 'running'))
            return yield* Effect.fail(
              new Error('Finish or stop active runs before switching execution environments.'),
            )
        }
        quitting = true
        clearTimeout(relaunchTimer)
        relaunchTimer = undefined
        yield* stopOwnedRuntime()
        quitting = false
      }),
    ),
  )
}
export async function setLocalRuntimeNetwork(
  directory: string,
  address: string,
  enabled: boolean,
  port?: number,
) {
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('Choose a port between 1 and 65535')
  const status = await localRuntimeNetwork(directory, address)
  if (!status.local || !status.canChange)
    throw new Error(
      'This listener is managed outside the desktop app. Change DOVO_HOST and DOVO_PORT through its supervisor.',
    )
  const local = await startLocalRuntime(directory)
  const previous = await runtimeRequest(
    local,
    local.address,
    '/api/runtime/network/read',
    {},
    externalStatusSchema,
  )
  const next = await runtimeRequest(
    local,
    local.address,
    '/api/runtime/network/save',
    { enabled, host: '0.0.0.0', port: port ?? previous.port },
    externalStatusSchema,
  )
  // WSL persists its listener beside its Linux database. Never overwrite native Windows settings.
  if (process.platform === 'win32' && readWindowsRuntimeChoice()?.mode === 'wsl')
    return localRuntimeNetwork(directory, address)
  const path = join(desktopRuntimeDirectory(), 'runtime-listen.json')
  try {
    writeListenAddress(path, {
      address: `http://127.0.0.1:${next.port}`,
      bindHost: enabled ? next.host : '127.0.0.1',
    })
  } catch (cause) {
    try {
      await runtimeRequest(
        local,
        local.address,
        '/api/runtime/network/save',
        { enabled: previous.enabled, host: previous.host, port: previous.port },
        externalStatusSchema,
      )
    } catch (recovery) {
      throw new AggregateError([cause, recovery], 'Network change and runtime recovery failed')
    }
    throw cause
  }
  return localRuntimeNetwork(directory, address)
}
