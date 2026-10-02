import { expect, it, vi } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import { defaultTaskHarness, type ModelCatalog, type RuntimeProfile } from '@dovo/protocol'
import { MobileModelCatalogCache, mobileModelCatalogKey } from './model-catalog-cache'

const catalog: ModelCatalog = {
  models: [{ id: 'gpt-5.1-sol', name: 'GPT-5.1-Sol' }],
  reasoning: [],
}
const hash = async (key: string) => createHash('sha256').update(key).digest('hex')
function storage() {
  let value: string | null = null
  return {
    getItem: async () => value,
    setItem: async (_key: string, next: string) => {
      value = next
    },
  }
}
const host: RuntimeProfile = {
  id: 'host',
  name: 'Computer',
  connection: { address: 'http://computer:8787', token: 'private-token' },
}
const agent = {
  ...defaultTaskHarness('codex'),
  model: 'gpt-5.1-sol',
  env: { API_KEY: 'private-secret' },
}

it('isolates computers, accounts, executables, environment and ACP installations', () => {
  const key = mobileModelCatalogKey(host, agent)
  for (const other of [
    { ...host, id: 'other' },
    { ...host, connection: { ...host.connection, address: 'http://other' } },
    { ...host, connection: { ...host.connection, token: 'other-account' } },
  ])
    expect(mobileModelCatalogKey(other, agent)).not.toBe(key)
  for (const other of [
    { ...agent, provider: 'claude' as const },
    { ...agent, endpoint: '/custom' },
    { ...agent, executablePath: '/custom' },
    { ...agent, configDirectory: '/other' },
    { ...agent, args: ['--profile=other'] },
    { ...agent, env: { API_KEY: 'other' } },
  ])
    expect(mobileModelCatalogKey(host, other)).not.toBe(key)
  expect(mobileModelCatalogKey(host, { ...agent, model: 'other' })).toBe(key)
  const acp = { ...agent, provider: 'acp' as const, acpInstallationId: 'one' }
  for (const other of [
    { ...acp, acpInstallationId: 'two' },
    { ...acp, model: 'other' },
    { ...acp, acpMode: 'plan' },
    { ...acp, acpConfig: { option: 'other' } },
  ])
    expect(mobileModelCatalogKey(host, other)).not.toBe(mobileModelCatalogKey(host, acp))
})

it('coalesces discovery, caches until expiry, and explicitly refreshes', async () => {
  const cache = new MobileModelCatalogCache(storage(), hash)
  const request = vi.fn<() => Promise<ModelCatalog>>(async () => catalog)
  const key = mobileModelCatalogKey(host, agent)
  await Promise.all([cache.load(key, request), cache.load(key, request)])
  await cache.load(key, request)
  expect(request).toHaveBeenCalledTimes(1)
  await cache.load(key, request, true)
  expect(request).toHaveBeenCalledTimes(2)
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001)
  try {
    await cache.load(key, request)
    expect(request).toHaveBeenCalledTimes(3)
  } finally {
    now.mockRestore()
  }
})

it('restores host labels after reload without persisting credentials or treating saved lists as fresh', async () => {
  const saved = storage()
  const key = mobileModelCatalogKey(host, agent)
  await new MobileModelCatalogCache(saved, hash).load(key, async () => catalog)
  await vi.waitFor(async () => expect(await saved.getItem()).toContain('GPT-5.1-Sol'))
  const serialized = await saved.getItem()
  expect(serialized).not.toContain('private-secret')
  expect(serialized).not.toContain('private-token')
  const restored = new MobileModelCatalogCache(saved, hash)
  await restored.ensure(key)
  expect(restored.peek(key)).toEqual(catalog)
  const request = vi.fn<() => Promise<ModelCatalog>>(async () => catalog)
  await restored.load(key, request)
  expect(request).toHaveBeenCalledTimes(1)
  expect(restored.peek(mobileModelCatalogKey(host, { ...agent, provider: 'opencode' }))).toBeNull()
})

it('does not cache failed discoveries or put a late response into another harness', async () => {
  const cache = new MobileModelCatalogCache(storage(), hash)
  const key = mobileModelCatalogKey(host, agent)
  await expect(
    cache.load(key, async () => {
      throw new Error('offline')
    }),
  ).rejects.toThrow('offline')
  expect(cache.peek(key)).toBeNull()
  let finish: (value: ModelCatalog) => void = () => {
    throw new Error('Request not started')
  }
  const pending = cache.load(
    key,
    () =>
      new Promise<ModelCatalog>((resolve) => {
        finish = resolve
      }),
  )
  await vi.waitFor(() => expect(cache.peek(key)).toBeNull())
  await Promise.resolve()
  await Promise.resolve()
  const otherKey = mobileModelCatalogKey(host, { ...agent, provider: 'claude' })
  const other = { models: [{ id: 'sonnet', name: 'Sonnet' }], reasoning: [] }
  await cache.load(otherKey, async () => other)
  finish(catalog)
  await pending
  expect(cache.peek(otherKey)).toEqual(other)
  expect(cache.peek(key)).toEqual(catalog)
})

it('keeps private ACP configuration in memory and persists only model presentation metadata', async () => {
  const saved = storage()
  const cache = new MobileModelCatalogCache(saved, hash)
  const value: ModelCatalog = {
    ...catalog,
    acp: {
      modes: [],
      commands: [],
      configOptions: [
        { id: 'token', name: 'Token', currentValue: 'private-acp-value', options: [] },
      ],
    },
  }
  await cache.load('acp', async () => value)
  expect(cache.peek('acp')?.acp).toEqual(value.acp)
  await vi.waitFor(async () => expect(await saved.getItem()).toContain('GPT-5.1-Sol'))
  expect(await saved.getItem()).not.toContain('private-acp-value')
  const restored = new MobileModelCatalogCache(saved, hash)
  await restored.ensure('acp')
  expect(restored.peek('acp')?.acp).toBeUndefined()
  expect(restored.peek('acp')?.models).toEqual(catalog.models)
})
