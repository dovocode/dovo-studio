import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { createHash } from 'node:crypto'
import { HttpError } from '../errors.js'
const compress = promisify(gzip)
const observers = new WeakMap<IncomingMessage, (value: unknown) => void>()
const workspaceFingerprints = new WeakMap<object, string>()
function snapshotTag(data: unknown) {
  if (!data || typeof data !== 'object' || !('workspace' in data)) return undefined
  const { workspace, ...state } = data
  if (!workspace || typeof workspace !== 'object') return undefined
  let fingerprint = workspaceFingerprints.get(workspace)
  if (!fingerprint) {
    fingerprint = createHash('sha256').update(JSON.stringify(workspace)).digest('base64url')
    workspaceFingerprints.set(workspace, fingerprint)
  }
  // WorkspaceStore replaces its workspace object on every change. The other, smaller
  // snapshot sections can change without a workspace revision (approvals, devices, etc.).
  const hash = createHash('sha256')
    .update(fingerprint)
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
export async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 8 * 1024 * 1024) throw new HttpError(413, 'Request is too large')
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
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
