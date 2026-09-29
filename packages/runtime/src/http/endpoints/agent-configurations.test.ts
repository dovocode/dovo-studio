import { expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../../index.js'

it('shares model preferences without marking defaults configured, and preserves independent changes', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const call = (input: unknown, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/agents/models/preference`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    expect((await call({ key: 'codex:model', favorite: true }, 'invalid')).status).toBe(401)
    expect((await call({ key: 'codex:model', favorite: true })).status).toBe(200)
    expect((await call({ key: 'codex:model', disabled: true })).status).toBe(200)
    expect((await call({ key: 'acp:installed:model', favorite: true })).status).toBe(200)
    expect(runtime.services.defaults.get()).toMatchObject({
      configured: false,
      modelPreferences: {
        'codex:model': { favorite: true, disabled: true },
        'acp:installed:model': { favorite: true, disabled: false },
      },
    })
    expect((await call({ key: '', favorite: true })).status).toBe(400)
  } finally {
    await runtime.close()
  }
})

it('persists global agent baselines while keeping and resetting explicit server overrides', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const call = (path: string, input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const preset = {
      id: 'global-agent',
      name: 'Global Codex',
      provider: 'codex',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
      args: ['--verbose'],
      env: { TEST_VALUE: 'global' },
    }
    expect((await call('/api/agents/presets/apply', { presets: [preset] })).status).toBe(200)
    expect(runtime.services.store.get().agents[0]).toMatchObject({
      globalPreset: preset,
      serverOverride: false,
    })
    runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({
        ...agent,
        endpoint: '/server/codex',
        serverOverride: true,
      })),
    }))
    const changed = { ...preset, model: 'new-model' }
    expect((await call('/api/agents/presets/apply', { presets: [changed] })).status).toBe(200)
    expect(runtime.services.store.get().agents[0]).toMatchObject({
      endpoint: '/server/codex',
      model: '',
      globalPreset: changed,
      serverOverride: true,
    })
    expect((await call('/api/agents/presets/reset', { id: preset.id })).status).toBe(200)
    expect(runtime.services.store.get().agents[0]).toMatchObject({
      endpoint: '',
      model: 'new-model',
      serverOverride: false,
    })
    await call('/api/agents/presets/apply', { presets: [], retired: [preset.id] })
    expect(runtime.services.store.get().agents[0].globalPreset).toBeUndefined()
    expect(runtime.services.store.get().agents[0].model).toBe('new-model')
    expect(
      (
        await call('/api/agents/presets/apply', {
          presets: [{ ...preset, env: { 'invalid-name': 'value' } }],
        })
      ).status,
    ).toBe(400)
  } finally {
    await runtime.close()
  }
})
it('inherits global model preferences, preserves server overrides, and ignores stale global updates', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const call = (path: string, input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const key = 'codex:model'
    const apply = (stamp: number, favorite: boolean) =>
      call('/api/agents/presets/apply', {
        presets: [],
        modelPreferences: { [key]: { favorite, disabled: false } },
        modelPreferencesUpdatedAt: stamp,
      })
    expect((await apply(1, true)).status).toBe(200)
    expect(runtime.services.defaults.get().modelPreferences?.[key]?.favorite).toBe(true)
    expect((await call('/api/agents/models/preference', { key, favorite: false })).status).toBe(200)
    await apply(3, true)
    expect(runtime.services.defaults.get().modelPreferences?.[key]?.favorite).toBe(false)
    await call('/api/agents/models/reset', {})
    expect(runtime.services.defaults.get().modelPreferences?.[key]?.favorite).toBe(true)
    await apply(2, false)
    expect(runtime.services.defaults.get().globalModelPreferencesUpdatedAt).toBe(3)
    expect(runtime.services.defaults.get().modelPreferences?.[key]?.favorite).toBe(true)
  } finally {
    await runtime.close()
  }
})
