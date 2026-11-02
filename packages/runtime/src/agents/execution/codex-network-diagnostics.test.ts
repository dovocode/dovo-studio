import { expect, it, vi } from 'vite-plus/test'
import { commandsSchema, decode } from '@dovo/protocol'
import { codexNetworkDiagnostics } from './codex-network-diagnostics.js'
const exec = vi.hoisted(() => vi.fn<typeof import('../../process.js').exec>())
vi.mock('../../process.js', () => ({
  exec,
  processEnvironment: (env = {}) => ({ PATH: '/bin', ...env }),
}))
it('runs only network diagnostics on the configured executable with bounded resources', async () => {
  exec.mockResolvedValueOnce({ stdout: 'WebSocket OK', stderr: '' })
  expect(
    await codexNetworkDiagnostics(decode(commandsSchema, { codex: '/opt/codex with spaces' })),
  ).toMatchObject({ ok: true, output: 'WebSocket OK\n' })
  expect(exec).toHaveBeenCalledWith(
    '/opt/codex with spaces',
    ['doctor', '--network-only'],
    expect.objectContaining({ timeout: 30000, maxBuffer: 131072, env: { PATH: '/bin' } }),
  )
})
it('uses custom environments and removes credentials from both successful and failed output', async () => {
  const env = { API_KEY: 'private-fixture-value' }
  const agent = { provider: 'codex' as const, endpoint: '/custom/codex', model: '', env }
  exec.mockResolvedValueOnce({
    stdout: 'API_KEY=private-fixture-value https://host/path?token=secret\nprivate-fixture-value',
    stderr: 'Authorization: Bearer secret',
  })
  const result = await codexNetworkDiagnostics(decode(commandsSchema, {}), agent)
  expect(result.output).not.toMatch(/private-fixture-value|Bearer secret|token=secret/)
  expect(exec.mock.calls.at(-1)?.[0]).toBe('/custom/codex')
  exec.mockRejectedValueOnce({ stdout: 'WebSocket failed', stderr: 'Authorization: Bearer secret' })
  expect(await codexNetworkDiagnostics(decode(commandsSchema, {}))).toMatchObject({
    ok: false,
    output: expect.stringContaining('WebSocket failed'),
  })
})
it('propagates cancellation instead of reporting a network failure', async () => {
  const controller = new AbortController()
  exec.mockImplementationOnce(async () => {
    controller.abort(new Error('Stopped'))
    throw controller.signal.reason
  })
  await expect(
    codexNetworkDiagnostics(decode(commandsSchema, {}), undefined, controller.signal),
  ).rejects.toThrow('Stopped')
})
