import { mutableStruct } from '@dovo/protocol'
import { Effect, Fiber, Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'
import { runClientEffect } from '@dovo/client-runtime'
import { openDatabase } from '../../storage/database.js'
import { ForgeWorkCache } from './cache.js'

const schema = mutableStruct({
  value: Schema.String,
  cachedAt: Schema.optional(Schema.String),
})
const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})

function setup() {
  const db = openDatabase(':memory:')
  cleanup.push(() => db.close())
  return { db, cache: new ForgeWorkCache(db) }
}

const options = (
  overrides: Partial<{
    refresh: boolean
    load: () => Promise<Schema.Schema.Type<typeof schema>>
    validateSource: () => void
  }> = {},
) => ({
  key: 'issue-page',
  source: 'repo-account',
  schema,
  refresh: false,
  load: async (): Promise<Schema.Schema.Type<typeof schema>> => ({ value: 'fresh' }),
  validateSource: () => {},
  ...overrides,
})

it('serves a validated cached value with refresh error when the provider is unavailable', async () => {
  const { cache } = setup()
  await Effect.runPromise(cache.readEffect(options()))
  const result = await Effect.runPromise(
    cache.readEffect(
      options({
        refresh: true,
        load: async () => {
          throw new Error('Provider unavailable')
        },
      }),
    ),
  )
  expect(result).toMatchObject({
    value: 'fresh',
    stale: true,
    refreshError: 'Provider unavailable',
  })
})

it('validates the source before publishing a fresh value', async () => {
  const { db, cache } = setup()
  let validations = 0
  const pending = cache.readEffect(
    options({
      validateSource: () => {
        validations++
        if (validations > 1) throw new Error('Source changed')
      },
    }),
  )
  await expect(runClientEffect(pending)).rejects.toThrow('Source changed')
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 0 })
})

it('revalidates the source before returning a cached fallback after provider failure', async () => {
  const { db, cache } = setup()
  await Effect.runPromise(cache.readEffect(options()))
  let validations = 0
  const pending = cache.readEffect(
    options({
      refresh: true,
      load: async () => {
        throw new Error('Provider unavailable')
      },
      validateSource: () => {
        validations++
        if (validations > 1) throw new Error('Source changed')
      },
    }),
  )
  await expect(runClientEffect(pending)).rejects.toThrow('Source changed')
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 1 })
})

it('does not persist a read interrupted while its provider request is pending', async () => {
  const { db, cache } = setup()
  let started = false
  let finish: (value: { value: string }) => void = () => {
    throw new Error('Read did not start')
  }
  const caller = Effect.runFork(
    cache.readEffect(
      options({
        load: () =>
          new Promise((resolve) => {
            started = true
            finish = resolve
          }),
      }),
    ),
  )
  await vi.waitFor(() => expect(started).toBe(true))
  await Effect.runPromise(Fiber.interrupt(caller))
  finish({ value: 'late' })
  await Promise.resolve()
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 0 })
})
