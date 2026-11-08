import { afterEach, expect, it, vi } from 'vite-plus/test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AcpLaunch } from '../execution/types.js'
import { AgentRegistry } from './registry.js'
import * as acpModule from '../providers/acp/acp.js'
import type { AgentAdapter } from '../execution/types.js'
import { decode, commandsSchema, defaultTaskHarness } from '@dovo/protocol'

afterEach(() => vi.restoreAllMocks())
it('resolves external credentials only at the adapter boundary for model discovery and probes', async () => {
  vi.stubEnv('DOVO_TEST_PROVIDER_REFERENCE', 'synthetic-credential')
  const models = vi
    .fn<NonNullable<AgentAdapter['models']>>()
    .mockResolvedValue({ models: [], reasoning: [] })
  const probe = vi
    .fn<AgentAdapter['probe']>()
    .mockResolvedValue({ provider: 'acp', available: true, detail: '' })
  vi.spyOn(acpModule, 'createAcpAdapter').mockReturnValue({
    run: vi.fn<AgentAdapter['run']>(),
    models,
    probe,
  })
  const registry = new AgentRegistry()
  const agent = {
    ...defaultTaskHarness('acp'),
    id: 'agent',
    name: 'Agent',
    envSecrets: {
      API_KEY: { provider: 'environment' as const, reference: 'DOVO_TEST_PROVIDER_REFERENCE' },
    },
  }
  try {
    expect(registry.configure(agent).envSecrets).toEqual(agent.envSecrets)
    expect(registry.configure(agent).env?.API_KEY).toBeUndefined()
    const adapter = await registry.get('acp')
    await adapter.models?.(agent)
    await adapter.probe(agent)
    for (const call of [models.mock.calls[0], probe.mock.calls[0]]) {
      expect(call?.[0].env?.API_KEY).toBe('synthetic-credential')
      expect(call?.[0].envSecrets).toBeUndefined()
    }
    expect(agent).not.toHaveProperty('env')
    const generation = registry.secretGeneration
    registry.secretReferences.refresh()
    expect(registry.secretGeneration).toBe(generation + 1)
  } finally {
    await registry.dispose()
    vi.unstubAllEnvs()
  }
})
it('releases loaded task providers and reports cleanup failures', async () => {
  const releaseTask = vi.fn<NonNullable<AgentAdapter['releaseTask']>>().mockResolvedValue()
  vi.spyOn(acpModule, 'createAcpAdapter').mockReturnValue({
    run: vi.fn<AgentAdapter['run']>(),
    probe: vi.fn<AgentAdapter['probe']>(),
    releaseTask,
  })
  const registry = new AgentRegistry()
  try {
    await registry.get('acp')
    await registry.releaseTask('child')
    expect(releaseTask).toHaveBeenCalledWith('child')
    releaseTask.mockRejectedValue(new Error('Process did not stop'))
    await expect(registry.releaseTask('child')).rejects.toThrow('Could not release task providers')
  } finally {
    await registry.dispose()
  }
})
it('uses the Hermes launcher by default and preserves explicit Python overrides', () => {
  const registry = new AgentRegistry()
  const agent = { provider: 'hermes' as const, endpoint: '', model: '' }
  expect(registry.configure(agent).endpoint).toBe('hermes')
  expect(registry.configure({ ...agent, env: { HERMES_PYTHON: '/env/bin/python' } }).endpoint).toBe(
    '/env/bin/python',
  )
  expect(
    registry.configure({
      ...agent,
      endpoint: '/home/agentic/.local/bin/hermes',
      env: { HERMES_PYTHON: '/env/bin/python' },
    }).endpoint,
  ).toBe('/home/agentic/.local/bin/hermes')
})
it('resolves each managed ACP independently while preserving custom executables', async () => {
  const resolve = vi.fn<(id: string) => AcpLaunch>((id) => {
    if (id === 'missing') throw new Error('ACP installation not found')
    return { command: `/managed/${id}`, args: ['--acp'], env: { AGENT: id } }
  })
  const registry = new AgentRegistry(() => decode(commandsSchema, {}), resolve)
  const models = vi
    .fn<NonNullable<AgentAdapter['models']>>()
    .mockResolvedValue({ models: [], reasoning: [] })
  vi.spyOn(acpModule, 'createAcpAdapter').mockImplementation(() => ({
    ...acpModule.acpAdapter,
    models,
  }))
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
it('merges installed ACP defaults with explicit launch overrides', () => {
  const registry = new AgentRegistry(
    () => decode(commandsSchema, {}),
    () => ({
      command: '/installed/agent',
      args: ['--acp'],
      env: { DEFAULT: 'kept', OVERRIDE: 'old' },
    }),
  )
  expect(
    registry.launch({
      provider: 'acp',
      endpoint: '/legacy',
      executablePath: '/custom/agent',
      model: '',
      acpInstallationId: 'agent',
      args: ['--verbose'],
      env: { OVERRIDE: 'new' },
    }),
  ).toEqual({
    command: '/custom/agent',
    args: ['--acp', '--verbose'],
    env: { DEFAULT: 'kept', OVERRIDE: 'new' },
  })
})
it('expands provider config directories without changing HOME or caller environment', () => {
  const registry = new AgentRegistry()
  const agent = {
    provider: 'claude' as const,
    endpoint: 'claude',
    configDirectory: '~/claude-work',
    model: '',
    env: { EXTRA: 'kept' },
  }
  const configured = registry.configure(agent)
  expect(configured.configDirectory).toBe(join(homedir(), 'claude-work'))
  expect(configured.env).toMatchObject({
    EXTRA: 'kept',
    CLAUDE_CONFIG_DIR: expect.stringMatching(/\/claude-work$/),
  })
  expect(configured.env).not.toHaveProperty('HOME')
  expect(agent.env).toEqual({ EXTRA: 'kept' })
})
it('expands the Copilot SDK base directory', () => {
  const registry = new AgentRegistry()
  expect(
    registry.configure({
      provider: 'copilot',
      model: '',
      endpoint: 'copilot',
      configDirectory: '~/copilot-work',
    }).configDirectory,
  ).toBe(join(homedir(), 'copilot-work'))
})
it('activates the Cursor SDK without resolving a CLI command or mutating its credentials', async () => {
  const registry = new AgentRegistry()
  try {
    const agent = {
      provider: 'cursor' as const,
      endpoint: '/ignored-cli',
      model: 'example',
      env: { CURSOR_API_KEY: 'private' },
    }
    expect(registry.configure(agent)).toEqual({ ...agent, endpoint: '' })
    expect(await registry.get('cursor')).toMatchObject({
      run: expect.any(Function),
      models: expect.any(Function),
      probe: expect.any(Function),
    })
    expect(process.env.CURSOR_API_KEY).not.toBe('private')
  } finally {
    await registry.dispose()
  }
})

it('finishes provider and host disposal when secret command shutdown fails', async () => {
  const dispose = vi.fn<NonNullable<AgentAdapter['dispose']>>().mockResolvedValue()
  vi.spyOn(acpModule, 'createAcpAdapter').mockReturnValue({
    run: vi.fn<AgentAdapter['run']>(),
    probe: vi.fn<AgentAdapter['probe']>(),
    dispose,
  })
  const registry = new AgentRegistry()
  await registry.get('acp')
  vi.spyOn(registry.secretReferences, 'close').mockRejectedValue(
    new Error('Secret command shutdown is unconfirmed'),
  )
  const host = vi.spyOn(registry.host, 'dispose')
  await expect(registry.dispose()).rejects.toThrow('Could not close all agent providers')
  expect(dispose).toHaveBeenCalledOnce()
  expect(host).toHaveBeenCalledOnce()
})
