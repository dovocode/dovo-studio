import { mutableStruct } from './schema.js'
import { expect, it } from 'vitest'
import { Schema } from 'effect'
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
    createRuntimeReadCache(
      {
        address,
        token,
      },
      storage,
      async (text) => {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        )
      },
    )
  return {
    values,
    cache,
  }
}
it('persists large offline snapshots without mixing hosts or credentials', async () => {
  const { values, cache } = fixture()
  const history = 'x'.repeat(8 * 1024 * 1024)
  await cache('http://first:51464').write('snapshot', {
    history,
  })
  expect(
    (
      await cache('http://first:51464').read(
        'snapshot',
        mutableStruct({
          history: Schema.String,
        }),
      )
    )?.value.history,
  ).toBe(history)
  expect(await cache('http://second:51464').read('snapshot', Schema.Unknown)).toBeNull()
  expect(
    await cache('http://first:51464', 'different-token').read('snapshot', Schema.Unknown),
  ).toBeNull()
  expect([...values.keys()].join()).not.toContain('private-token')
  expect([...values.values()].join()).not.toContain('private-token')
})
it('discards corrupt and incompatible cached results', async () => {
  const { values, cache } = fixture()
  const client = cache('http://first')
  await client.write('pull', {
    number: 7,
  })
  expect(
    await client.read(
      'pull',
      mutableStruct({
        number: Schema.String,
      }),
    ),
  ).toBeNull()
  await client.write('pull', {
    number: 7,
  })
  const key = [...values.keys()].find((key) => key.endsWith('.pull'))!
  values.set(key, 'not-json')
  expect(await client.read('pull', Schema.Unknown)).toBeNull()
  expect(values.has(key)).toBe(false)
})
it('bounds PR results and keeps the offline workspace', async () => {
  const { cache } = fixture()
  const client = cache('http://first')
  await client.write('snapshot', {
    tasks: [],
  })
  await Promise.all(
    Array.from(
      {
        length: 105,
      },
      (_, index) =>
        client.write(`pr:${index}`, {
          index,
        }),
    ),
  )
  expect(await client.read('pr:0', Schema.Unknown)).toBeNull()
  expect(
    (
      await client.read(
        'pr:104',
        mutableStruct({
          index: Schema.Number.pipe(Schema.finite()),
        }),
      )
    )?.value.index,
  ).toBe(104)
  expect(await client.read('snapshot', Schema.Unknown)).not.toBeNull()
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
  expect(await cache('http://first').read('snapshot', Schema.Unknown)).toBeNull()
  expect(await cache('http://first').read('late', Schema.Unknown)).toBeNull()
  expect(await old.read('pull', Schema.Unknown)).toBeNull()
  expect(await cache('http://first', 'old-token').read('late', Schema.Unknown)).toBeNull()
  expect((await other.read('pull', Schema.String))?.value).toBe('other computer')
})

it('waits for interrupted native writes before forgetting a computer', async () => {
  const { Effect, Fiber } = await import('effect')
  const values = new Map<string, string>()
  let release = () => {}
  let started = () => {}
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const storage: CacheStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      started()
      await gate
      values.set(key, value)
    },
    removeItem: async (key) => {
      values.delete(key)
    },
    removePrefix: async (prefix) => {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
    },
  }
  const client = createRuntimeReadCache(
    { address: 'http://first', token: 'secret' },
    storage,
    async () => 'digest',
  )
  const write = Effect.runFork(client.writeEffect('snapshot', 'data'))
  await entered
  const interrupted = Effect.runPromise(Fiber.interrupt(write))
  let forgotten = false
  const clear = client.clear().then(() => {
    forgotten = true
  })
  await Promise.resolve()
  expect(forgotten).toBe(false)
  release()
  await Promise.all([interrupted, clear])
  expect(values.size).toBe(0)
  await client.write('late', 'data')
  expect(values.size).toBe(0)
})

it('recovers after the first namespace initialization is interrupted', async () => {
  const { Effect, Fiber } = await import('effect')
  const values = new Map<string, string>()
  let release = () => {}
  let started = () => {}
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = createRuntimeReadCache(
    { address: 'http://first', token: 'secret' },
    {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: async (key) => {
        values.delete(key)
      },
      removePrefix: async (prefix) => {
        for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
      },
    },
    async (text) => {
      started()
      await gate
      return text
    },
  )
  const first = Effect.runFork(client.readEffect('snapshot', Schema.String))
  await entered
  await Effect.runPromise(Fiber.interrupt(first))
  release()
  await client.write('snapshot', 'recovered')
  expect((await client.read('snapshot', Schema.String))?.value).toBe('recovered')
  await client.close()
})
