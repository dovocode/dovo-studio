import { resolveRuntimeEndpoint, invalidateRuntimeRoute } from '../runtime/connection/routes.js'
import {
  isPeerAddress,
  resolvePeerTransport,
  PEER_CONNECTION_ERROR,
} from '../runtime/connection/peer.js'
import { Data, Effect, Result, Exit, Schedule, Schema } from 'effect'
import { decodeResult, ValidationError } from './schema.js'
import type { RuntimeConnection } from '../runtime/connection/runtime.js'
import { runtimeRequestTimeout } from './request-timeout.js'
import { runtimeUrl } from './runtime-url.js'
export { runtimeRequestTimeout } from './request-timeout.js'
import { snapshotResponseCache } from '../runtime/cache/snapshot-memory-cache.js'
export { clearRuntimeRequestCache } from '../runtime/cache/snapshot-memory-cache.js'

export class RuntimeRequestError extends Data.TaggedError('RuntimeRequestError')<{
  readonly kind: 'connection' | 'timeout' | 'response' | 'request'
  readonly message: string
  readonly cause?: unknown
  readonly issues?: readonly { path: string; code: string; message: string }[]
  readonly status?: number
  readonly mutationRejected?: true
  readonly mutationRetired?: true
}> {}

const snapshotTags = new WeakMap<object, string>()
export function getRuntimeSnapshotTag(snapshot: object) {
  return snapshotTags.get(snapshot)
}
export function setRuntimeSnapshotTag(value: object, tag: string) {
  rememberSnapshotTag(value, tag)
}
export function copyRuntimeSnapshotTag(source: object, target: object) {
  rememberSnapshotTag(target, getRuntimeSnapshotTag(source))
}
function rememberSnapshotTag(value: unknown, tag: string | null | undefined) {
  if (tag && value && typeof value === 'object') snapshotTags.set(value, tag)
}
// Proxies and VPN gateways (Tailscale, NetBird) report a briefly unreachable host this way.
const transientStatuses = new Set([502, 503, 504])
const isTransient = (error: RuntimeRequestError | ValidationError) =>
  error instanceof RuntimeRequestError &&
  (error.kind === 'connection' ||
    (error.status !== undefined && transientStatuses.has(error.status)))
// Wi-Fi roaming and reused keep-alive sockets drop single requests. Two quick retries
// absorb that blip instead of reporting a healthy host as offline or failing a message.
const readRetry = {
  schedule: Schedule.exponential(150).pipe(Schedule.jittered),
  times: 2,
  while: isTransient,
}

// The runtime deduplicates these by client message ID, so a replay cannot post twice.
const idempotentPaths = new Set(['/api/tasks/message', '/api/tasks/steer'])

// These POST endpoints only read state. Keep the list explicit: adding an action,
// task creation or provider write here could replay a side effect after a lost response.
const postReadPaths = new Set([
  '/api/tasks/commits/read',
  '/api/tasks/commits/changes',
  '/api/tasks/commits/file-preview',
  '/api/tasks/files/directory',
  '/api/tasks/files/search-content',
  '/api/tasks/files/search-paths',
  '/api/scm/source/identity',
  '/api/agents/models/cached',
  '/api/scm/pulls',
  '/api/scm/pulls/overview',
  '/api/scm/pulls/detail',
  '/api/scm/pulls/options/read',
  '/api/scm/work/options',
  '/api/scm/work/issues/list',
  '/api/scm/work/issues/detail',
  '/api/scm/work/pipelines/list',
  '/api/scm/work/pipelines/detail',
  '/api/scm/work/pipelines/definitions',
  '/api/scm/jira/projects/read',
  '/api/scm/connections/read',
  '/api/scm/connections/github/read',
  '/api/scm/cli-profiles/read',
  '/api/scm/repositories/forge/read',
  '/api/scm/repositories/forge/inspect',
  '/api/scm/repositories/github/read',
  '/api/scm/repositories/git-status',
  '/api/scm/directories/read',
  '/api/scm/open-targets',
  '/api/scm/instructions/read',
  '/api/scm/instructions/preview',
  '/api/scm/worktrees/read',
  '/api/scm/worktrees/choices',
  '/api/scm/action-state',
  '/api/scm/inspect',
  '/api/scm/changes',
  '/api/scm/branches',
  '/api/scm/branch-changes',
])
export type RuntimeRequestOptions = {
  mutationId?: string
  route?: 'http' | 'stream'
  /** Persist receipt ownership before a mutation can reach the transport. */
  beforeMutation?: (token: string | undefined) => Effect.Effect<void, RuntimeRequestError>
}

// A ticket's socket must use the transport that issued it, even if a background
// route check selects LAN while its response is in flight. Weak keys retain no tickets.
const responseAddresses = new WeakMap<object, string>()
export const runtimeResponseAddress = (value: object) => responseAddresses.get(value)

/** A single request; interruption aborts both the fetch and response body read.
 * GET and allowlisted POST reads and ID-deduplicated sends retry within the same deadline;
 * other mutations never retry. */
export function runtimeRequestEffect<T extends Schema.Codec<unknown, unknown>>(
  connection: RuntimeConnection | null,
  address: string,
  path: string,
  input: unknown,
  schema: T,
  method = 'POST',
  timeoutMs?: number,
  options?: RuntimeRequestOptions,
): Effect.Effect<T['Type'], RuntimeRequestError | ValidationError> {
  return Effect.gen(function* () {
    const target = yield* Effect.try({
      try: () => runtimeUrl(address, path),
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
    if (body !== undefined && ['GET', 'HEAD'].includes(method.toUpperCase()))
      return yield* Effect.fail(
        new RuntimeRequestError({
          kind: 'request',
          message: `Runtime ${method.toUpperCase()} requests cannot include a body.`,
        }),
      )
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
    // A receipt belongs to the device credential used for its first send. Retrying the
    // same action through a fallback credential would create a second receipt namespace.
    let mutationEndpoint: { address: string; token: string | undefined } | undefined
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const controller = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller, exit) =>
            Effect.sync(() => {
              if (Exit.hasInterrupts(exit)) controller.abort()
            }),
        )
        const endpoint =
          mutationEndpoint ??
          (connection && target.origin === new URL(connection.address).origin
            ? yield* Effect.tryPromise({
                try: () => resolveRuntimeEndpoint(connection, controller.signal, options?.route),
                catch: (cause) =>
                  new RuntimeRequestError({
                    kind: 'connection',
                    message:
                      cause instanceof Error ? cause.message : 'Cannot resolve runtime address.',
                    cause,
                  }),
              })
            : isPeerAddress(target.origin)
              ? yield* Effect.tryPromise({
                  try: () => resolvePeerTransport(target.origin, undefined, controller.signal),
                  catch: (cause) =>
                    new RuntimeRequestError({
                      kind: 'connection',
                      message: cause instanceof Error ? cause.message : PEER_CONNECTION_ERROR,
                      cause,
                    }),
                })
              : target.origin)
        const resolved = typeof endpoint === 'string' ? endpoint : endpoint.address
        const token = typeof endpoint === 'string' ? connection?.token : endpoint.token
        if (options?.mutationId && !mutationEndpoint) {
          if (options.beforeMutation) yield* options.beforeMutation(token)
          mutationEndpoint = { address: resolved, token }
        }
        const conditional =
          connection &&
          method === 'GET' &&
          target.pathname === '/api/snapshot' &&
          input === undefined
            ? snapshotResponseCache(target.origin, token ?? '', target.pathname + target.search)
            : undefined
        const transportTarget = new URL(resolved)
        transportTarget.pathname = target.pathname
        transportTarget.search = target.search
        const connectionError = (cause: unknown, message: string) => {
          // Cancellation is local to this operation. A late failure must not evict
          // a healthier route selected by another request in the meantime.
          if (connection && !controller.signal.aborted)
            invalidateRuntimeRoute(connection, options?.route, transportTarget.origin)
          return new RuntimeRequestError({ kind: 'connection', cause, message })
        }
        const send = (tag?: string) =>
          Effect.tryPromise({
            try: () =>
              fetch(transportTarget, {
                redirect: 'error',
                method,
                headers: {
                  'Content-Type': 'application/json',
                  ...(options?.mutationId ? { 'X-Dovo-Mutation-Id': options.mutationId } : {}),
                  ...(connection ? { Authorization: `Bearer ${token}` } : {}),
                  ...(tag ? { 'If-None-Match': tag } : {}),
                },
                ...(conditional ? { cache: 'no-store' as const } : {}),
                ...(body === undefined ? {} : { body }),
                signal: controller.signal,
              }),
            catch: (cause) =>
              connectionError(
                cause,
                isPeerAddress(target.origin)
                  ? PEER_CONNECTION_ERROR
                  : `Cannot reach ${target.host}. Check that its runtime is running and both devices are on the same Wi-Fi or VPN.`,
              ),
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
          const cached = conditional.value() ?? conditional.body()
          if (cached !== undefined) {
            const parsed = yield* decodeResponse(
              typeof cached === 'string' ? yield* parseJson(cached) : cached,
            )
            if (parsed !== null && typeof parsed === 'object') conditional.refresh(parsed)
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
            connectionError(cause, 'Connection lost while reading runtime response.'),
        })
        if (!response.ok) {
          // Gateways and a stopping runtime answer with plain text, not a JSON error body.
          const value = yield* Effect.orElseSucceed(parseJson(text), () => undefined)
          const error = decodeResult(
            Schema.Struct({
              error: Schema.String,
              mutationRejected: Schema.optional(Schema.Literal(true)),
              mutationRetired: Schema.optional(Schema.Literal(true)),
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
              mutationRejected: error.success ? error.data.mutationRejected : undefined,
              mutationRetired: error.success ? error.data.mutationRetired : undefined,
              status: response.status,
              message: error.success
                ? error.data.error
                : `Runtime request failed (${response.status})`,
            }),
          )
        }
        const parsed = yield* decodeResponse(yield* parseJson(text))
        if (parsed !== null && typeof parsed === 'object')
          responseAddresses.set(parsed, transportTarget.origin)
        if (conditional) {
          conditional.save(
            response.headers.get('etag'),
            text,
            parsed !== null && typeof parsed === 'object' ? parsed : undefined,
          )
          rememberSnapshotTag(parsed, response.headers.get('etag'))
        }
        return parsed
      }),
    ).pipe(
      (request) =>
        method.toUpperCase() === 'GET' ||
        (method.toUpperCase() === 'POST' && postReadPaths.has(target.pathname)) ||
        !!options?.mutationId ||
        idempotentPaths.has(path)
          ? Effect.retry(request, readRetry)
          : request,
      Effect.timeoutOrElse({
        duration:
          isPeerAddress(address) || !!connection?.internet
            ? Math.max(timeoutMs ?? runtimeRequestTimeout(path, input), 35000)
            : (timeoutMs ?? runtimeRequestTimeout(path, input)),
        orElse: () =>
          Effect.fail(
            (() =>
              new RuntimeRequestError({
                kind: 'timeout',
                message: `The runtime at ${target.host} took too long to respond. Check its connection before retrying.`,
              }))(),
          ),
      }),
    )
  })
}

/** Promise boundary for framework callbacks and clients outside the Effect runtime. */
export async function runtimeRequest<T extends Schema.Codec<unknown, unknown>>(
  connection: RuntimeConnection | null,
  address: string,
  path: string,
  input: unknown,
  schema: T,
  method = 'POST',
  timeoutMs?: number,
  signal?: AbortSignal,
  options?: RuntimeRequestOptions,
): Promise<T['Type']> {
  const result = await Effect.runPromise(
    Effect.result(
      runtimeRequestEffect(connection, address, path, input, schema, method, timeoutMs, options),
    ),
    { signal },
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success
}
