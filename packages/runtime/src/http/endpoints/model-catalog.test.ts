import { expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { startRuntime } from '../../index.js'

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

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

it('authenticates cached presentation reads without activating a harness and keeps live errors visible', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const adapter = await runtime.services.agents.get('codex')
  const live: ModelCatalog = {
    models: [{ id: 'host-model', name: 'Host model' }],
    reasoning: [],
    harness: { name: 'Host', generation: 'v2' },
    acp: {
      modes: [],
      commands: [],
      configOptions: [
        { id: 'account', name: 'Account', currentValue: 'private-secret', options: [] },
      ],
    },
    codex: { fastModeBlocked: true, daybreakPrograms: ['daybreakBlue'] },
  }
  const models = vi.fn<(agent: AgentDiscovery) => Promise<ModelCatalog>>().mockResolvedValue(live)
  const get = vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({ ...adapter, models })
  const call = (cached: boolean, input = {}, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/models${cached ? '/cached' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        endpoint: '',
        model: '',
        env: { TOKEN: 'private-secret' },
        ...input,
      }),
    })
  try {
    expect((await call(true, {}, 'wrong-token')).status).toBe(401)
    expect(await (await call(true)).json()).toBeNull()
    expect(get).not.toHaveBeenCalled()
    expect(models).not.toHaveBeenCalled()
    expect(await (await call(false)).json()).toMatchObject({
      codex: live.codex,
      models: live.models,
    })
    get.mockClear()
    const presentation = await (await call(true)).json()
    expect(presentation).toEqual({ models: live.models, reasoning: [], harness: live.harness })
    expect(get).not.toHaveBeenCalled()
    expect(
      JSON.stringify(runtime.services.db.prepare('SELECT * FROM model_catalog_cache').all()),
    ).not.toMatch(/private-secret|currentValue|acp|codex/)
    models.mockRejectedValue(new Error('sign in required'))
    expect((await call(false, { refresh: true })).status).toBeGreaterThanOrEqual(400)
    expect((await call(false)).status).toBeGreaterThanOrEqual(400)
    expect(models).toHaveBeenCalledTimes(3)
    expect(await (await call(true)).json()).toEqual(presentation)
    models.mockResolvedValue({ models: [], reasoning: [] })
    expect(await (await call(false)).json()).toEqual({ models: [], reasoning: [] })
    expect(await (await call(false)).json()).toEqual({ models: [], reasoning: [] })
    expect(models).toHaveBeenCalledTimes(5)
    expect(await (await call(true)).json()).toEqual(presentation)
    expect(await (await call(true, { env: { TOKEN: 'new-account' } })).json()).toBeNull()
    runtime.services.commands.save({ ...runtime.services.commands.get(), codex: '/new/codex' })
    expect(await (await call(true)).json()).toBeNull()
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})

it('rejects discovery after a mid-flight launch change and does not persist it', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const adapter = await runtime.services.agents.get('codex')
  const entered = deferredPromise<void>()
  const released = deferredPromise<ModelCatalog>()
  const models = vi.fn<(agent: AgentDiscovery) => Promise<ModelCatalog>>(() => {
    entered.resolve()
    return released.promise
  })
  const get = vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({ ...adapter, models })
  const call = (cached: boolean) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/models${cached ? '/cached' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'codex', endpoint: '', model: '' }),
    })
  try {
    const pending = call(false)
    await entered.promise
    runtime.services.commands.save({ ...runtime.services.commands.get(), codex: '/changed/codex' })
    released.resolve({ models: [{ id: 'late', name: 'Wrong launch' }], reasoning: [] })
    expect((await pending).status).toBe(409)
    expect(runtime.services.db.prepare('SELECT * FROM model_catalog_cache').all()).toEqual([])
    expect(await (await call(true)).json()).toBeNull()
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})
