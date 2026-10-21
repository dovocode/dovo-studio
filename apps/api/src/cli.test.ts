import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { snapshotSchema, parsePairingInvitation } from '@dovo/protocol'
const outputOptions = vi.hoisted(() => ({ json: true, positionals: ['code'] }))
vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:util')>()),
  parseArgs: () => ({
    values: {
      connection: '/test/runtime-connection.json',
      'public-address': 'https://workstation.example.test',
      network: 'local',
      json: outputOptions.json,
    },
    positionals: outputOptions.positionals,
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
  outputOptions.positionals = ['code']
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

it.each(['approve', 'deny'])(
  'routes server %s to the owner-only internet approval endpoint',
  async (command) => {
    vi.resetModules()
    outputOptions.positionals = [command, 'upgrade-id']
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
      pendingPeerUpgrades: [
        {
          id: 'upgrade-id',
          deviceId: 'phone',
          name: 'My phone',
          status: 'pending',
          relay: 'dovo',
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
      ],
    })
    const request = vi.fn<(address: string, options: RequestInit) => Promise<Response>>((address) =>
      Promise.resolve(Response.json(address.endsWith('/api/snapshot') ? snapshot : { ok: true })),
    )
    vi.stubGlobal('fetch', request)
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    await import('./cli')
    await vi.waitFor(() => expect(output).toHaveBeenCalledOnce())
    expect(request).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8787/api/runtime/peer/upgrade/approve',
      expect.objectContaining({
        body: JSON.stringify({ id: 'upgrade-id', allow: command === 'approve' }),
      }),
    )
  },
)

it.each([
  ['dovo', 'Dovo relay fallback (encrypted)'],
  ['custom', 'Computer / organization relay fallback (encrypted)'],
])(
  'lists %s internet requests with explicit relay consent for headless server operators',
  async (relay, label) => {
    vi.resetModules()
    outputOptions.json = false
    outputOptions.positionals = ['devices']
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
      pendingPeerUpgrades: [
        {
          id: 'upgrade-id',
          deviceId: 'phone',
          name: 'My phone',
          status: 'pending',
          relay,
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
      ],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(snapshot)),
    )
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    await import('./cli')
    await vi.waitFor(() => expect(output).toHaveBeenCalledOnce())
    expect(output).toHaveBeenCalledWith(expect.stringContaining(`upgrade-id  My phone  ${label}`))
  },
)

it('shows only the public relay key for headless server admission', async () => {
  vi.resetModules()
  outputOptions.positionals = ['relay-key']
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
  const publicKey = 'A'.repeat(59)
  const request = vi.fn<(address: string) => Promise<Response>>(async (address) =>
    Response.json(address.endsWith('/api/snapshot') ? snapshot : { publicKey }),
  )
  vi.stubGlobal('fetch', request)
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('./cli')
  await vi.waitFor(() => expect(output).toHaveBeenCalledOnce())
  expect(output).toHaveBeenCalledWith(JSON.stringify({ publicKey }))
  expect(request).toHaveBeenLastCalledWith(
    'http://127.0.0.1:8787/api/runtime/peer/identity',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  )
})

it.each(['status', 'off'])(
  'manages account internet %s locally without requesting or printing account tokens',
  async (command) => {
    vi.resetModules()
    outputOptions.positionals = ['internet', command]
    const internet = { enabled: true, connected: true, error: '' }
    const snapshot = decode(snapshotSchema, {
      owner: true,
      revision: 0,
      internet,
      workspace: {
        version: 1,
        runtimeAddress: '',
        agents: [],
        repositories: [],
        tasks: [],
        automations: [],
      },
      approvals: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    })
    const request = vi.fn<(address: string, init: RequestInit) => Promise<Response>>(
      async (address) =>
        Response.json(
          address.endsWith('/api/snapshot')
            ? snapshot
            : { ...internet, enabled: false, connected: false },
        ),
    )
    vi.stubGlobal('fetch', request)
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    await import('./cli')
    await vi.waitFor(() => expect(output).toHaveBeenCalledOnce())
    expect(output).toHaveBeenCalledWith(
      JSON.stringify(
        command === 'status' ? internet : { ...internet, enabled: false, connected: false },
      ),
    )
    expect(request).toHaveBeenCalledTimes(command === 'off' ? 2 : 1)
    expect(
      request.mock.calls
        .filter(([address]) => address.endsWith('/api/runtime/internet'))
        .map(([, options]) => ({ method: options.method, body: options.body })),
    ).toEqual(
      command === 'off' ? [{ method: 'POST', body: JSON.stringify({ enabled: false }) }] : [],
    )
  },
)
