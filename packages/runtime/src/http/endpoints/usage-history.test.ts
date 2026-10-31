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
