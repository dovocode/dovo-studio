import { expect, it } from 'vitest'
import { decode } from './schema'
import { defaultTaskHarness } from './workspace'
import { runtimeDefaultsSchema } from './runtime-setup'
import {
  resolveTitleHarness,
  titleGenerationSettingsSchema,
  titleSettingsForHarness,
} from './title-generation'

it('decodes older snapshots with an unconfigured provider default', () => {
  expect(decode(runtimeDefaultsSchema, {})).toEqual({
    configured: false,
    harness: defaultTaskHarness('codex'),
  })
})
it('preserves managed ACP selection and independent title model through serialization', () => {
  const agent = {
    ...defaultTaskHarness('acp'),
    id: 'installed',
    name: 'Installed',
    acpInstallationId: 'managed-agent',
    model: 'utility-model',
    reasoning: 'low',
  }
  const settings = decode(titleGenerationSettingsSchema, titleSettingsForHarness(agent))
  expect(settings).toMatchObject({
    harness: { acpInstallationId: 'managed-agent' },
    model: 'utility-model',
  })
  const harness = resolveTitleHarness(settings, [], {
    ...defaultTaskHarness('claude'),
    model: 'main-model',
  })
  expect(harness?.provider).toBe('acp')
  expect(harness?.acpInstallationId).toBe('managed-agent')
  expect(settings.model).toBe('utility-model')
})

it('resolves project overrides field by field and allows disabling inherited setup', async () => {
  const { resolveTaskDefaults } = await import('./runtime-setup')
  const runtime = decode(runtimeDefaultsSchema, {
    harness: defaultTaskHarness('claude'),
    execution: 'worktree',
    worktreeBaseBranch: 'origin/master',
    setupCommand: 'pnpm install',
  })
  const project = {
    id: 'repo',
    name: 'Repo',
    path: '/repo',
    branch: 'feature',
    taskDefaults: { setupCommand: '', worktreeBaseBranch: 'release' },
  }
  expect(resolveTaskDefaults(runtime, project)).toEqual({
    harness: runtime.harness,
    execution: 'worktree',
    worktreeBaseBranch: 'release',
    setupCommand: '',
  })
  expect(resolveTaskDefaults(undefined, undefined)).toMatchObject({
    execution: 'main',
    harness: defaultTaskHarness('codex'),
  })
})
