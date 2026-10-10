import { readRuntimeEnvironment } from './runtime-environment.js'
import { Cause, Data, Effect, Exit } from 'effect'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { discoverNetworks, resolveBindHost } from './network.js'
import { publishConnection } from './connection.js'
import { writeListenAddress } from './listen-address.js'
import { RuntimeHost, runtimeLayer, initializeAgentDefaults, recordLastCrash } from '@dovo/runtime'
import { shutdownSignal } from './shutdown-signal.js'
import { acquireProcessLock } from './process-lock.js'
import { runtimeOwnerToken } from './owner-token.js'
import { knownToolDirectories, loginShellPath, mergePath } from './login-path.js'

if (!process.env.DOVO_RELEASE_VERSION) {
  try {
    process.env.DOVO_RELEASE_VERSION = readFileSync(
      new URL('../../../VERSION', import.meta.url),
      'utf8',
    ).trim()
  } catch {
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
      )
      if (
        manifest &&
        typeof manifest === 'object' &&
        'version' in manifest &&
        typeof manifest.version === 'string'
      )
        process.env.DOVO_RELEASE_VERSION = manifest.version
    } catch {
      // A custom launcher may not bundle release metadata.
    }
  }
}

class RuntimeProcessError extends Data.TaggedError('RuntimeProcessError')<{
  readonly operation: string
  readonly cause: unknown
}> {
  // Without this, startup failures log only "An error has occurred".
  override get message() {
    return `Could not ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`
  }
}
const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new RuntimeProcessError({ operation, cause }),
  })

// One stray rejected promise (for example, a pipe to an agent that just exited) must not end
// every task and phone connection on this computer. Synchronous uncaught exceptions still exit.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in the Dovo runtime', reason)
})
// A synchronous throw ends the process. Record why next to the database so the next start can
// show it in Devices & runtime, then exit non-zero so supervisors restart the runtime.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in the Dovo runtime', error)
  try {
    const databasePath = process.env.DOVO_DATABASE_PATH
    if (databasePath) recordLastCrash(databasePath, error)
  } catch {
    // The crash record is best effort; exiting is not.
  }
  process.exit(1)
})

// Agents are spawned by name (codex, claude, gh); resolve them like the user's terminal does.
const shutdown = shutdownSignal(process)
if (process.env.DOVO_LOGIN_PATH !== 'off')
  process.env.PATH = mergePath(process.env.PATH, loginShellPath(), knownToolDirectories())

const program = Effect.scoped(
  Effect.gen(function* () {
    if (process.env.DOVO_RUNTIME_ENV_FILE) {
      const path = process.env.DOVO_RUNTIME_ENV_FILE
      yield* attempt('load runtime environment', () =>
        Object.assign(process.env, readRuntimeEnvironment(path)),
      )
    }
    const databasePath =
      process.env.DOVO_DATABASE_PATH ?? join(homedir(), '.dovo', 'runtime.sqlite')
    process.env.DOVO_DATABASE_PATH = databasePath
    const directory = dirname(databasePath)
    yield* attempt('create data directory', () =>
      mkdirSync(directory, { recursive: true, mode: 0o700 }),
    )
    yield* Effect.acquireRelease(
      attempt('acquire process lock', () => {
        const release = acquireProcessLock(join(directory, 'runtime-process.lock'))
        process.once('exit', release)
        return release
      }),
      (release) =>
        Effect.sync(() => {
          process.removeListener('exit', release)
          release()
        }),
    )
    const ownerToken = yield* attempt('load owner credential', () =>
      runtimeOwnerToken(directory, process.env.DOVO_OWNER_TOKEN),
    )
    const requestedHost = process.env.DOVO_HOST ?? '127.0.0.1'
    const networks = ['local', 'tailscale', 'netbird'].includes(requestedHost)
      ? yield* Effect.tryPromise({
          try: discoverNetworks,
          catch: (cause) => new RuntimeProcessError({ operation: 'discover networks', cause }),
        })
      : []
    const bindHost = yield* attempt('resolve bind address', () =>
      resolveBindHost(requestedHost, networks),
    )
    const desktopDualListener = process.env.DOVO_DESKTOP_DUAL_LISTENER === '1'
    const externalPort = Number(process.env.PORT ?? 8787)
    yield* Effect.gen(function* () {
      const runtime = yield* RuntimeHost
      yield* Effect.tryPromise({
        try: () => initializeAgentDefaults(runtime.services),
        catch: (cause) =>
          new RuntimeProcessError({ operation: 'initialize agent defaults', cause }),
      })
      const clientHost =
        desktopDualListener || ['0.0.0.0', '::'].includes(bindHost) ? '127.0.0.1' : bindHost
      const address = `http://${clientHost.includes(':') ? `[${clientHost}]` : clientHost}:${runtime.port}`
      yield* Effect.acquireRelease(
        attempt('publish connection', () =>
          publishConnection(directory, {
            address,
            token: ownerToken,
            pid: process.pid,
            bindHost: desktopDualListener ? '127.0.0.1' : bindHost,
          }),
        ),
        (remove) => Effect.sync(remove),
      )
      yield* Effect.sync(() => {
        if (desktopDualListener)
          writeListenAddress(join(directory, 'runtime-listen.json'), {
            address: `http://127.0.0.1:${externalPort}`,
            bindHost,
          })
        console.log(`Dovo runtime listening on ${clientHost}:${runtime.port}`)
        process.send?.({ type: 'ready', port: runtime.port, address })
      })
      yield* Effect.never
    }).pipe(
      Effect.provide(
        runtimeLayer({
          databasePath,
          ownerToken,
          host: desktopDualListener ? '127.0.0.1' : bindHost,
          port: desktopDualListener ? 0 : externalPort,
          ...(desktopDualListener
            ? {
                external: {
                  host: bindHost,
                  port: externalPort,
                  enabled: !['127.0.0.1', 'localhost', '::1'].includes(bindHost),
                },
              }
            : {}),
        }),
      ),
    )
  }),
).pipe(
  Effect.ensuring(
    Effect.sync(() => {
      shutdown.dispose()
      if (process.connected) process.disconnect?.()
    }),
  ),
)

const result = await Effect.runPromiseExit(program, { signal: shutdown.signal })
if (Exit.isFailure(result) && !Cause.hasInterruptsOnly(result.cause)) {
  console.error('Runtime failed', Cause.pretty(result.cause))
  process.exitCode = 1
}
