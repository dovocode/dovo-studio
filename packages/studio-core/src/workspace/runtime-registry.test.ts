import { expect, it, vi } from 'vite-plus/test'
import { decodeRuntimeRegistry, mergeRuntimeRegistry } from './runtime-registry'
vi.mock('./read-cache', () => ({
  readWorkspaceDocument: async (key: string) => localStorage.getItem(key),
  captureRegistryCacheChange: async () => [],
  commitRegistryCacheChange: async () => {},
}))
const connection = { address: 'http://remote:8787/', token: 'a-valid-runtime-token-123456' }
it("preserves another tab's pairing when a stale tab changes selection", () => {
  const before = decodeRuntimeRegistry(null, JSON.stringify(connection))
  const other = decodeRuntimeRegistry(
    null,
    JSON.stringify({ ...connection, address: 'http://other:8787' }),
  ).profiles[0]
  const current = { ...before, profiles: [...before.profiles, other], activeId: other.id }
  expect(mergeRuntimeRegistry(current, before, { ...before, activeId: null })).toEqual({
    ...current,
    activeId: null,
  })
  expect(mergeRuntimeRegistry(current, before, before)).toEqual(current)
})
it("rejects competing edits rather than overwriting another tab's computer", () => {
  const before = decodeRuntimeRegistry(null, JSON.stringify(connection))
  const current = { ...before, profiles: [{ ...before.profiles[0], name: 'Other window' }] }
  expect(() => mergeRuntimeRegistry(current, before, { ...before, profiles: [] })).toThrow(
    'another window',
  )
})
it('migrates one saved connection into a selected runtime without losing credentials', () => {
  const migrated = decodeRuntimeRegistry(null, JSON.stringify(connection))
  expect(migrated.profiles).toHaveLength(1)
  expect(migrated.activeId).toBe(migrated.profiles[0].id)
  expect(migrated.profiles[0].connection).toEqual({ ...connection, address: 'http://remote:8787' })
})
it('prefers the saved registry and retains active selection', () => {
  const registry = decodeRuntimeRegistry(null, JSON.stringify(connection))
  expect(decodeRuntimeRegistry(JSON.stringify(registry), 'broken legacy value')).toEqual(registry)
})
it('does not overwrite malformed saved runtime credentials', () => {
  expect(() => decodeRuntimeRegistry('broken', JSON.stringify(connection))).toThrow(SyntaxError)
  expect(() => decodeRuntimeRegistry(null, 'broken')).toThrow(SyntaxError)
})

it('reads the saved workspace registry without waiting for pending network pairing', async () => {
  const { vi } = await import('vite-plus/test')
  const { readRuntimeRegistry } = await import('./runtime-registry')
  const registry = decodeRuntimeRegistry(null, JSON.stringify(connection))
  const pending = {
    ...registry,
    pendingPairings: [
      {
        profile: registry.profiles[0],
        proof: {
          id: 'pending',
          secret: 'synthetic-pairing-secret',
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
      },
    ],
  }
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'dovo.runtimes.v1' ? JSON.stringify(pending) : null),
  })
  try {
    expect(await readRuntimeRegistry()).toEqual(pending)
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('loads an encrypted registry without rewriting it when a second window opens', async () => {
  const { readRuntimeRegistry } = await import('./runtime-registry')
  const registry = decodeRuntimeRegistry(null, JSON.stringify(connection))
  registry.profiles[0].connection.alternateAddresses = ['http://100.64.0.1:8787']
  const read = vi.fn<() => Promise<string>>(async () => JSON.stringify(registry))
  const write = vi.fn<(value: string, before: string) => Promise<string>>()
  vi.stubGlobal('window', {
    dovo: {
      readRuntimeRegistry: read,
      writeRuntimeRegistry: write,
      subscribeRuntimeRegistry: () => () => {},
    },
  })
  vi.stubGlobal('localStorage', { getItem: () => null })
  try {
    expect(await readRuntimeRegistry()).toEqual(registry)
    expect(read).toHaveBeenCalledOnce()
    expect(write).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('sends the observed registry to Electron and returns the committed merge', async () => {
  const { readRuntimeRegistry, writeRuntimeRegistry } = await import('./runtime-registry')
  const before = decodeRuntimeRegistry(null, JSON.stringify(connection))
  const current = { ...before, profiles: [{ ...before.profiles[0], name: 'Other window' }] }
  const next = { ...before, activeId: null }
  const committed = { ...current, activeId: null }
  const write = vi
    .fn<(value: string, before: string) => Promise<string>>()
    .mockResolvedValue(JSON.stringify(committed))
  const remove = vi.fn<(key: string) => void>()
  vi.stubGlobal('window', {
    dovo: {
      readRuntimeRegistry: async () => JSON.stringify(before),
      writeRuntimeRegistry: write,
      subscribeRuntimeRegistry: () => () => {},
    },
  })
  vi.stubGlobal('localStorage', { getItem: () => null, removeItem: remove })
  try {
    await readRuntimeRegistry()
    expect(await writeRuntimeRegistry(next)).toEqual(committed)
    expect(write).toHaveBeenCalledWith(JSON.stringify(next), JSON.stringify(before))
    await writeRuntimeRegistry(committed)
    expect(write).toHaveBeenLastCalledWith(JSON.stringify(committed), JSON.stringify(committed))
    expect(remove).toHaveBeenCalledWith('dovo.runtimes.v1')
  } finally {
    vi.unstubAllGlobals()
  }
})
it('preserves legacy credentials on failed migration and uses the committed concurrent merge on success', async () => {
  const { readRuntimeRegistry } = await import('./runtime-registry')
  const legacy = decodeRuntimeRegistry(null, JSON.stringify(connection))
  const committed = { ...legacy, activeId: null }
  const write = vi
    .fn<(value: string, before: string) => Promise<string>>()
    .mockRejectedValueOnce(new Error('Keychain unavailable'))
    .mockResolvedValueOnce(JSON.stringify(committed))
  const remove = vi.fn<(key: string) => void>()
  vi.stubGlobal('window', {
    dovo: {
      readRuntimeRegistry: async () => null,
      writeRuntimeRegistry: write,
      subscribeRuntimeRegistry: () => () => {},
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'dovo.connection.v1' ? JSON.stringify(connection) : null),
    removeItem: remove,
  })
  try {
    await expect(readRuntimeRegistry()).rejects.toThrow('Keychain unavailable')
    expect(remove).not.toHaveBeenCalled()
    expect(await readRuntimeRegistry()).toEqual(committed)
    expect(write).toHaveBeenLastCalledWith(
      JSON.stringify(legacy),
      JSON.stringify({ version: 1, activeId: null, profiles: [] }),
    )
    expect(remove).toHaveBeenCalledWith('dovo.connection.v1')
  } finally {
    vi.unstubAllGlobals()
  }
})
it('subscribes to main-process registry notifications and releases the subscription', async () => {
  const { subscribeRuntimeRegistry } = await import('./runtime-registry')
  const listener = vi.fn<() => void>(),
    stop = vi.fn<() => void>()
  const subscribe = vi.fn<(listener: () => void) => () => void>().mockReturnValue(stop)
  vi.stubGlobal('window', {
    dovo: {
      readRuntimeRegistry: async () => null,
      writeRuntimeRegistry: async () => '',
      subscribeRuntimeRegistry: subscribe,
    },
  })
  try {
    const unsubscribe = subscribeRuntimeRegistry(listener)
    subscribe.mock.calls[0][0]()
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    expect(stop).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('keeps legacy storage when Electron returns an invalid write acknowledgement', async () => {
  const { readRuntimeRegistry, writeRuntimeRegistry } = await import('./runtime-registry')
  const registry = decodeRuntimeRegistry(null, JSON.stringify(connection))
  const remove = vi.fn<(key: string) => void>()
  vi.stubGlobal('window', {
    dovo: {
      readRuntimeRegistry: async () => JSON.stringify(registry),
      writeRuntimeRegistry: async () => '',
      subscribeRuntimeRegistry: () => () => {},
    },
  })
  vi.stubGlobal('localStorage', { getItem: () => null, removeItem: remove })
  try {
    await readRuntimeRegistry()
    await expect(writeRuntimeRegistry({ ...registry, activeId: null })).rejects.toThrow(SyntaxError)
    expect(remove).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
