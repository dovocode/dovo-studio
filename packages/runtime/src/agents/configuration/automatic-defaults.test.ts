import type { AgentAdapter } from '../execution/types'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import {
  defaultTaskHarness,
  titleSettingsForHarness,
  configuredTaskHarness,
  type ModelCatalog,
} from '@dovo/protocol'
import { initializeAgentDefaults, latestCodexModel } from './automatic-defaults'

const catalog: ModelCatalog = {
  models: [
    { id: 'gpt-6-sol', name: 'Sol' },
    { id: 'gpt-6.2-luna', name: 'Luna' },
    { id: 'gpt-6.1-sol', name: 'Sol' },
    { id: 'gpt-7-sol', name: 'Hidden preview', hidden: true },
    { id: 'gpt-5.6-luna', name: 'Luna' },
    { id: 'gpt-6-astra', name: 'Astra', isDefault: true },
  ],
  reasoning: [],
}
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(closers.splice(0).map((close) => close()))
})
async function fixture(available: boolean) {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  closers.push(runtime.close)
  const probe = vi.fn<AgentAdapter['probe']>(async () => ({
    provider: 'codex' as const,
    available,
    detail: '',
  }))
  const models = vi.fn<NonNullable<AgentAdapter['models']>>(async () => catalog)
  const get = vi
    .spyOn(runtime.services.agents, 'get')
    .mockResolvedValue({ probe, models, run: async () => {} })
  return { ...runtime.services, probe, models, get }
}

it('uses the latest visible family version rather than catalogue order or provider default', () => {
  expect(latestCodexModel(catalog, 'sol')).toBe('gpt-6.1-sol')
  expect(latestCodexModel(catalog, 'luna')).toBe('gpt-6.2-luna')
})

it('configures Codex Sol medium and independent Luna low without requiring setup', async () => {
  const s = await fixture(true)
  await initializeAgentDefaults(s)
  expect(s.defaults.get()).toMatchObject({
    configured: true,
    harness: { provider: 'codex', model: 'gpt-6.1-sol', reasoning: 'medium' },
  })
  expect(s.store.taskDefaults(undefined)).toMatchObject({
    harness: { provider: 'codex', model: 'gpt-6.1-sol', reasoning: 'medium' },
  })
  expect(s.titles.read()).toMatchObject({
    harness: { provider: 'codex' },
    model: 'gpt-6.2-luna',
    reasoning: 'low',
  })
  s.get.mockClear()
  await initializeAgentDefaults(s)
  expect(s.get).not.toHaveBeenCalled()
})

it('uses Claude latest aliases when Codex is not available', async () => {
  const s = await fixture(false)
  await initializeAgentDefaults(s)
  expect(configuredTaskHarness(s.defaults.get())).toMatchObject({
    provider: 'claude',
    model: 'opus',
    reasoning: 'medium',
  })
  expect(s.titles.read()).toMatchObject({
    harness: { provider: 'claude' },
    model: 'sonnet',
    reasoning: 'low',
  })
  expect(s.models).not.toHaveBeenCalled()
})

it('preserves explicit task and title choices, including intentionally empty title models', async () => {
  const s = await fixture(true)
  s.defaults.save({
    ...s.defaults.get(),
    harness: { ...defaultTaskHarness('claude'), model: 'custom-opus', reasoning: 'high' },
  })
  const titles = titleSettingsForHarness({
    ...defaultTaskHarness('claude'),
    id: 'custom',
    name: 'Custom',
  })
  s.titles.save(titles)
  await initializeAgentDefaults(s)
  expect(s.get).not.toHaveBeenCalled()
  expect(s.defaults.get().harness.model).toBe('custom-opus')
  expect(s.titles.read()).toEqual(titles)
})

it('preserves scoped permissions, execution and project overrides during first-run initialization', async () => {
  const s = await fixture(true)
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: {
        environment: {
          taskDefaults: { execution: 'worktree', permission: 'ask', setupCommand: 'pnpm install' },
        },
        shared: [],
      },
    },
    false,
  )
  await initializeAgentDefaults(s)
  expect(s.store.taskDefaults(undefined)).toMatchObject({
    execution: 'worktree',
    setupCommand: 'pnpm install',
    harness: { model: 'gpt-6.1-sol', permission: 'ask' },
  })
})

it('keeps user edits made while model discovery is pending', async () => {
  const s = await fixture(true)
  s.models.mockImplementation(async () => {
    s.defaults.save({
      ...s.defaults.get(),
      harness: { ...defaultTaskHarness('claude'), model: 'user-selected' },
    })
    s.titles.save({ agentId: '', model: 'user-title', reasoning: 'high' })
    return catalog
  })
  await initializeAgentDefaults(s)
  expect(s.defaults.get().harness.model).toBe('user-selected')
  expect(s.titles.read().model).toBe('user-title')
})

it('keeps setup usable when an installed Codex cannot advertise models', async () => {
  const s = await fixture(true)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  s.models.mockRejectedValue(new Error('Login unavailable'))
  await initializeAgentDefaults(s)
  expect(s.defaults.get().harness).toMatchObject({ model: 'gpt-6.1-sol', reasoning: 'medium' })
  expect(s.titles.read()).toMatchObject({ model: 'gpt-6-luna', reasoning: 'low' })
  expect(warn).toHaveBeenCalledOnce()
})
