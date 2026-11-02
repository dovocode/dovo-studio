import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index.js'
import { agentSchema, decode } from '@dovo/protocol'
const check = vi.hoisted(() =>
  vi.fn<typeof import('./codex-network-diagnostics.js').codexNetworkDiagnostics>(async () => ({
    ok: true,
    durationMs: 4,
    output: 'WebSocket OK',
  })),
)
vi.mock('./codex-network-diagnostics.js', () => ({ codexNetworkDiagnostics: check }))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
it('authenticates explicit diagnostics and returns the result for the selected configured Codex', async () => {
  const token = 'diagnostic-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: [
      ...workspace.agents,
      decode(agentSchema, {
        id: 'custom-codex',
        name: 'Custom Codex',
        provider: 'codex',
        endpoint: '/custom/codex',
        model: '',
        instructions: '',
        permission: 'ask',
        env: { CODEX_HOME: '/custom/config' },
      }),
    ],
  }))
  const call = (body: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/codex/network-diagnostics`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect((await call({}, 'invalid')).status).toBe(401)
  expect(check).not.toHaveBeenCalled()
  expect((await call({ agentId: 'missing' })).status).toBe(400)
  const result = await call({ agentId: 'custom-codex' })
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({ ok: true, durationMs: 4, output: 'WebSocket OK' })
  expect(check).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ endpoint: '/custom/codex', env: { CODEX_HOME: '/custom/config' } }),
  )
})
