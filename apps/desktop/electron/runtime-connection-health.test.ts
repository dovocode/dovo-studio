import { afterEach, expect, it, vi } from 'vite-plus/test'
import { RUNTIME_PROTOCOL_VERSION } from '@dovo/protocol'
import { checkRuntimeConnection } from './runtime-connection-health'
const connection = {
  address: 'http://127.0.0.1:34267',
  token: 'owner-token-at-least-thirty-two-characters',
}
afterEach(() => vi.unstubAllGlobals())
it('verifies the listener using the exact owner credentials and compatible protocol', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ owner: true, protocolVersion: RUNTIME_PROTOCOL_VERSION }))
  vi.stubGlobal('fetch', request)
  await checkRuntimeConnection(connection)
  expect(request).toHaveBeenCalledWith(
    connection.address + '/api/snapshot',
    expect.objectContaining({
      headers: { Authorization: `Bearer ${connection.token}` },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  )
})
it.each([
  [
    401,
    { owner: false, protocolVersion: RUNTIME_PROTOCOL_VERSION },
    'rejected the desktop credentials',
  ],
  [200, { owner: false, protocolVersion: RUNTIME_PROTOCOL_VERSION }, 'did not grant owner access'],
  [200, { owner: true, protocolVersion: -1 }, 'incompatible with this desktop version'],
  [200, {}, 'invalid connection data'],
])('refuses an unverified connection (%s)', async (status, snapshot, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(snapshot, { status })),
  )
  await expect(checkRuntimeConnection(connection)).rejects.toThrow(message)
})
