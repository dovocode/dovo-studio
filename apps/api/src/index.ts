import { readRuntimeEnvironment } from './runtime-environment.js'
import { Cause, Data, Effect, Exit } from 'effect'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { discoverNetworks, resolveBindHost } from './network.js'
import { publishConnection } from './connection.js'
import { RuntimeHost, runtimeLayer } from '@dovo/runtime'
import { acquireProcessLock } from './process-lock.js'
import { runtimeOwnerToken } from './owner-token.js'
import { knownToolDirectories, loginShellPath, mergePath } from './login-path.js'

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

// Agents are spawned by name (codex, claude, gh); resolve them like the user's terminal does.
if (process.env.DOVO_LOGIN_PATH !== 'off')
  process.env.PATH = mergePath(process.env.PATH, loginShellPath(), knownToolDirectories())

const waitForShutdown = Effect.async<void>((resume) => {
  const signals = ['SIGINT', 'SIGTERM', 'disconnect'] as const
  const cleanup = () => {
    for (const signal of signals) process.removeListener(signal, stop)
  }
  const stop = () => {
    cleanup()
    resume(Effect.void)
  }
  for (const signal of signals) process.once(signal, stop)
  return Effect.sync(cleanup)
})

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
    yield* Effect.gen(function* () {
      const runtime = yield* RuntimeHost
      const clientHost = ['0.0.0.0', '::'].includes(bindHost) ? '127.0.0.1' : bindHost
      const address = `http://${clientHost.includes(':') ? `[${clientHost}]` : clientHost}:${runtime.port}`
      yield* Effect.acquireRelease(
        attempt('publish connection', () =>
          publishConnection(directory, {
            address,
            token: ownerToken,
            pid: process.pid,
            bindHost,
          }),
        ),
        (remove) => Effect.sync(remove),
      )
      yield* Effect.sync(() => {
        console.log(`Dovo runtime listening on ${bindHost}:${runtime.port}`)
        process.send?.({ type: 'ready', port: runtime.port, address })
      })
      yield* waitForShutdown
    }).pipe(
      Effect.provide(
        runtimeLayer({
          databasePath,
          ownerToken,
          host: bindHost,
          port: Number(process.env.PORT ?? 8787),
        }),
      ),
    )
  }),
).pipe(
  Effect.ensuring(
    Effect.sync(() => {
      if (process.connected) process.disconnect?.()
    }),
  ),
)

const result = await Effect.runPromiseExit(program)
if (Exit.isFailure(result)) {
  console.error('Runtime failed', Cause.pretty(result.cause))
  process.exitCode = 1
}
