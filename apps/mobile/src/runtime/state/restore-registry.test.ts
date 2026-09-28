import { expect, it } from 'vite-plus/test'
import { Effect } from 'effect'
import { legacyDraftKey, legacyKey, registryKey, restoreRegistry } from './restore-registry'

it.each([1, 2, 3])(
  'resumes legacy migration after persistence operation %i fails',
  async (failure) => {
    const values = new Map([
      [
        legacyKey,
        JSON.stringify({
          address: 'http://host:8787',
          token: 'test-owner-token-at-least-32-characters',
        }),
      ],
    ])
    let operations = 0
    let inject = true
    const checkpoint = () => {
      if (inject && ++operations === failure) throw new Error('Storage unavailable')
    }
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        checkpoint()
        values.set(key, value)
      },
      removeItem: async (key: string) => {
        checkpoint()
        values.delete(key)
      },
    }
    await expect(Effect.runPromise(restoreRegistry(storage))).rejects.toThrow('Storage unavailable')
    inject = false
    const restored = await Effect.runPromise(restoreRegistry(storage))
    expect(restored.registry.profiles).toHaveLength(1)
    expect(restored.draftRuntimeId).toBe(restored.registry.activeId)
    expect(values.get(legacyDraftKey)).toBe('http://host:8787')
    expect(values.has(registryKey)).toBe(true)
    expect(values.has(legacyKey)).toBe(false)
  },
)

it('repairs a registry committed by the old migration before its draft marker', async () => {
  const profile = {
    id: 'http://host:8787',
    name: 'host',
    connection: { address: 'http://host:8787', token: 'test-owner-token-at-least-32-characters' },
  }
  const registry = { version: 1, activeId: profile.id, profiles: [profile] }
  const values = new Map([
    [legacyKey, JSON.stringify(profile.connection)],
    [registryKey, JSON.stringify(registry)],
  ])
  const restored = await Effect.runPromise(
    restoreRegistry({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: async (key) => {
        values.delete(key)
      },
    }),
  )
  expect(restored.registry).toEqual(registry)
  expect(restored.draftRuntimeId).toBe(profile.id)
  expect(values.has(legacyKey)).toBe(false)
})
