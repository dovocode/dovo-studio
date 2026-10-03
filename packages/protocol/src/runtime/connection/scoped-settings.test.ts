import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { defaultTaskHarness, type Repository, type SharedSettingsEntry } from '../../workspace'
import { runtimeDefaultsSchema, resolveTaskDefaults } from './runtime-setup'
import {
  pendingSharedSettings,
  scopeEditorValue,
  mergeSharedSettings,
  resolveScopedSettings,
  settingsAtScope,
  sharedProjectKey,
} from './scoped-settings'
import { resourceSettingsSchema } from '../../shared/resources'

const project: Repository = {
  id: 'one',
  name: 'Project',
  path: '/repo',
  branch: 'main',
  gitIdentity: 'github.com/team/repo',
}
const entry = (
  key: string,
  updatedAt: number,
  setupCommand: string,
  changeId = 'a',
): SharedSettingsEntry => ({ key, updatedAt, changeId, value: { taskDefaults: { setupCommand } } })

it('resolves all four scopes field by field, including explicit empty commands and false flags', () => {
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: { taskDefaults: { setupCommand: 'environment', execution: 'worktree' } },
      shared: [
        {
          ...entry('global', 1, 'global'),
          value: {
            taskDefaults: {
              setupCommand: 'global',
              permission: 'ask',
              worktreeFromOrigin: true,
              harness: defaultTaskHarness('claude'),
            },
          },
        },
        entry(sharedProjectKey(project)!, 2, 'project'),
      ],
    },
  })
  expect(resolveTaskDefaults(runtime, project)).toMatchObject({
    setupCommand: 'project',
    execution: 'worktree',
    worktreeFromOrigin: true,
    harness: { provider: 'claude', permission: 'ask' },
  })
  expect(
    resolveTaskDefaults(runtime, {
      ...project,
      taskDefaults: { setupCommand: '', worktreeFromOrigin: false },
    }),
  ).toMatchObject({ setupCommand: '', execution: 'worktree', worktreeFromOrigin: false })
  expect(resolveScopedSettings(runtime, project, 'project').taskDefaults?.setupCommand).toBe(
    'environment',
  )
  expect(
    resolveTaskDefaults(runtime, { ...project, gitIdentity: 'github.com/team/fork' }).setupCommand,
  ).toBe('environment')
  expect(settingsAtScope(runtime, project, 'global').taskDefaults?.setupCommand).toBe('global')
})

it('keeps resets as newer entries so offline copies cannot resurrect removed settings', () => {
  const old = entry('global', 1, 'old')
  const reset = { ...old, updatedAt: 2, value: {} }
  expect(mergeSharedSettings([old], [reset])).toEqual([reset])
  expect(mergeSharedSettings([reset], [old])).toEqual([reset])
  expect(
    mergeSharedSettings([entry('global', 2, 'one', 'a')], [entry('global', 2, 'two', 'b')])[0].value
      .taskDefaults?.setupCommand,
  ).toBe('two')
})

it('overrides tools and prompts by name while preserving unrelated inherited entries', () => {
  const skill = (name: string, enabled: boolean) => ({
    name,
    enabled,
    description: name,
    content: name,
  })
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: {
        resources: decode(resourceSettingsSchema, { skills: [skill('work', false)] }),
      },
      shared: [
        {
          key: 'global',
          updatedAt: 1,
          changeId: 'a',
          value: {
            resources: decode(resourceSettingsSchema, {
              skills: [skill('work', true), skill('other', true)],
            }),
            prompts: [{ id: 'global', name: 'Review', text: 'Global review' }],
          },
        },
      ],
    },
  })
  const resolved = resolveScopedSettings(runtime, {
    ...project,
    prompts: [{ id: 'local', name: 'review', text: 'Local review' }],
  })
  expect(resolved.resources?.skills.map(({ name, enabled }) => ({ name, enabled }))).toEqual([
    { name: 'work', enabled: false },
    { name: 'other', enabled: true },
  ])
  expect(resolved.prompts).toEqual([{ id: 'local', name: 'review', text: 'Local review' }])
  expect(sharedProjectKey({ ...project, gitIdentity: undefined })).toBeUndefined()
})

it('syncs only missing or newer scopes and resolves the effective configured everyday harness', async () => {
  const old = entry('global', 1, 'old'),
    current = entry('global', 2, 'current')
  expect(
    pendingSharedSettings([current, entry('project:host/team/repo', 1, 'project')], [old]),
  ).toHaveLength(2)
  expect(pendingSharedSettings([old], [current])).toEqual([])
  const { configuredTaskHarness } = await import('./runtime-setup')
  expect(configuredTaskHarness(decode(runtimeDefaultsSchema, {}))).toBeUndefined()
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: {},
      shared: [{ ...current, value: { taskDefaults: { harness: defaultTaskHarness('claude') } } }],
    },
  })
  expect(configuredTaskHarness(runtime)?.provider).toBe('claude')
})

it('uses the same empty first-run environment value for editor saves and runtime initialization', () => {
  expect(scopeEditorValue(decode(runtimeDefaultsSchema, {}), project, 'environment')).toEqual({})
  const configured = decode(runtimeDefaultsSchema, { configured: true, setupCommand: 'legacy' })
  expect(scopeEditorValue(configured, project, 'environment').taskDefaults?.setupCommand).toBe(
    'legacy',
  )
})
