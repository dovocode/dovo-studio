import { z } from 'zod'
import type { RuntimeConnection } from './runtime.js'
import { REPOSITORY_CLONE_TIMEOUT_MS } from './repositories.js'
import { snapshotResponseCache } from './snapshot-memory-cache.js'
export { clearRuntimeRequestCache } from './snapshot-memory-cache.js'
const snapshotTags = new WeakMap<object, string>()
export function getRuntimeSnapshotTag(snapshot: object) {
  return snapshotTags.get(snapshot)
}
function rememberSnapshotTag(value: unknown, tag: string | null | undefined) {
  if (tag && value && typeof value === 'object') snapshotTags.set(value, tag)
}
export async function runtimeRequest<T extends z.ZodType>(
  connection: RuntimeConnection | null,
  address: string,
  path: string,
  input: unknown,
  schema: T,
  method = 'POST',
  timeoutMs?: number,
): Promise<z.output<T>> {
  const target = new URL(path, address)
  const conditional =
    connection && method === 'GET' && path === '/api/snapshot' && input === undefined
      ? snapshotResponseCache(target.origin, connection.token)
      : undefined
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs ??
      (path === '/api/previews/simulator/open'
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
                  : 30000),
  )
  try {
    const send = (tag?: string) =>
      fetch(target, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(connection ? { Authorization: `Bearer ${connection.token}` } : {}),
          ...(tag ? { 'If-None-Match': tag } : {}),
        },
        ...(conditional ? { cache: 'no-store' as const } : {}),
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (controller.signal.aborted) throw error
        throw new Error(
          `Cannot reach ${target.host}. Check that its runtime is running and both devices are on the same Wi-Fi or VPN.`,
          { cause: error },
        )
      })
    let response = await send(conditional?.tag)
    if (response.status === 304) {
      if (!conditional) throw new Error('Runtime returned an unexpected unchanged response.')
      const cached = conditional?.body()
      if (cached !== undefined) {
        const parsed = schema.parse(JSON.parse(cached))
        rememberSnapshotTag(parsed, conditional.tag)
        return parsed
      }
      // A cache can be cleared or evicted while its conditional request is in flight.
      // One unconditional read recovers the body; never manufacture a snapshot from a 304.
      response = await send()
      if (response.status === 304)
        throw new Error(
          'Runtime returned an unchanged snapshot without a cached response. Reconnect and retry.',
        )
    }
    if (response.status === 401 || response.status === 403) conditional?.remove()
    const text = conditional ? await response.text() : undefined
    const value: unknown = text === undefined ? await response.json() : JSON.parse(text)
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(value)
      throw new Error(
        error.success ? error.data.error : `Runtime request failed (${response.status})`,
      )
    }
    const parsed = schema.parse(value)
    if (conditional && text !== undefined) {
      conditional.save(response.headers.get('etag'), text)
      rememberSnapshotTag(parsed, response.headers.get('etag'))
    }
    return parsed
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        `The runtime at ${target.host} took too long to respond. Check its connection before retrying.`,
        { cause: error },
      )
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
