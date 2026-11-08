import { once } from 'node:events'
import { appendFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BROWSER_DOWNLOAD_MAX_BYTES, STUDIO_BROWSER_SCOPE } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'
import { HttpError } from '../errors.js'
import { runtimeIntegration } from '../testing/integration.js'
import { browserDownloadGrant } from './endpoints/browser-downloads.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
async function fixture(contents = 'download body') {
  const directory = await mkdtemp(join(tmpdir(), 'http-download-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'file')
  await writeFile(path, contents)
  const token = 'download-device-token-with-at-least-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: `${token}-owner`,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  runtime.services.devices.add('Download test device', token)
  const download = vi.spyOn(runtime.services.browsers, 'download').mockImplementation(async () => ({
    handle: await open(path, 'r'),
    name: 'résumé"\r\n<script>.csv',
    size: Buffer.byteLength(contents),
    current: () => true,
  }))
  const authorize = vi.fn<() => void>(() => {
    runtime.services.devices.authenticate(token)
  })
  const grant = (resource = 'tab-a', id = 'file-a') =>
    browserDownloadGrant(runtime.services, token, resource, STUDIO_BROWSER_SCOPE, id, authorize)
  const get = (url: string) => fetch(`http://127.0.0.1:${runtime.port}${url}`)
  return { runtime, token, download, authorize, grant, get, path }
}

it.each(['', 'download body'])(
  'never sends bytes appended after validation, including an initially empty file (%j)',
  async (contents) => {
    const f = await fixture(contents)
    const grant = await f.grant()
    f.download.mockImplementationOnce(async () => {
      const handle = await open(f.path, 'r')
      const { size } = await handle.stat()
      // Simulate a writer growing the opened file just after the manager validates it.
      await appendFile(f.path, 'unexpected bytes')
      return { handle, name: 'report.csv', size, current: () => true }
    })
    // Read the raw response: fetch would hide bytes beyond Content-Length.
    const socket = createConnection({ host: '127.0.0.1', port: f.runtime.port })
    cleanups.push(async () => {
      socket.destroy()
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    const ended = once(socket, 'end')
    await once(socket, 'connect')
    socket.write(`GET ${grant.url} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    await ended
    const response = Buffer.concat(chunks).toString()
    expect(response).toMatch(/^HTTP\/1\.1 200 /)
    expect(response.slice(response.indexOf('\r\n\r\n') + 4)).toBe(contents)
  },
)

it('rejects an oversized file before writing response headers and closes its handle', async () => {
  const f = await fixture()
  const grant = await f.grant()
  const handle = await open(f.path, 'r+')
  await handle.truncate(BROWSER_DOWNLOAD_MAX_BYTES + 1)
  f.download.mockResolvedValueOnce({
    handle,
    name: 'too-large.bin',
    size: BROWSER_DOWNLOAD_MAX_BYTES + 1,
    current: () => true,
  })
  const response = await f.get(grant.url)
  expect(response.status).toBe(413)
  expect(response.headers.get('content-disposition')).toBeNull()
  await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' })
})

it('streams a one-use grant with safe attachment headers, preserving the exact resource binding', async () => {
  const f = await fixture()
  const grant = await f.grant('tab-b', 'download-b')
  const response = await f.get(grant.url)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('download body')
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(response.headers.get('content-length')).toBe('13')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-security-policy')).toContain('sandbox')
  const disposition = response.headers.get('content-disposition')!
  expect(disposition).not.toMatch(/[\r\n]/)
  expect(disposition).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%22%0D%0A%3Cscript%3E.csv")
  expect(f.download.mock.calls).toEqual([
    ['tab-b', 'download-b'],
    ['tab-b', 'download-b'],
  ])
  expect((await f.get(grant.url)).status).toBe(401)
  expect(f.download).toHaveBeenCalledTimes(2)
})

it('rejects expired links without opening the staged file', async () => {
  const f = await fixture()
  const grant = await f.grant()
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 30_001)
  expect((await f.get(grant.url)).status).toBe(401)
  expect(f.download).toHaveBeenCalledTimes(1)
})

it('rechecks device revocation and file availability when redeeming an existing grant', async () => {
  const f = await fixture()
  const stale = await f.grant()
  f.download.mockRejectedValueOnce(new HttpError(404, 'Download expired'))
  expect((await f.get(stale.url)).status).toBe(404)
  expect((await f.get(stale.url)).status).toBe(401)
  const revoked = await f.grant()
  const device = f.runtime.services.devices.authenticate(f.token)
  f.runtime.services.devices.revoke(device.id)
  expect((await f.get(revoked.url)).status).toBe(401)
  expect(f.download).toHaveBeenCalledTimes(3)
})

it('rechecks socket authorization after the asynchronous file read before minting a grant', async () => {
  const f = await fixture()
  f.authorize
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw new HttpError(403, 'Disconnected')
    })
  await expect(f.grant()).rejects.toMatchObject({ status: 403 })
  expect(f.authorize).toHaveBeenCalledTimes(2)
})

it('bounds outstanding grants and reclaims expired capacity', async () => {
  const f = await fixture()
  for (let n = 0; n < 128; n++) await f.grant()
  await expect(f.grant()).rejects.toMatchObject({ status: 429 })
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001)
  await expect(f.grant()).resolves.toHaveProperty('url')
})

it('does not redeem a grant against another runtime instance', async () => {
  const a = await fixture()
  const b = await fixture()
  const grant = await a.grant()
  expect((await b.get(grant.url)).status).toBe(401)
  expect(b.download).not.toHaveBeenCalled()
  const response = await a.get(grant.url)
  expect(response.status).toBe(200)
  await response.arrayBuffer()
})

it('does not read any file when the socket is already unauthorized', async () => {
  const f = await fixture()
  f.authorize.mockImplementation(() => {
    throw new HttpError(403, 'Disconnected')
  })
  await expect(f.grant()).rejects.toMatchObject({ status: 403 })
  expect(f.download).not.toHaveBeenCalled()
})
