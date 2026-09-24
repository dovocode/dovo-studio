import { Data, Effect, Either, Exit, Schema } from 'effect'
import { decodeResult, ValidationError } from './schema.js'
import type { RuntimeConnection } from './runtime.js'
import { REPOSITORY_CLONE_TIMEOUT_MS } from './repositories.js'
import { snapshotResponseCache } from './snapshot-memory-cache.js'
export { clearRuntimeRequestCache } from './snapshot-memory-cache.js'

export class RuntimeRequestError extends Data.TaggedError('RuntimeRequestError')<{
  readonly kind: 'connection' | 'timeout' | 'response' | 'request'
  readonly message: string
  readonly cause?: unknown
  readonly issues?: readonly { path: string; code: string; message: string }[]
  readonly status?: number
}> {}

const snapshotTags = new WeakMap<object, string>()
export function getRuntimeSnapshotTag(snapshot: object) {
  return snapshotTags.get(snapshot)
}
function rememberSnapshotTag(value: unknown, tag: string | null | undefined) {
  if (tag && value && typeof value === 'object') snapshotTags.set(value, tag)
}
function requestTimeout(path: string) {
  if (path === '/api/agents/acp/install') return 630000
  if (path === '/api/agents/acp/authenticate' || path === '/api/agents/acp/logout') return 330000
  if (path === '/api/agents/acp/inspect' || path.startsWith('/api/agents/acp/sessions'))
    return 65000
  return path === '/api/previews/simulator/open'
    ? 210000
    : path.startsWith('/api/previews/')
      ? 120000
      : path === '/api/tasks/title'
        ? 120000
        : path === '/api/tasks/dictation/cleanup'
          ? 40000
          : path === '/api/scm/repositories/add'
            ? REPOSITORY_CLONE_TIMEOUT_MS + 30000
            : path.startsWith('/api/scm/pulls/') ||
                path.startsWith('/api/scm/work/') ||
                path === '/api/scm/jira/bind'
              ? 180000
              : 30000
}

/** A single request; interruption aborts both the fetch and response body read. */
export function runtimeRequestEffect<T extends Schema.Schema.AnyNoContext>(
  connection: RuntimeConnection | null,
  address: string,
  path: string,
  input: unknown,
  schema: T,
  method = 'POST',
  timeoutMs?: number,
): Effect.Effect<Schema.Schema.Type<T>, RuntimeRequestError | ValidationError> {
  return Effect.gen(function* () {
    const target = yield* Effect.try({
      try: () => {
        const base = new URL(address)
        const target = new URL(path, base)
        if (
          !['http:', 'https:'].includes(base.protocol) ||
          target.origin !== base.origin ||
          target.username ||
          target.password
        )
          throw new Error('Runtime requests must stay on their configured origin')
        return target
      },
      catch: (cause) =>
        new RuntimeRequestError({ kind: 'request', message: 'Invalid runtime address.', cause }),
    })
    const body = yield* Effect.try({
      try: () => (input === undefined ? undefined : JSON.stringify(input)),
      catch: (cause) =>
        new RuntimeRequestError({
          kind: 'request',
          message: 'Cannot encode runtime request.',
          cause,
        }),
    })
    const conditional =
      connection && method === 'GET' && path === '/api/snapshot' && input === undefined
        ? snapshotResponseCache(target.origin, connection.token)
        : undefined
    const decodeResponse = (value: unknown) =>
      Effect.suspend(() => {
        const result = decodeResult(schema, value)
        return result.success ? Effect.succeed(result.data) : Effect.fail(result.error)
      })
    const parseJson = (text: string) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (cause) =>
          new RuntimeRequestError({
            kind: 'response',
            message: 'Runtime returned invalid JSON.',
            cause,
          }),
      })
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const controller = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller, exit) =>
            Effect.sync(() => {
              if (Exit.isInterrupted(exit)) controller.abort()
            }),
        )
        const send = (tag?: string) =>
          Effect.tryPromise({
            try: () =>
              fetch(target, {
                redirect: 'error',
                method,
                headers: {
                  'Content-Type': 'application/json',
                  ...(connection ? { Authorization: `Bearer ${connection.token}` } : {}),
                  ...(tag ? { 'If-None-Match': tag } : {}),
                },
                ...(conditional ? { cache: 'no-store' as const } : {}),
                ...(body === undefined ? {} : { body }),
                signal: controller.signal,
              }),
            catch: (cause) =>
              new RuntimeRequestError({
                kind: 'connection',
                cause,
                message: `Cannot reach ${target.host}. Check that its runtime is running and both devices are on the same Wi-Fi or VPN.`,
              }),
          })
        let response = yield* send(conditional?.tag)
        if (response.status === 304) {
          if (!conditional)
            return yield* Effect.fail(
              new RuntimeRequestError({
                kind: 'response',
                message: 'Runtime returned an unexpected unchanged response.',
              }),
            )
          const cached = conditional.body()
          if (cached !== undefined) {
            const parsed = yield* decodeResponse(yield* parseJson(cached))
            rememberSnapshotTag(parsed, conditional.tag)
            return parsed
          }
          // Recover an evicted cache with one unconditional read; mutations are never retried.
          response = yield* send()
          if (response.status === 304)
            return yield* Effect.fail(
              new RuntimeRequestError({
                kind: 'response',
                message:
                  'Runtime returned an unchanged snapshot without a cached response. Reconnect and retry.',
              }),
            )
        }
        if (response.status === 401 || response.status === 403) conditional?.remove()
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) =>
            new RuntimeRequestError({
              kind: 'response',
              message: 'Cannot read runtime response.',
              cause,
            }),
        })
        const value = yield* parseJson(text)
        if (!response.ok) {
          const error = decodeResult(
            Schema.Struct({
              error: Schema.String,
              issues: Schema.optional(
                Schema.Array(
                  Schema.Struct({
                    path: Schema.String,
                    code: Schema.String,
                    message: Schema.String,
                  }),
                ),
              ),
            }),
            value,
          )
          return yield* Effect.fail(
            new RuntimeRequestError({
              kind: 'response',
              issues: error.success ? error.data.issues : undefined,
              status: response.status,
              message: error.success
                ? error.data.error
                : `Runtime request failed (${response.status})`,
            }),
          )
        }
        const parsed = yield* decodeResponse(value)
        if (conditional) {
          conditional.save(response.headers.get('etag'), text)
          rememberSnapshotTag(parsed, response.headers.get('etag'))
        }
        return parsed
      }),
    ).pipe(
      Effect.timeoutFail({
        duration: timeoutMs ?? requestTimeout(path),
        onTimeout: () =>
          new RuntimeRequestError({
            kind: 'timeout',
            message: `The runtime at ${target.host} took too long to respond. Check its connection before retrying.`,
          }),
      }),
    )
  })
}

/** Promise boundary for framework callbacks and clients outside the Effect runtime. */
export async function runtimeRequest<T extends Schema.Schema.AnyNoContext>(
  connection: RuntimeConnection | null,
  address: string,
  path: string,
  input: unknown,
  schema: T,
  method = 'POST',
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<Schema.Schema.Type<T>> {
  const result = await Effect.runPromise(
    Effect.either(
      runtimeRequestEffect(connection, address, path, input, schema, method, timeoutMs),
    ),
    { signal },
  )
  if (Either.isLeft(result)) throw result.left
  return result.right
}
