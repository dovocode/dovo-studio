import { afterEach, expect, it, vi } from 'vite-plus/test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AcpLaunch } from '../execution/types.js'
import { AgentRegistry } from './registry.js'
import * as acpModule from '../providers/acp/acp.js'
import type { AgentAdapter } from '../execution/types.js'
import { decode, commandsSchema } from '@dovo/protocol'

afterEach(() => vi.restoreAllMocks())
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
