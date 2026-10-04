import { afterEach, expect, it, vi } from 'vitest'
import { defaultTaskHarness, type Agent, type ProviderStatus } from '@dovo/protocol'
import { AgentRegistry } from '../configuration/registry.js'
import { HarnessAvailabilityCache } from './harness-availability.js'

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
