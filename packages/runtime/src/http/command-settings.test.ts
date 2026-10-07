import { expect, it } from 'vite-plus/test'
import { startRuntime } from '../index.js'

it('protects concurrent CLI settings edits and accepts older client saves', async () => {
  const token = 'command-settings-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const call = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/commands/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    const original = (await call('read', {})).body.settings
    expect(
      (await call('save', { before: original, after: { ...original, git: '/custom/git' } })).status,
    ).toBe(200)
    expect(
      (await call('save', { before: original, after: { ...original, gh: '/custom/gh' } })).status,
    ).toBe(409)
    expect((await call('read', {})).body.settings).toMatchObject({
      git: '/custom/git',
      gh: original.gh,
    })
    expect((await call('save', { ...original, shell: '/bin/zsh' })).status).toBe(200)
    const current = (await call('read', {})).body.settings
    expect(current).toMatchObject({ cua: '', cuaEnabled: false })
    expect(
      (
        await call('save', {
          before: current,
          after: { ...current, cua: '/missing/cua-driver', cuaEnabled: true },
        })
      ).body.settings,
    ).toMatchObject({ cua: '/missing/cua-driver', cuaEnabled: true })
    expect((await call('cua/check', { path: '/missing/cua-driver' })).body).toMatchObject({
      available: false,
      path: null,
      version: null,
    })
    expect((await call('cua/check', { path: 'cua-driver\nother' })).status).toBe(400)
    expect(
      (await call('cua/action', { path: '/missing/cua-driver', action: 'arbitrary-command' }))
        .status,
    ).toBe(400)
    expect((await call('cua/action', { path: 'cua-driver\nother', action: 'stop' })).status).toBe(
      400,
    )
  } finally {
    await runtime.close()
  }
})
