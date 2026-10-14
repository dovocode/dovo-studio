import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelCatalog } from '@dovo/protocol'
import { commandsSchema, decode, defaultTaskHarness } from '@dovo/protocol'
import { openDatabase } from '../../storage/database.js'
import { AgentRegistry } from '../configuration/registry.js'
import {
  configuredModelCatalogKey,
  ModelCatalogCache,
  modelCatalogGenerations,
} from './model-cache.js'

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
const key = (value: string) => createHash('sha256').update(value).digest('hex')
const catalog: ModelCatalog = {
  models: [{ id: 'm', name: 'Model', reasoning: [{ id: 'high', name: 'High' }] }],
  reasoning: [],
  harness: { name: 'Harness', generation: 'v2' },
  acp: {
    modes: [],
    configOptions: [
      { id: 'account', name: 'Account', currentValue: 'private-secret', options: [] },
    ],
    commands: [],
  },
  codex: { fastModeBlocked: true, daybreakPrograms: ['daybreakBlue'] },
}
const presentation = { models: catalog.models, reasoning: [], harness: catalog.harness }
function setup() {
  const db = openDatabase(':memory:')
  cleanup.push(() => {
    db.close()
  })
  return { db, cache: new ModelCatalogCache(db) }
}

it('coalesces discovery and refreshes, caches only nonempty success for five minutes', async () => {
  const { cache } = setup()
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const load = vi.fn<() => Promise<ModelCatalog>>(async () => catalog)
  const provider = key('provider')
  expect(await Promise.all([cache.get(provider, load), cache.get(provider, load)])).toEqual([
    catalog,
    catalog,
  ])
  await cache.get(provider, load)
  expect(load).toHaveBeenCalledTimes(1)
  await Promise.all([cache.get(provider, load, true), cache.get(provider, load, true)])
  expect(load).toHaveBeenCalledTimes(2)
  now = 300_001
  await cache.get(provider, load)
  expect(load).toHaveBeenCalledTimes(3)
})

it('reopens SQLite with stale safe display data and rediscovers instead of treating it as ready', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-model-cache-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'runtime.sqlite')
  const provider = key('provider-private-secret')
  const firstDb = openDatabase(filename)
  try {
    const first = new ModelCatalogCache(firstDb)
    await first.get(provider, async () => catalog)
    expect(JSON.stringify(firstDb.prepare('SELECT * FROM model_catalog_cache').all())).not.toMatch(
      /private-secret|currentValue|codex|acp/,
    )
  } finally {
    firstDb.close()
  }
  const db = openDatabase(filename)
  cleanup.push(() => {
    db.close()
  })
  const restored = new ModelCatalogCache(db)
  expect(restored.peek(provider)).toEqual(presentation)
  const live = vi
    .fn<() => Promise<ModelCatalog>>()
    .mockRejectedValueOnce(new Error('sign in'))
    .mockResolvedValueOnce(catalog)
  await expect(restored.get(provider, live)).rejects.toThrow('sign in')
  expect(restored.peek(provider)).toEqual(presentation)
  expect(await restored.get(provider, live)).toEqual(catalog)
  expect(live).toHaveBeenCalledTimes(2)
})

it('never caches empty or failed discovery as healthy and preserves last-good presentation', async () => {
  const { cache } = setup()
  const provider = key('provider')
  await cache.get(provider, async () => catalog)
  const empty = vi.fn<() => Promise<ModelCatalog>>(async () => ({ models: [], reasoning: [] }))
  await cache.get(provider, empty, true)
  await cache.get(provider, empty)
  expect(empty).toHaveBeenCalledTimes(2)
  expect(cache.peek(provider)).toEqual(presentation)
  const failing = vi.fn<() => Promise<ModelCatalog>>(async () => {
    throw new Error('offline')
  })
  await expect(cache.get(provider, failing)).rejects.toThrow('offline')
  await expect(cache.get(provider, failing)).rejects.toThrow('offline')
  expect(failing).toHaveBeenCalledTimes(2)
  expect(cache.peek(provider)).toEqual(presentation)
  await cache.get(provider, async () => catalog)
  await expect(cache.get(provider, failing, true)).rejects.toThrow('offline')
  await expect(cache.get(provider, failing)).rejects.toThrow('offline')
})

it('rejects a late result whose captured configuration changed before cache admission', async () => {
  const { cache, db } = setup()
  const provider = key('old launch')
  const deferred = deferredPromise<ModelCatalog>()
  let current = true
  const validate = () => {
    if (!current) throw new Error('configuration changed')
  }
  const first = cache.get(provider, () => deferred.promise, false, validate)
  const second = cache.get(provider, () => deferred.promise, false, validate)
  current = false
  deferred.resolve(catalog)
  await expect(first).rejects.toThrow('configuration changed')
  await expect(second).rejects.toThrow('configuration changed')
  expect(cache.peek(provider)).toBeNull()
  expect(db.prepare('SELECT * FROM model_catalog_cache').all()).toEqual([])
  current = true
  expect(await cache.get(provider, async () => catalog, false, validate)).toEqual(catalog)
})

it('bounds SQLite and memory to 64 catalogs, including timestamp ties', async () => {
  const { cache, db } = setup()
  vi.spyOn(Date, 'now').mockReturnValue(0)
  for (let index = 0; index < 65; index++) await cache.get(key(String(index)), async () => catalog)
  expect(db.prepare('SELECT * FROM model_catalog_cache').all()).toHaveLength(64)
  expect(cache.peek(key('0'))).toBeNull()
  expect(cache.peek(key('64'))).toEqual(presentation)
  const load = vi.fn<() => Promise<ModelCatalog>>(async () => catalog)
  await cache.get(key('0'), load)
  expect(load).toHaveBeenCalledTimes(1)
})

it('ignores invalid persisted catalogs and persistence failure never defeats live discovery', async () => {
  const { db, cache } = setup()
  const provider = key('provider')
  for (const value of ['{"models":"bad"}', 'invalid JSON']) {
    db.prepare('INSERT INTO model_catalog_cache VALUES(?,?,?)').run(provider, value, 0)
    expect(cache.peek(provider)).toBeNull()
    expect(db.prepare('SELECT * FROM model_catalog_cache').all()).toEqual([])
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  db.exec(
    "CREATE TRIGGER reject_catalog BEFORE INSERT ON model_catalog_cache BEGIN SELECT RAISE(FAIL, 'read-only cache'); END",
  )
  expect(await cache.get(provider, async () => catalog)).toEqual(catalog)
  expect(cache.peek(provider)).toEqual(presentation)
  expect(warn).toHaveBeenCalledWith('Could not save model catalog presentation')
})

it('bounds concurrent discovery across distinct accounts without breaking same-key deduplication', async () => {
  const { cache } = setup()
  const deferred = deferredPromise<ModelCatalog>()
  const load = vi.fn<() => Promise<ModelCatalog>>(() => deferred.promise)
  const requests = Array.from({ length: 64 }, (_, index) => cache.get(key(String(index)), load))
  const joined = cache.get(key('0'), load)
  await expect(cache.get(key('overflow'), load)).rejects.toThrow('Too many model discoveries')
  expect(load).toHaveBeenCalledTimes(64)
  deferred.resolve(catalog)
  expect(await Promise.all(requests)).toHaveLength(64)
  expect(await joined).toEqual(catalog)
  expect(await cache.get(key('overflow'), load)).toEqual(catalog)
})

it('hashes effective account/launch configuration and targets snapshot generations', async () => {
  let settings = decode(commandsSchema, {})
  const registry = new AgentRegistry(() => settings)
  cleanup.push(() => registry.dispose())
  const agent = { ...defaultTaskHarness('codex'), env: { TOKEN: 'private-secret' } }
  const first = configuredModelCatalogKey(agent, registry)
  expect(first).toMatch(/^[a-f0-9]{64}$/)
  expect(configuredModelCatalogKey({ ...agent, model: 'another' }, registry)).toBe(first)
  expect(configuredModelCatalogKey({ ...agent, env: { TOKEN: 'other' } }, registry)).not.toBe(first)
  const generations = modelCatalogGenerations(registry, [])
  settings = { ...settings, codex: '/different/codex', shell: '/different/shell' }
  const changed = modelCatalogGenerations(registry, [])
  expect(changed.codex).not.toBe(generations.codex)
  expect(changed.claude).toBe(generations.claude)
  expect(configuredModelCatalogKey(agent, registry)).not.toBe(first)
  settings = { ...settings, acp: '/manual/acp' }
  const manualAcp = modelCatalogGenerations(registry, [])
  expect(manualAcp.acp).not.toBe(changed.acp)
  expect(manualAcp.codex).toBe(changed.codex)
})

it('scopes managed ACP cache and generations to the selected launch and installation revision', async () => {
  const selected = {
    id: 'selected',
    registryId: 'selected',
    name: 'A',
    version: '1',
    installedAt: 'today',
    distribution: 'binary' as const,
  }
  const other = { ...selected, id: 'other', name: 'Other' }
  let launch = { command: '/managed/selected', args: ['run'], env: { TOKEN: 'private-secret' } }
  const registry = new AgentRegistry(undefined, (id) =>
    id === 'selected' ? launch : { command: '/managed/other', args: [], env: {} },
  )
  cleanup.push(() => registry.dispose())
  const agent = {
    ...defaultTaskHarness('acp'),
    acpInstallationId: selected.id,
    acpConfig: { account: 'private-account' },
  }
  const installations = [selected, other]
  const first = configuredModelCatalogKey(agent, registry, installations)
  const generations = modelCatalogGenerations(registry, installations)
  expect(configuredModelCatalogKey(agent, registry, [selected, { ...other, version: '2' }])).toBe(
    first,
  )
  expect(
    configuredModelCatalogKey(agent, registry, [{ ...selected, name: 'Renamed' }, other]),
  ).toBe(first)
  expect(
    configuredModelCatalogKey(agent, registry, [{ ...selected, installedAt: 'later' }, other]),
  ).not.toBe(first)
  expect(
    configuredModelCatalogKey({ ...agent, acpConfig: { account: 'new' } }, registry, installations),
  ).not.toBe(first)
  launch = { ...launch, env: { TOKEN: 'new-account' } }
  const changed = modelCatalogGenerations(registry, installations)
  expect(changed['acp:selected']).not.toBe(generations['acp:selected'])
  expect(changed['acp:other']).toBe(generations['acp:other'])
  expect(changed.codex).toBe(generations.codex)
  expect(JSON.stringify(changed)).not.toMatch(/new-account|private-account|managed/)
})
