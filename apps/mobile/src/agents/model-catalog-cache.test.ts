import { expect, it, vi } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import {
  defaultTaskHarness,
  decode,
  snapshotSchema,
  workspaceSchema,
  type ModelCatalog,
  type RuntimeProfile,
} from '@dovo/protocol'
import * as protocol from '@dovo/protocol'
import {
  MobileModelCatalogCache,
  mobileModelCatalogScope,
  mobileModelCatalogScopeReader,
} from './model-catalog-cache'

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
  const key = mobileModelCatalogScope(host, agent)
  for (const other of [{ ...host, id: 'other' }])
    expect(mobileModelCatalogScope(other, agent)).not.toEqual(key)
  expect(
    mobileModelCatalogScope(
      {
        ...host,
        connection: { ...host.connection, address: 'http://other', token: 'rotated-token' },
      },
      agent,
    ),
  ).toEqual(key)
  for (const other of [
    { ...agent, provider: 'claude' as const },
    { ...agent, endpoint: '/custom' },
    { ...agent, executablePath: '/custom' },
    { ...agent, configDirectory: '/other' },
    { ...agent, args: ['--profile=other'] },
    { ...agent, env: { API_KEY: 'other' } },
  ])
    expect(mobileModelCatalogScope(host, other)).not.toEqual(key)
  expect(mobileModelCatalogScope(host, { ...agent, model: 'other' })).toEqual(key)
  const acp = { ...agent, provider: 'acp' as const, acpInstallationId: 'one' }
  for (const other of [
    { ...acp, acpInstallationId: 'two' },
    { ...acp, model: 'other' },
    { ...acp, acpMode: 'plan' },
    { ...acp, acpConfig: { option: 'other' } },
  ])
    expect(mobileModelCatalogScope(host, other)).not.toEqual(mobileModelCatalogScope(host, acp))
})

it('coalesces discovery, caches until expiry, and explicitly refreshes', async () => {
  const cache = new MobileModelCatalogCache(storage(), hash)
  const request = vi.fn<() => Promise<ModelCatalog>>(async () => catalog)
  const key = mobileModelCatalogScope(host, agent)
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
  const key = mobileModelCatalogScope(host, agent)
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
  expect(
    restored.peek(mobileModelCatalogScope(host, { ...agent, provider: 'opencode' })),
  ).toBeNull()
})

it('does not cache failed discoveries or put a late response into another harness', async () => {
  const cache = new MobileModelCatalogCache(storage(), hash)
  const key = mobileModelCatalogScope(host, agent)
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
  const otherKey = mobileModelCatalogScope(host, { ...agent, provider: 'claude' })
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
    codex: { daybreakPrograms: ['daybreakBlue'], fastModeBlocked: true },
    acp: {
      modes: [],
      commands: [],
      configOptions: [
        { id: 'token', name: 'Token', currentValue: 'private-acp-value', options: [] },
      ],
    },
  }
  await cache.load({ key: 'acp', presentationKey: 'acp' }, async () => value)
  expect(cache.peek({ key: 'acp', presentationKey: 'acp' })?.acp).toEqual(value.acp)
  await vi.waitFor(async () => expect(await saved.getItem()).toContain('GPT-5.1-Sol'))
  expect(await saved.getItem()).not.toContain('private-acp-value')
  expect(await saved.getItem()).not.toContain('daybreakBlue')
  expect(await saved.getItem()).not.toContain('fastModeBlocked')
  const restored = new MobileModelCatalogCache(saved, hash)
  await restored.ensure({ key: 'acp', presentationKey: 'acp' })
  expect(restored.peek({ key: 'acp', presentationKey: 'acp' })?.acp).toBeUndefined()
  expect(restored.peek({ key: 'acp', presentationKey: 'acp' })?.models).toEqual(catalog.models)
})

it('rehashes row metadata only for relevant runtime, launch or selected installation changes', () => {
  const snapshot = decode(snapshotSchema, {
    runtimeId: 'logical',
    runtimeInstanceId: 'boot-1',
    revision: 0,
    catalogGenerations: { codex: 'launch-1', claude: 'other', 'acp:selected': 'acp-1' },
    workspace: decode(workspaceSchema, {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
    }),
    acpInstallations: [
      {
        id: 'selected',
        registryId: 'selected',
        name: 'Selected',
        version: '1',
        installedAt: 'today',
        distribution: 'binary',
      },
      {
        id: 'other',
        registryId: 'other',
        name: 'Other',
        version: '1',
        installedAt: 'today',
        distribution: 'binary',
      },
    ],
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    owner: true,
  })
  const runtime = { profile: host, snapshot, overviews: [] }
  const compute = vi.spyOn(protocol, 'modelCatalogCacheScope')
  try {
    const select = mobileModelCatalogScopeReader(host, agent)
    const first = select(runtime)
    for (let revision = 1; revision <= 1000; revision++) {
      expect(
        select({
          ...runtime,
          snapshot: {
            ...snapshot,
            revision,
            catalogGenerations: { ...snapshot.catalogGenerations, claude: String(revision) },
            acpInstallations: snapshot.acpInstallations.map((item) => ({
              ...item,
              name: 'Renamed',
              version: 'unrelated',
            })),
            workspace: { ...snapshot.workspace, tasks: [] },
          },
        }),
      ).toBe(first)
    }
    expect(compute).toHaveBeenCalledTimes(1)
    expect(
      select({ ...runtime, snapshot: { ...snapshot, runtimeInstanceId: 'boot-2' } }),
    ).not.toEqual(first)
    expect(
      select({ ...runtime, snapshot: { ...snapshot, catalogGenerations: { codex: 'launch-2' } } }),
    ).not.toEqual(first)
    expect(compute).toHaveBeenCalledTimes(3)
    const acp = mobileModelCatalogScopeReader(host, {
      ...defaultTaskHarness('acp'),
      acpInstallationId: 'selected',
    })
    const acpFirst = acp(runtime)
    expect(
      acp({
        ...runtime,
        snapshot: {
          ...snapshot,
          acpInstallations: snapshot.acpInstallations.map((item) =>
            item.id === 'other' ? { ...item, version: '2' } : item,
          ),
        },
      }),
    ).toBe(acpFirst)
    expect(compute).toHaveBeenCalledTimes(4)
    expect(
      acp({
        ...runtime,
        snapshot: {
          ...snapshot,
          acpInstallations: snapshot.acpInstallations.map((item) =>
            item.id === 'selected' ? { ...item, version: '2' } : item,
          ),
        },
      }),
    ).not.toEqual(acpFirst)
    expect(compute).toHaveBeenCalledTimes(5)
  } finally {
    compute.mockRestore()
  }
})
