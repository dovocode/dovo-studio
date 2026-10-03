import { expect, it } from 'vitest'
import { decode } from '../../shared/schema'
import { defaultTaskHarness } from '../../workspace'
import { runtimeDefaultsSchema } from './runtime-setup'
import {
  resolveTitleHarness,
  titleGenerationSettingsSchema,
  titleSettingsForHarness,
} from '../../tasks/title-generation'

it('decodes older snapshots with an unconfigured provider default', () => {
  expect(decode(runtimeDefaultsSchema, {})).toEqual({
    configured: false,
    permission: 'full-access',
    harness: defaultTaskHarness('codex'),
  })
})
it('uses the global permission for new tasks of every harness', async () => {
  const { resolveTaskDefaults } = await import('./runtime-setup')
  for (const provider of [
    'codex',
    'claude',
    'opencode',
    'hermes',
    'copilot',
    'grok',
    'muse',
    'acp',
  ] as const) {
    const runtime = decode(runtimeDefaultsSchema, { harness: defaultTaskHarness(provider) })
    expect(resolveTaskDefaults(runtime, undefined).harness.permission).toBe('full-access')
    expect(
      resolveTaskDefaults({ ...runtime, permission: 'ask' }, undefined).harness.permission,
    ).toBe('ask')
  }
  const runtime = decode(runtimeDefaultsSchema, { harness: defaultTaskHarness('codex') })
  expect(
    resolveTaskDefaults(runtime, {
      id: 'repo',
      name: 'Repo',
      path: '/repo',
      branch: 'main',
      taskDefaults: { permission: 'workspace-write' },
    }).harness.permission,
  ).toBe('workspace-write')
  expect(
    resolveTaskDefaults(
      { ...runtime, permission: 'auto', harness: defaultTaskHarness('acp') },
      undefined,
    ).harness.permission,
  ).toBe('auto')
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
    // Retired fixed base branch: older saved values are ignored.
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
    worktreeFromOrigin: false,
    setupCommand: '',
  })
  // Start from origin: the project inherits its computer's choice until it overrides it.
  const fromOrigin = decode(runtimeDefaultsSchema, { worktreeFromOrigin: true })
  expect(resolveTaskDefaults(fromOrigin, project).worktreeFromOrigin).toBe(true)
  expect(
    resolveTaskDefaults(fromOrigin, { ...project, taskDefaults: { worktreeFromOrigin: false } })
      .worktreeFromOrigin,
  ).toBe(false)
  expect(resolveTaskDefaults(undefined, undefined)).toMatchObject({
    execution: 'main',
    harness: defaultTaskHarness('codex'),
  })
})

it('picks the worktree base: local branch, or origin’s matching or default branch', async () => {
  const { defaultWorktreeBase } = await import('../../scm/work/worktree-base')
  const refs = (...names: string[]) => names.map((ref) => ({ ref }))
  const branches = refs(
    'refs/heads/feature',
    'refs/remotes/origin/trunk',
    'refs/remotes/origin/main',
  )
  expect(defaultWorktreeBase(branches, 'feature')).toBe('refs/heads/feature')
  expect(defaultWorktreeBase(branches, 'feature', true, 'refs/remotes/origin/trunk')).toBe(
    'refs/remotes/origin/trunk',
  )
  expect(defaultWorktreeBase(branches, 'feature', true)).toBe('refs/remotes/origin/main')
  expect(
    defaultWorktreeBase(refs('refs/heads/main', 'refs/remotes/origin/main'), 'main', true),
  ).toBe('refs/remotes/origin/main')
})
