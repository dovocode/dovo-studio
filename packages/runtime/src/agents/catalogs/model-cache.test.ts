import { expect, it, vi } from 'vite-plus/test'
import type { ModelCatalog } from '@dovo/protocol'
import { ModelCatalogCache } from './model-cache'

it('reuses provider models and coalesces concurrent discovery', async () => {
  const cache = new ModelCatalogCache()
  const load = vi.fn<() => Promise<ModelCatalog>>(async () => ({
    models: [{ id: 'm', name: 'Model' }],
    reasoning: [],
  }))
  const [first, second] = await Promise.all([
    cache.get('provider', load),
    cache.get('provider', load),
  ])
  expect(first).toEqual(second)
  expect(await cache.get('provider', load)).toEqual(first)
  expect(load).toHaveBeenCalledTimes(1)
})

it('retries failed discovery instead of caching its error', async () => {
  const cache = new ModelCatalogCache()
  const load = vi
    .fn<() => Promise<ModelCatalog>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ models: [], reasoning: [] })
  await expect(cache.get('provider', load)).rejects.toThrow('offline')
  await expect(cache.get('provider', load)).resolves.toEqual({ models: [], reasoning: [] })
  expect(load).toHaveBeenCalledTimes(2)
})

it('refreshes an unexpired entry and coalesces concurrent refresh requests', async () => {
  const cache = new ModelCatalogCache()
  const load = vi.fn<() => Promise<ModelCatalog>>(async () => ({ models: [], reasoning: [] }))
  await cache.get('host', load)
  await Promise.all([cache.get('host', load, true), cache.get('host', load, true)])
  expect(load).toHaveBeenCalledTimes(2)
  await cache.get('host', load)
  expect(load).toHaveBeenCalledTimes(2)
})
