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
