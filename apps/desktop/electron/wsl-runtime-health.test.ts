import { afterEach, expect, it, vi } from 'vite-plus/test'
import { RUNTIME_PROTOCOL_VERSION } from '@dovo/protocol'
import { waitForWslRuntime } from './wsl-runtime-health'
const connection = {
  address: 'http://127.0.0.1:34267',
  token: 'linux-owner-token-at-least-thirty-two-characters',
}
const alive = { exitCode: null, signalCode: null }
const refused = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }),
  })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('waits for Windows forwarding after Linux reports ready and verifies owner/protocol', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(refused())
    .mockRejectedValueOnce(refused())
    .mockResolvedValue(Response.json({ owner: true, protocolVersion: RUNTIME_PROTOCOL_VERSION }))
  vi.stubGlobal('fetch', fetch)
  await waitForWslRuntime(connection, alive)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch).toHaveBeenLastCalledWith(
    connection.address + '/api/snapshot',
    expect.objectContaining({
      headers: { Authorization: `Bearer ${connection.token}` },
      redirect: 'error',
    }),
  )
})

it('bounds a permanently unavailable listener and gives an actionable error', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(refused())
  vi.stubGlobal('fetch', fetch)
  const waiting = (async () => {
    await expect(waitForWslRuntime(connection, alive)).rejects.toThrow(
      'Check WSL localhost forwarding',
    )
  })()
  await vi.advanceTimersByTimeAsync(10_000)
  await waiting
})

it.each([
  [401, { owner: false, protocolVersion: RUNTIME_PROTOCOL_VERSION }],
  [200, { owner: false, protocolVersion: RUNTIME_PROTOCOL_VERSION }],
  [200, { owner: true, protocolVersion: -1 }],
])('never retries authentication or protocol failures (%s)', async (status, snapshot) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(snapshot, { status }))
  vi.stubGlobal('fetch', fetch)
  await expect(waitForWslRuntime(connection, alive)).rejects.toThrow('Could not verify')
  expect(fetch).toHaveBeenCalledOnce()
})

it('stops waiting when the WSL supervisor exits', async () => {
  const child = { exitCode: null as number | null, signalCode: null }
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
    child.exitCode = 1
    throw refused()
  })
  vi.stubGlobal('fetch', fetch)
  await expect(waitForWslRuntime(connection, child)).rejects.toThrow('exited before')
  expect(fetch).toHaveBeenCalledOnce()
})
