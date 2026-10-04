import { expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../../index.js'
import {
  defaultTaskHarness,
  decode,
  harnessAvailabilitySchema,
  type Agent,
  type ProviderStatus,
} from '@dovo/protocol'

it('probes configured providers independently, authenticates, caches and never exposes credentials', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const base = await runtime.services.agents.get('codex')
  const probe = vi.fn<(agent: Agent) => Promise<ProviderStatus>>(async (agent) => {
    const configured = runtime.services.agents.configure(agent)
    if (agent.provider === 'muse') throw new Error('private credential')
    return {
      provider: agent.provider,
      available: configured.endpoint === '/custom/codex' || agent.provider === 'claude',
      detail: 'private credential',
    }
  })
  const get = vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({ ...base, probe })
  try {
    runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: [
        {
          ...defaultTaskHarness('codex'),
          id: 'custom',
          name: 'Custom',
          endpoint: '/custom/codex',
          env: { SECRET: 'private credential' },
        },
      ],
    }))
    const call = (credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/agents/availability`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    expect((await call('invalid')).status).toBe(401)
    expect(probe).not.toHaveBeenCalled()
    const response = await call()
    expect(response.status).toBe(200)
    const entries = decode(harnessAvailabilitySchema, await response.json())
    expect(entries.filter((entry) => entry.available).map((entry) => entry.id)).toEqual([
      'harness:claude',
      'agent:custom',
    ])
    expect(JSON.stringify(entries)).not.toContain('private credential')
    const calls = probe.mock.calls.length
    await call()
    expect(probe).toHaveBeenCalledTimes(calls)
    runtime.services.commands.save({ ...runtime.services.commands.get(), codex: '/custom/codex' })
    const changed = decode(harnessAvailabilitySchema, await (await call()).json())
    expect(changed.find((entry) => entry.id === 'harness:codex')?.available).toBe(true)
    expect(probe).toHaveBeenCalledTimes(calls + 1)
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})
