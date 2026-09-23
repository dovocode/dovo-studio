import { Context, Data, Effect, Layer, ManagedRuntime } from 'effect'
import { openDatabase } from './storage/database.js'
import { createServices, type Services } from './services.js'
import { createRuntimeServer } from './http/server.js'
export { backupRuntimeDatabase } from './storage/backup.js'
export { checkAdapterUpdates, type AdapterDiagnostic } from './agents/diagnostics.js'

export interface RuntimeOptions {
  databasePath: string
  ownerToken: string
  host?: string
  port?: number
}
export class RuntimeStartupError extends Data.TaggedError('RuntimeStartupError')<{
  readonly operation: string
  readonly cause: unknown
}> {
  get message() {
    return `Runtime ${this.operation} failed: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`
  }
}
export class RuntimeHost extends Context.Tag('dovo/RuntimeHost')<
  RuntimeHost,
  {
    readonly services: Services
    readonly port: number
  }
>() {}

const release = (close: () => void | Promise<void>) =>
  Effect.promise(async () => {
    await close()
  })

/** The host scope owns SQLite, accepted HTTP work, schedulers and native resources. */
export const runtimeLayer = (options: RuntimeOptions) =>
  Layer.scoped(
    RuntimeHost,
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openDatabase(options.databasePath),
          catch: (cause) =>
            new RuntimeStartupError({ operation: 'database initialization', cause }),
        }),
        (db) => Effect.sync(() => db.close()),
      )
      const services = yield* Effect.try({
        try: () => createServices(db, options.ownerToken),
        catch: (cause) => new RuntimeStartupError({ operation: 'service initialization', cause }),
      })
      // Scope runs every finalizer even if one fails. Register in dependency order so
      // dependants stop first and SQLite remains available through the final flush.
      let titlesClosing: Promise<void> | undefined
      let tasksClosing: Promise<void> | undefined
      const closeTitles = () => (titlesClosing ??= services.titles.dispose())
      const closeTasks = () => (tasksClosing ??= services.tasks.dispose())
      const finalizers = [
        closeTitles,
        closeTasks,
        () => services.agents.dispose(),
        () => services.attachments.dispose(),
        () => services.liveActivities.dispose(),
        () => services.liveActivities.flush(),
        () => services.simulators.dispose(),
        () => services.browsers.dispose(),
        () => services.terminals.dispose(),
        () => services.questions.dispose(),
        () => services.approvals.dispose(),
        () => services.pullCache.dispose(),
      ]
      for (const close of finalizers) yield* Effect.addFinalizer(() => release(close))
      const http = yield* Effect.acquireRelease(
        Effect.try({
          try: () => createRuntimeServer(services),
          catch: (cause) => new RuntimeStartupError({ operation: 'HTTP initialization', cause }),
        }),
        (http) =>
          Effect.gen(function* () {
            // Stop admission and cancel owned workers while accepted requests drain.
            // Waiting for HTTP first deadlocks requests awaiting those workers.
            // Capture exits so all drains finish before dependencies and SQLite close.
            const results = yield* Effect.all(
              [
                Effect.exit(
                  release(() => (http.server.listening ? http.close() : http.closeSockets())),
                ),
                Effect.exit(release(() => services.jobs.shutdown())),
                Effect.exit(release(closeTitles)),
                Effect.exit(release(closeTasks)),
              ],
              { concurrency: 'unbounded' },
            )
            for (const result of results) yield* result
          }),
      )
      yield* Effect.async<void, RuntimeStartupError>((resume) => {
        const cleanup = () => {
          http.server.removeListener('error', error)
          http.server.removeListener('listening', listening)
        }
        const error = (cause: Error) => {
          cleanup()
          resume(Effect.fail(new RuntimeStartupError({ operation: 'listen', cause })))
        }
        const listening = () => {
          cleanup()
          resume(Effect.void)
        }
        http.server.once('error', error)
        http.server.once('listening', listening)
        http.server.listen(options.port ?? 8787, options.host ?? '127.0.0.1')
        return Effect.sync(cleanup)
      })
      const address = http.server.address()
      if (!address || typeof address === 'string')
        return yield* Effect.fail(
          new RuntimeStartupError({
            operation: 'listen',
            cause: new Error('Runtime failed to listen'),
          }),
        )
      yield* Effect.sync(() => {
        services.tasks.continueAfterRestart(
          () => services.preferences.get().autoContinueAfterRestart,
          (id) => services.jobs.ownsTask(id),
        )
        services.liveActivities.start()
        services.jobs.startScheduler()
        services.pullCache.start()
      })
      return { services, port: address.port }
    }),
  )

/** Native/application entry boundary; callers can instead provide runtimeLayer. */
export async function startRuntime(options: RuntimeOptions): Promise<{
  services: Services
  port: number
  close: () => Promise<void>
}> {
  const runtime = ManagedRuntime.make(runtimeLayer(options))
  try {
    const host = await runtime.runPromise(RuntimeHost)
    return { ...host, close: () => runtime.dispose() }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
export { acquireProcessLock } from './storage/process-lock.js'
