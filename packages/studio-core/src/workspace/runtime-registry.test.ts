import { expect, it } from 'vitest'
import { decodeRuntimeRegistry } from './runtime-registry'
const connection = { address: 'http://remote:8787/', token: 'a-valid-runtime-token-123456' }
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
  const { vi } = await import('vitest')
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
