import { expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { startRuntime } from '../../index.js'

it('discovers through the host adapter, caches effective launch settings and supports a real refresh', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const adapter = await runtime.services.agents.get('codex')
  const models = vi.fn<(agent: AgentDiscovery) => Promise<ModelCatalog>>(async (_agent) => ({
    models: [{ id: 'host-model', name: 'Host model' }],
    reasoning: [],
  }))
  const get = vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({ ...adapter, models })
  try {
    const call = (input: Partial<AgentDiscovery> & { refresh?: boolean }) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/agents/models`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'codex', endpoint: '', model: '', ...input }),
      })
    expect((await call({})).status).toBe(200)
    expect((await call({ model: 'another-selected-model' })).status).toBe(200)
    expect(models).toHaveBeenCalledTimes(1)
    expect(await (await call({ refresh: true })).json()).toMatchObject({
      models: [{ name: 'Host model' }],
    })
    expect(models).toHaveBeenCalledTimes(2)
    runtime.services.commands.save({
      ...runtime.services.commands.get(),
      codex: '/host/custom-codex',
    })
    expect((await call({})).status).toBe(200)
    expect(models).toHaveBeenCalledTimes(3)
    expect(models.mock.calls.at(-1)?.[0]).toMatchObject({ endpoint: '/host/custom-codex' })
    expect((await call({ env: { ACCOUNT: 'different' } })).status).toBe(200)
    expect(models).toHaveBeenCalledTimes(4)
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})
