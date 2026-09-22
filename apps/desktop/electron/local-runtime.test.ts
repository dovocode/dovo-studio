import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fixture = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }))
vi.mock('node:child_process', () => ({ spawn: vi.fn<typeof import('node:child_process').spawn>() }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
  if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true })
})

it('attaches to an authenticated existing server and leaves it running when desktop closes', async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-attach-'))
  const connection = {
    address: 'http://127.0.0.1:51464',
    token: 'owner-token-at-least-thirty-two-characters',
    pid: process.pid,
    bindHost: '0.0.0.0',
  }
  writeFileSync(join(fixture.directory, 'runtime-connection.json'), JSON.stringify(connection))
  const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ owner: true })))
  vi.stubGlobal('fetch', request)
  const signal = vi.spyOn(process, 'kill')
  const { spawn } = await import('node:child_process')
  const { startLocalRuntime, stopLocalRuntime } = await import('./local-runtime')
  expect(await startLocalRuntime('/unused')).toEqual({
    address: connection.address,
    token: connection.token,
  })
  await stopLocalRuntime()
  expect(spawn).not.toHaveBeenCalled()
  expect(signal).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledWith(
    connection.address + '/api/snapshot',
    expect.objectContaining({
      headers: { Authorization: `Bearer ${connection.token}` },
      redirect: 'error',
    }),
  )
})
