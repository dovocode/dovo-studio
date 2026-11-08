import type { ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { BROWSER_DOWNLOAD_MAX_BYTES, STUDIO_BROWSER_SCOPE } from '@dovo/protocol'
import type { Services } from '../../services.js'
import type { PeerOrigin } from '../peer-connections.js'
import { hashSecret, newSecret } from '../../auth/devices.js'
import { HttpError } from '../../errors.js'

type Grant = { token: string; resourceId: string; taskId: string; id: string; expires: number }
const grants = new WeakMap<Services, Map<string, Grant>>()
export const browserDownloadPath = '/api/previews/browser/download/'
function entries(services: Services) {
  let result = grants.get(services)
  if (!result) {
    result = new Map()
    grants.set(services, result)
  }
  for (const [id, grant] of result) if (grant.expires <= Date.now()) result.delete(id)
  return result
}
/** Only an authenticated socket for this exact browser can mint a one-use file grant. */
export async function browserDownloadGrant(
  services: Services,
  token: string,
  resourceId: string,
  taskId: string,
  id: string,
  authorize: () => void,
) {
  authorize()
  const file = await services.browsers.download(resourceId, id)
  await file.handle.close()
  authorize()
  const store = entries(services)
  if (store.size >= 128)
    throw new HttpError(429, 'Too many browser download requests. Try again shortly.')
  const secret = newSecret()
  store.set(hashSecret(secret), { token, resourceId, taskId, id, expires: Date.now() + 30_000 })
  return { url: `${browserDownloadPath}${secret}`, name: file.name, size: file.size }
}
export async function serveBrowserDownload(
  services: Services,
  response: ServerResponse,
  url: URL,
  peer?: PeerOrigin,
) {
  const store = entries(services)
  const key = hashSecret(url.pathname.slice(browserDownloadPath.length))
  const grant = store.get(key)
  if (!grant) throw new HttpError(401, 'Browser download link expired. Choose Save again.')
  const authorize = () => {
    const device = services.devices.authenticate(grant.token)
    if (peer && (!peer.active || peer.deviceId !== device.id))
      throw new HttpError(403, 'This download belongs to another device.')
    if (grant.taskId !== STUDIO_BROWSER_SCOPE) services.store.taskSummary(grant.taskId)
  }
  authorize()
  store.delete(key)
  const file = await services.browsers.download(grant.resourceId, grant.id)
  let timer: ReturnType<typeof setInterval> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    authorize()
    if (!Number.isSafeInteger(file.size) || file.size < 0)
      throw new HttpError(409, 'This browser download changed.')
    if (file.size > BROWSER_DOWNLOAD_MAX_BYTES)
      throw new HttpError(413, 'Browser downloads support files up to 50 MB.')
    const name = Buffer.from(file.name, 'utf8').toString('utf8')
    const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': file.size,
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    if (file.size === 0) {
      response.end()
      return
    }
    // Revoke even an in-flight response; hidden or stalled clients cannot hold shutdown forever.
    timer = setInterval(() => {
      try {
        authorize()
        if (!file.current()) response.destroy()
      } catch {
        response.destroy()
      }
    }, 1000)
    timer.unref()
    deadline = setTimeout(() => response.destroy(), 5 * 60_000)
    deadline.unref()
    response.setTimeout(60_000, () => response.destroy())
    // Content-Length alone does not stop Node from sending bytes appended after validation.
    await pipeline(
      file.handle.createReadStream({ autoClose: false, start: 0, end: file.size - 1 }),
      response,
    )
  } finally {
    clearInterval(timer)
    clearTimeout(deadline)
    await file.handle.close()
  }
}
