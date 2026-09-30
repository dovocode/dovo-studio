import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, desktopUpdateHostSchema, type DesktopUpdateState } from '@dovo/protocol'
import { registerRemoteUpdates } from './remote-updates'
const directories: string[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-remote-update-'))
  directories.push(directory)
  let state: DesktopUpdateState = { status: 'available', version: '1.2.3' }
  const remote = vi.fn<(action: 'download' | 'restart', version: string) => Promise<void>>(
    async (action, version) => {
      state = { status: action === 'download' ? 'downloaded' : 'restarting', version }
    },
  )
  const close = await registerRemoteUpdates(directory, {
    supported: true,
    state: () => state,
    remote,
  })
  if (!close) throw new Error('Missing bridge')
  closers.push(close)
  const host = decode(
    desktopUpdateHostSchema,
    JSON.parse(readFileSync(join(directory, 'desktop-update-host.json'), 'utf8')),
  )
  const request = (path: string, version?: string, token = host.token) =>
    fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: version ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}` },
      body: version ? JSON.stringify({ version }) : undefined,
    })
  return { directory, remote, request }
}
it('requires the private runtime credential and downloads without restarting', async () => {
  const f = await fixture()
  expect((await f.request('/status', undefined, 'wrong')).status).toBe(401)
  expect((await f.request('/download', '1.2.3')).status).toBe(202)
  await vi.waitFor(() => expect(f.remote).toHaveBeenCalledWith('download', '1.2.3'))
  expect(await (await f.request('/status')).json()).toMatchObject({
    status: 'downloaded',
    version: '1.2.3',
  })
  expect(f.remote).toHaveBeenCalledTimes(1)
  await f.request('/restart', '1.2.3')
  await vi.waitFor(() => expect(f.remote).toHaveBeenCalledWith('restart', '1.2.3'))
})
it('rejects malformed versions and concurrent commands and reports failures', async () => {
  const f = await fixture()
  let finish: (() => void) | undefined
  f.remote.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    throw new Error('Download failed')
  })
  expect((await f.request('/download', '../other')).status).toBe(400)
  await f.request('/download', '1.2.3')
  expect((await f.request('/download', '1.2.3')).status).toBe(409)
  finish?.()
  await vi.waitFor(async () =>
    expect(await (await f.request('/status')).json()).toMatchObject({
      status: 'error',
      error: 'Download failed',
    }),
  )
})
it('does not advertise unsupported desktop installs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-no-update-'))
  directories.push(directory)
  expect(
    await registerRemoteUpdates(directory, {
      supported: false,
      state: () => ({ status: 'idle' }),
      remote: async () => {},
    }),
  ).toBeUndefined()
  expect(existsSync(join(directory, 'desktop-update-host.json'))).toBe(false)
})

it('advertises its installed version to independent same-user servers and replaces stale records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-shared-update-'))
  directories.push(directory)
  const shared = join(directory, 'shared')
  const profile = join(directory, 'profile')
  const close = await registerRemoteUpdates(
    profile,
    {
      supported: true,
      installedVersion: '1.2.3',
      state: () => ({ status: 'idle' }),
      remote: async () => {},
    },
    shared,
  )
  if (!close) throw new Error('Missing bridge')
  const record = decode(
    desktopUpdateHostSchema,
    JSON.parse(readFileSync(join(shared, 'desktop-update-host.json'), 'utf8')),
  )
  expect(record.version).toBe('1.2.3')
  await close()
  expect(existsSync(join(profile, 'desktop-update-host.json'))).toBe(false)
  expect(existsSync(join(shared, 'desktop-update-host.json'))).toBe(true)
  const next = await registerRemoteUpdates(
    profile,
    {
      supported: true,
      installedVersion: '1.2.4',
      state: () => ({ status: 'idle' }),
      remote: async () => {},
    },
    shared,
  )
  if (!next) throw new Error('Missing replacement bridge')
  closers.push(next)
  const replacement = decode(
    desktopUpdateHostSchema,
    JSON.parse(readFileSync(join(shared, 'desktop-update-host.json'), 'utf8')),
  )
  expect(replacement.version).toBe('1.2.4')
  expect(replacement.token).not.toBe(record.token)
})
