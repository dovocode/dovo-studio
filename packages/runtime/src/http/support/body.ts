import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { createHash } from 'node:crypto'
import { HttpError } from '../../errors.js'
const compress = promisify(gzip)
const cachedBodies = new WeakMap<IncomingMessage, { size: number; value: unknown }>()
const observers = new WeakMap<IncomingMessage, (value: unknown) => void>()
// WorkspaceStore replaces changed objects. Weak keys reuse large task fields and workspace
// collections without retaining them. Hash a new collection in one pass: a separate digest
// for every small message made cold history loads slower in the benchmark.
const contentFingerprints = new WeakMap<object, string>()
const taskFingerprints = new WeakMap<object, string>()
const workspaceFingerprints = new WeakMap<object, string>()
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('base64url')
function contentFingerprint(value: object) {
  let result = contentFingerprints.get(value)
  if (!result) {
    result = digest(value)
    contentFingerprints.set(value, result)
  }
  return result
}
// Keep scalar and digest domains separate, including user strings that resemble digests.
const member = (value: unknown) =>
  value !== null && typeof value === 'object'
    ? ['digest', contentFingerprint(value)]
    : ['value', value]
const entries = (value: object) => Object.entries(value).filter(([, item]) => item !== undefined)
function taskFingerprint(task: object) {
  let result = taskFingerprints.get(task)
  if (!result) {
    result = digest(entries(task).map(([key, value]) => [key, member(value)]))
    taskFingerprints.set(task, result)
  }
  return result
}
function workspaceFingerprint(workspace: object) {
  let result = workspaceFingerprints.get(workspace)
  if (!result) {
    result = digest(
      entries(workspace).map(([key, value]) => [
        key,
        key === 'tasks' && Array.isArray(value)
          ? [
              'tasks',
              value.map((task: unknown) =>
                task && typeof task === 'object'
                  ? ['digest', taskFingerprint(task)]
                  : ['value', task],
              ),
            ]
          : member(value),
      ]),
    )
    workspaceFingerprints.set(workspace, result)
  }
  return result
}
export function snapshotTag(data: unknown) {
  if (!data || typeof data !== 'object' || !('workspace' in data)) return undefined
  const { workspace, ...state } = data
  if (!workspace || typeof workspace !== 'object') return undefined
  // The smaller runtime state can change independently of the workspace revision.
  const hash = createHash('sha256')
    .update('snapshot-digests:')
    .update(workspaceFingerprint(workspace))
    .update(JSON.stringify(state))
    .digest('base64url')
  return `W/"snapshot-${hash}"`
}
function matchesTag(header: string | undefined, tag: string) {
  return (header ?? '').split(',').some((value) => {
    const candidate = value.trim()
    return candidate === '*' || candidate.replace(/^W\//, '') === tag.replace(/^W\//, '')
  })
}
export function observeBody(request: IncomingMessage, callback: (value: unknown) => void) {
  observers.set(request, callback)
}
export async function body(request: IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  const cached = cachedBodies.get(request)
  if (cached) {
    if (cached.size > limit) throw new HttpError(413, 'Request is too large')
    observers.get(request)?.(cached.value)
    return cached.value
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new HttpError(413, 'Request is too large')
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
  cachedBodies.set(request, { size, value })
  observers.get(request)?.(value)
  return value
}
function acceptsGzip(header: string | undefined) {
  const encodings = (header ?? '').split(',').map((entry) => {
    const [encoding, ...parameters] = entry.trim().toLowerCase().split(';')
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='))
    return {
      encoding,
      quality: quality ? Number(quality.trim().slice(2)) : 1,
    }
  })
  const encoding =
    encodings.find((entry) => entry.encoding === 'gzip') ??
    encodings.find((entry) => entry.encoding === '*')
  return !!encoding && encoding.quality > 0 && encoding.quality <= 1
}
export async function json(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  data: unknown,
) {
  const tag =
    status === 200 &&
    request.method === 'GET' &&
    new URL(request.url ?? '/', 'http://runtime.local').pathname === '/api/snapshot'
      ? snapshotTag(data)
      : undefined
  if (tag && matchesTag(request.headers['if-none-match'], tag)) {
    response.writeHead(304, {
      etag: tag,
      'cache-control': 'no-store',
      vary: 'Accept-Encoding',
    })
    response.end()
    return
  }
  const plain = Buffer.from(JSON.stringify(data))
  // Native fetch and browsers decode gzip automatically. Large thread histories otherwise
  // consume megabytes on every refresh, especially painful over a phone's VPN connection.
  const compressed = plain.length >= 2048 && acceptsGzip(request.headers['accept-encoding'])
  const payload = compressed
    ? await compress(plain, {
        level: 4,
      })
    : plain
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'Accept-Encoding',
    'content-length': payload.length,
    ...(tag
      ? {
          etag: tag,
        }
      : {}),
    ...(compressed
      ? {
          'content-encoding': 'gzip',
        }
      : {}),
  })
  response.end(payload)
}
