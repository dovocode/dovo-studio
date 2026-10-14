import { afterEach, expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness, type Agent, type ProviderStatus } from '@dovo/protocol'
import { AgentRegistry } from '../configuration/registry.js'
import { HarnessAvailabilityCache } from './harness-availability.js'

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())
it('coalesces probes, expires results, and invalidates when the effective configuration changes', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const registry = new AgentRegistry()
  const adapter = await registry.get('codex')
  const probe = vi.fn<(agent: Agent) => Promise<ProviderStatus>>(async (_agent) => ({
    provider: 'codex' as const,
    available: true,
    detail: '',
  }))
  vi.spyOn(registry, 'get').mockResolvedValue({ ...adapter, probe })
  const cache = new HarnessAvailabilityCache()
  const agent = { ...defaultTaskHarness('codex'), id: 'a', name: 'A' }
  try {
    expect(await Promise.all([cache.check(agent, registry), cache.check(agent, registry)])).toEqual(
      [true, true],
    )
    expect(probe).toHaveBeenCalledTimes(1)
    await cache.check({ ...agent, name: 'Renamed', model: 'other' }, registry)
    expect(probe).toHaveBeenCalledTimes(1)
    now = 30_001
    await cache.check(agent, registry)
    expect(probe).toHaveBeenCalledTimes(2)
    await cache.check({ ...agent, env: { ACCOUNT: 'other' } }, registry)
    expect(probe).toHaveBeenCalledTimes(3)
    await cache.check({ ...agent, env: { ACCOUNT: 'other' } }, registry, true)
    expect(probe).toHaveBeenCalledTimes(4)
  } finally {
    await registry.dispose()
  }
})

it('keeps missing ACP installations unavailable without failing other choices', async () => {
  const registry = new AgentRegistry(undefined, () => {
    throw new Error('Missing installation')
  })
  const cache = new HarnessAvailabilityCache()
  expect(
    await cache.check(
      { ...defaultTaskHarness('acp'), acpInstallationId: 'missing', id: 'a', name: 'Missing' },
      registry,
    ),
  ).toBe(false)
  await registry.dispose()
})

it('retries unavailable and error results immediately while still coalescing concurrent probes', async () => {
  const registry = new AgentRegistry()
  const adapter = await registry.get('codex')
  const agent = { ...defaultTaskHarness('codex'), id: 'a', name: 'A' }
  const probe = vi
    .fn<(agent: Agent) => Promise<ProviderStatus>>()
    .mockRejectedValueOnce(new Error('sign in'))
    .mockResolvedValueOnce({ provider: 'codex', available: false, detail: 'signed out' })
    .mockResolvedValue({ provider: 'codex', available: true, detail: '' })
  vi.spyOn(registry, 'get').mockResolvedValue({ ...adapter, probe })
  const cache = new HarnessAvailabilityCache()
  try {
    expect(await Promise.all([cache.check(agent, registry), cache.check(agent, registry)])).toEqual(
      [false, false],
    )
    expect(probe).toHaveBeenCalledTimes(1)
    expect(await cache.check(agent, registry)).toBe(false)
    expect(await cache.check(agent, registry)).toBe(true)
    expect(await cache.check(agent, registry)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(3)
    probe.mockRejectedValueOnce(new Error('signed out again'))
    expect(await cache.check(agent, registry, true)).toBe(false)
    expect(await cache.check(agent, registry)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(5)
  } finally {
    await registry.dispose()
  }
})

it('bounds shared active probes and rejects changed configuration without caching ready', async () => {
  const registry = new AgentRegistry()
  const adapter = await registry.get('codex')
  let active = 0
  let maximum = 0
  const release = deferredPromise<void>()
  const started = deferredPromise<void>()
  const probe = vi.fn<(agent: Agent) => Promise<ProviderStatus>>(async () => {
    active++
    maximum = Math.max(maximum, active)
    if (active === 4) started.resolve()
    await release.promise
    active--
    return { provider: 'codex', available: true, detail: '' }
  })
  vi.spyOn(registry, 'get').mockResolvedValue({ ...adapter, probe })
  const cache = new HarnessAvailabilityCache()
  try {
    const promises = Array.from({ length: 128 }, (_, index) =>
      cache.check(
        {
          ...defaultTaskHarness('codex'),
          id: String(index),
          name: '',
          env: { ACCOUNT: String(index) },
        },
        registry,
      ),
    )
    await started.promise
    expect(probe).toHaveBeenCalledTimes(4)
    expect(
      await cache.check(
        { ...defaultTaskHarness('codex'), id: 'overflow', name: '', env: { ACCOUNT: 'overflow' } },
        registry,
      ),
    ).toBe(false)
    release.resolve()
    expect(await Promise.all(promises)).toEqual(Array.from({ length: 128 }, () => true))
    expect(maximum).toBe(4)
    const deferred = deferredPromise<ProviderStatus>()
    probe.mockImplementationOnce(() => deferred.promise)
    const agent = { ...defaultTaskHarness('codex'), id: 'new', name: '', env: { ACCOUNT: 'new' } }
    const current = cache.check(agent, registry)
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(129))
    agent.env.ACCOUNT = 'changed'
    deferred.resolve({ provider: 'codex', available: true, detail: '' })
    expect(await current).toBe(false)
    expect(await cache.check(agent, registry)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(130)
  } finally {
    await registry.dispose()
  }
})
