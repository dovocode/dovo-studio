import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { snapshotSchema, parsePairingInvitation } from '@dovo/protocol'
const outputOptions = vi.hoisted(() => ({ json: true }))
vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:util')>()),
  parseArgs: () => ({
    values: {
      connection: '/test/runtime-connection.json',
      'public-address': 'https://workstation.example.test',
      network: 'local',
      json: outputOptions.json,
    },
    positionals: ['code'],
  }),
}))
vi.mock('./connection.js', () => ({
  connectionPaths: () => [],
  readConnection: () => ({
    address: 'http://127.0.0.1:8787',
    bindHost: '127.0.0.1',
    token: 'test-owner-token-at-least-thirty-two-characters',
    pid: 1,
  }),
}))
vi.mock('./network.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./network.js')>()),
  discoverNetworks: () =>
    Promise.resolve([
      {
        network: 'local',
        name: 'en0',
        host: '192.168.1.10',
      },
    ]),
}))
afterEach(() => {
  outputOptions.json = true
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('honors an explicit HTTPS public address when network discovery cannot determine the proxy address', async () => {
  const snapshot = decode(snapshotSchema, {
    owner: true,
    revision: 0,
    workspace: {
      version: 1,
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
      runtimeAddress: '',
    },
    approvals: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const request = vi.fn<(address: string, options: RequestInit) => Promise<Response>>()
  request.mockImplementation((address) =>
    Promise.resolve(
      Response.json(
        address.endsWith('/api/snapshot')
          ? snapshot
          : {
              code: '12345678',
              expiresAt: '2026-09-19T12:02:00Z',
            },
      ),
    ),
  )
  vi.stubGlobal('fetch', request)
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('./cli')
  await vi.waitFor(() => expect(output).toHaveBeenCalledOnce())
  expect(output).toHaveBeenCalledWith(
    JSON.stringify({
      address: 'https://workstation.example.test',
      addresses: [],
      bindHost: '127.0.0.1',
      autoApprove: true,
      code: '12345678',
      expiresAt: '2026-09-19T12:02:00Z',
    }),
  )
  expect(request).toHaveBeenCalledTimes(2)
  expect(request).toHaveBeenLastCalledWith(
    'http://127.0.0.1:8787/api/pair/code',
    expect.objectContaining({
      body: JSON.stringify({
        autoApprove: true,
      }),
      redirect: 'error',
    }),
  )
})

it('prints a scannable pairing invitation in human-readable server output', async () => {
  outputOptions.json = false
  vi.resetModules()
  const expiresAt = new Date(Date.now() + 120000).toISOString()
  const snapshot = decode(snapshotSchema, {
    owner: true,
    revision: 0,
    workspace: {
      version: 1,
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
      runtimeAddress: '',
    },
    approvals: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<(address: string) => Promise<Response>>((address) =>
      Promise.resolve(
        Response.json(
          address.endsWith('/api/snapshot') ? snapshot : { code: '00112233', expiresAt },
        ),
      ),
    ),
  )
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('./cli')
  await vi.waitFor(() =>
    expect(
      output.mock.calls.some(
        ([text]) => typeof text === 'string' && text.includes('Pairing link:'),
      ),
    ).toBe(true),
  )
  const text = output.mock.calls.map(([value]) => String(value)).join('\n')
  const link = text.split('Pairing link: ')[1].split('\n')[0]
  expect(parsePairingInvitation(link)).toEqual({
    address: 'https://workstation.example.test',
    code: '00112233',
    expiresAt,
  })
  expect(text).toContain('▄')
  expect(text).not.toContain('test-owner-token-at-least-thirty-two-characters')
})
