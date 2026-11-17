import { expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'

it('scans resolved transcript directories without resolving unrelated secrets or falling back on failures', async () => {
  const token = randomBytes(32).toString('base64url'),
    f = await fixture()
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    vi.stubEnv('DOVO_TEST_TRANSCRIPT_HOME', '/configured-transcripts')
    runtime.services.store.update(() => ({
      ...f.workspace,
      agents: f.workspace.agents.map((agent) => ({
        ...agent,
        envSecrets: {
          CODEX_HOME: { provider: 'environment' as const, reference: 'DOVO_TEST_TRANSCRIPT_HOME' },
          API_KEY: { provider: 'onepassword' as const, reference: 'op://vault/item/secret' },
        },
      })),
    }))
    vi.spyOn(runtime.services.store.usagePricing, 'refresh').mockResolvedValue(undefined)
    const read = vi
      .spyOn(runtime.services.store.usageTranscripts, 'read')
      .mockResolvedValue({ records: [], notices: [] })
    const call = () =>
      fetch(`http://127.0.0.1:${runtime.port}/api/usage/history/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: new Date().toISOString() }),
      })
    expect((await call()).status).toBe(200)
    expect(read.mock.calls[0]?.[0].find((agent) => agent.id === 'agent')).toMatchObject({
      env: { CODEX_HOME: '/configured-transcripts' },
      envSecrets: undefined,
    })
    vi.stubEnv('DOVO_TEST_TRANSCRIPT_HOME', undefined)
    runtime.services.agents.secretReferences.refresh()
    expect(await (await call()).json()).toMatchObject({
      notices: [expect.stringContaining('Could not resolve transcript directories')],
    })
    expect(read.mock.calls[1]?.[0].find((agent) => agent.id === 'agent')).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    await runtime.close()
    await f.cleanup()
  }
})

it('exports stored records beyond the chart range without scanning transcripts and validates retention changes', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const usage = runtime.services.store.usage
  const scanning = vi.spyOn(runtime.services.store.usageTranscripts, 'read')
  const post = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  try {
    usage.recordExternal([
      {
        taskId: 'old',
        title: 'Old usage',
        origin: 'cli',
        turn: {
          id: 'old',
          assistantId: 'reply',
          agentId: 'agent',
          provider: 'codex',
          model: 'model',
          status: 'completed',
          startedAt: '2020-01-01T00:00:00.000Z',
          tokens: 50,
        },
      },
    ])
    expect((await post('/api/usage/storage/read', {}, 'wrong-token')).status).toBe(401)
    expect(await (await post('/api/usage/storage/read', {})).json()).toMatchObject({
      count: 1,
      days: null,
      oldest: '2020-01-01T00:00:00.000Z',
    })
    expect(await (await post('/api/usage/storage/export', {})).json()).toMatchObject({
      records: [{ taskId: 'old', turn: { tokens: 50 } }],
    })
    expect(scanning).not.toHaveBeenCalled()
    expect((await post('/api/usage/storage/write', { days: -1 })).status).toBe(400)
    expect(usage.storage().count).toBe(1)
    expect(await (await post('/api/usage/storage/write', { days: 90 })).json()).toMatchObject({
      count: 0,
      days: 90,
    })
    expect(await (await post('/api/usage/storage/write', { days: null })).json()).toMatchObject({
      count: 0,
      days: null,
    })
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
  }
})
