import { expect, it } from 'vitest'
import { z } from 'zod'
import { createRuntimeReadCache, type CacheStorage } from './read-cache.js'

function fixture() {
  const values = new Map<string, string>()
  const storage: CacheStorage = {
    async getItem(key) {
      return values.get(key) ?? null
    },
    async setItem(key, value) {
      values.set(key, value)
    },
    async removeItem(key) {
      values.delete(key)
    },
    async removePrefix(prefix) {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
    },
  }
  const cache = (address: string, token = 'private-token') =>
    createRuntimeReadCache({ address, token }, storage, async (text) => {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      )
    })
  return { values, cache }
}

it('persists large offline snapshots without mixing hosts or credentials', async () => {
  const { values, cache } = fixture()
  const history = 'x'.repeat(8 * 1024 * 1024)
  await cache('http://first:51464').write('snapshot', { history })
  expect(
    (await cache('http://first:51464').read('snapshot', z.object({ history: z.string() })))?.value
      .history,
  ).toBe(history)
  expect(await cache('http://second:51464').read('snapshot', z.unknown())).toBeNull()
  expect(
    await cache('http://first:51464', 'different-token').read('snapshot', z.unknown()),
  ).toBeNull()
  expect([...values.keys()].join()).not.toContain('private-token')
  expect([...values.values()].join()).not.toContain('private-token')
})

it('discards corrupt and incompatible cached results', async () => {
  const { values, cache } = fixture()
  const client = cache('http://first')
  await client.write('pull', { number: 7 })
  expect(await client.read('pull', z.object({ number: z.string() }))).toBeNull()
  await client.write('pull', { number: 7 })
  const key = [...values.keys()].find((key) => key.endsWith('.pull'))!
  values.set(key, 'not-json')
  expect(await client.read('pull', z.unknown())).toBeNull()
  expect(values.has(key)).toBe(false)
})

it('bounds PR results and keeps the offline workspace', async () => {
  const { cache } = fixture()
  const client = cache('http://first')
  await client.write('snapshot', { tasks: [] })
  await Promise.all(
    Array.from({ length: 105 }, (_, index) => client.write(`pr:${index}`, { index })),
  )
  expect(await client.read('pr:0', z.unknown())).toBeNull()
  expect((await client.read('pr:104', z.object({ index: z.number() })))?.value.index).toBe(104)
  expect(await client.read('snapshot', z.unknown())).not.toBeNull()
})

it('forgetting removes old credentials too and prevents late writes from restoring data', async () => {
  const { cache } = fixture()
  const old = cache('http://first', 'old-token'),
    current = cache('http://first'),
    other = cache('http://second')
  await old.write('pull', 'private old data')
  await current.write('pull', 'private data')
  await other.write('pull', 'other computer')
  const write = current.write('snapshot', 'pending')
  await current.clear()
  await write
  await current.write('late', 'late response')
  await old.write('late', 'old credential response')
  expect(await cache('http://first').read('snapshot', z.unknown())).toBeNull()
  expect(await cache('http://first').read('late', z.unknown())).toBeNull()
  expect(await old.read('pull', z.unknown())).toBeNull()
  expect(await cache('http://first', 'old-token').read('late', z.unknown())).toBeNull()
  expect((await other.read('pull', z.string()))?.value).toBe('other computer')
})
