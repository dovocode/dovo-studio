import { afterEach, expect, it, vi } from 'vitest'
import type { AcpLaunch } from './types.js'
import { AgentRegistry } from './registry.js'
import { acpAdapter } from './providers/acp.js'
import { decode, commandsSchema } from '@dovo/protocol'

afterEach(() => vi.restoreAllMocks())
it('resolves each managed ACP independently while preserving custom executables', async () => {
  const resolve = vi.fn<(id: string) => AcpLaunch>((id) => {
    if (id === 'missing') throw new Error('ACP installation not found')
    return { command: `/managed/${id}`, args: ['--acp'], env: { AGENT: id } }
  })
  const registry = new AgentRegistry(() => decode(commandsSchema, {}), resolve)
  const models = vi.spyOn(acpAdapter, 'models').mockResolvedValue({ models: [], reasoning: [] })
  try {
    const adapter = await registry.get('acp')
    for (const id of ['first', 'second']) {
      const discovery = {
        provider: 'acp' as const,
        endpoint: '/legacy',
        model: '',
        acpInstallationId: id,
      }
      await adapter.models?.(discovery)
      expect(models).toHaveBeenLastCalledWith(discovery, {
        command: `/managed/${id}`,
        args: ['--acp'],
        env: { AGENT: id },
      })
    }
    await adapter.models?.({
      provider: 'acp',
      endpoint: '/custom/agent',
      args: ['serve'],
      model: '',
    })
    expect(models).toHaveBeenLastCalledWith(
      { provider: 'acp', endpoint: '/custom/agent', args: ['serve'], model: '' },
      undefined,
    )
    expect(() =>
      adapter.models?.({
        provider: 'acp',
        endpoint: '/legacy',
        model: '',
        acpInstallationId: 'missing',
      }),
    ).toThrow('installation not found')
    expect(models).toHaveBeenCalledTimes(3)
  } finally {
    await registry.dispose()
  }
})
