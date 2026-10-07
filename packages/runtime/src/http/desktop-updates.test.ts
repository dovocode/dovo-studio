import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { canUpdateDesktop, desktopUpdate } from './desktop-updates.js'
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-update-proxy-'))
  vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'runtime.sqlite'))
  vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'desktop')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})
it('only exposes a live desktop bridge, never external URLs or arbitrary installers', () => {
  expect(canUpdateDesktop()).toBe(false)
  writeFileSync(
    join(directory, 'desktop-update-host.json'),
    JSON.stringify({ pid: process.pid, port: 1234, token: 'x'.repeat(64) }),
  )
  expect(canUpdateDesktop()).toBe(true)
  vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'source')
  expect(canUpdateDesktop()).toBe(false)
  vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'desktop')
  writeFileSync(
    join(directory, 'desktop-update-host.json'),
    JSON.stringify({ pid: process.pid, port: -1, token: 'x'.repeat(64) }),
  )
  expect(canUpdateDesktop()).toBe(false)
})
it('proxies only to loopback with the private credential and preserves update errors', async () => {
  const token = 'x'.repeat(64)
  writeFileSync(
    join(directory, 'desktop-update-host.json'),
    JSON.stringify({ pid: process.pid, port: 1234, token }),
  )
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ status: 'queued', version: '1.0.1' }),
  )
  vi.stubGlobal('fetch', fetcher)
  expect(await desktopUpdate('download', '1.0.1')).toMatchObject({
    status: 'queued',
    version: '1.0.1',
  })
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:1234/download',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
    }),
  )
  fetcher.mockResolvedValueOnce(Response.json({ error: 'Open the app first' }, { status: 409 }))
  await expect(desktopUpdate('restart', '1.0.1')).rejects.toThrow('Open the app first')
})
