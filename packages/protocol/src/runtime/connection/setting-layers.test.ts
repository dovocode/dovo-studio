import { expect, test } from 'vite-plus/test'
import {
  settingLayers,
  settingOverrides,
  settingValueLabel,
  settingValueDescription,
  settingSourceName,
  settingBaseLabel,
  settingInheritanceIsCurrent,
} from './setting-layers.js'
import { settingsScopeSummary } from './scoped-settings.js'
import { decode } from '../../shared/schema.js'
import { runtimeDefaultsSchema } from './runtime-setup.js'

test('shows the winning computer value above global inheritance', () => {
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: { taskDefaults: { execution: 'worktree' } },
      shared: [
        {
          key: 'global',
          value: { taskDefaults: { execution: 'main' } },
          updatedAt: 1,
          changeId: 'one',
        },
      ],
    },
  })
  expect(settingLayers(runtime, undefined, { group: 'taskDefaults', key: 'execution' })).toEqual([
    { scope: 'environment', value: 'worktree', effective: true },
    { scope: 'global', value: 'main', effective: false },
  ])
  expect(
    settingLayers(
      runtime,
      undefined,
      { group: 'taskDefaults', key: 'execution' },
      { scope: 'environment', value: undefined },
    ),
  ).toEqual([
    { scope: 'environment', value: undefined, effective: false },
    { scope: 'global', value: 'main', effective: true },
  ])
})

test('false and empty commands are explicit overrides', () => {
  const runtime = decode(runtimeDefaultsSchema, { scopedSettings: { environment: {}, shared: [] } })
  const rows = settingLayers(
    runtime,
    undefined,
    { group: 'taskBehavior', key: 'quotaResume' },
    { scope: 'environment', value: false },
  )
  expect(rows[0]).toEqual({ scope: 'environment', value: false, effective: true })
  expect(settingValueLabel(false)).toBe('Off')
  expect(settingValueLabel('')).toBe('Disabled')
  expect(settingValueLabel(undefined)).toBe('Inherit')
})

test('explains explicit false, disabled setup and provider resets without treating them as inherited', () => {
  expect(settingValueDescription({ group: 'taskBehavior', key: 'settleMerged' }, false)).toBe('Off')
  expect(settingValueDescription({ group: 'taskDefaults', key: 'setupCommand' }, '')).toBe(
    'No setup command',
  )
  expect(settingValueDescription({ group: 'taskDefaults', key: 'approvalPolicy' }, null)).toBe(
    'Provider default',
  )
  expect(settingValueDescription({ group: 'taskDefaults', key: 'execution' }, undefined)).toBe(
    'Local checkout',
  )
  expect(settingValueDescription({ group: 'taskBehavior', key: 'inactiveDays' }, undefined)).toBe(
    '3 days',
  )
  expect(settingBaseLabel({ group: 'taskDefaults', key: 'modelSelection' })).toBe(
    'Use selected agent · Dovo default',
  )
})

test('names the actual source and distinguishes shared defaults from computer storage', () => {
  const context = { project: 'Studio', computer: 'Mac Studio' }
  expect(settingSourceName('project', context)).toBe('Studio project defaults')
  expect(settingSourceName('environment-project', context)).toBe('Studio on Mac Studio')
  expect(settingSourceName('computer-default', context)).toBe('Mac Studio preferences')
  expect(settingsScopeSummary('project', context).storage).toBe('Shared across paired computers')
  expect(settingsScopeSummary('environment-project', context)).toEqual({
    title: 'Studio on Mac Studio',
    description:
      'Changes apply only to this project on this computer. This is the most specific level.',
    storage: 'Saved on Mac Studio',
  })
  expect(settingsScopeSummary('environment', context).description).toContain(
    'Project defaults override computer defaults',
  )
})

test('project-on-computer wins and resetting reveals the shared project value', () => {
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: { taskDefaults: { execution: 'main' } },
      shared: [
        {
          key: 'project:github.com/team/repo',
          value: { taskDefaults: { execution: 'worktree' } },
          updatedAt: 1,
          changeId: 'one',
        },
      ],
    },
  })
  const repository = {
    id: 'one',
    name: 'Project',
    path: '/repo',
    branch: 'main',
    gitIdentity: 'github.com/team/repo',
    taskDefaults: { execution: 'main' as const },
  }
  const field = { group: 'taskDefaults', key: 'execution' } as const
  expect(settingLayers(runtime, repository, field).find((row) => row.effective)?.scope).toBe(
    'environment-project',
  )
  expect(
    settingLayers(runtime, repository, field, {
      scope: 'environment-project',
      value: undefined,
    }).find((row) => row.effective),
  ).toEqual({ scope: 'project', value: 'worktree', effective: true })
})

test('lists later overrides once per shared project and per computer-local checkout', () => {
  const shared = {
    key: 'project:github.com/team/repo',
    value: { taskDefaults: { execution: 'worktree' } },
    updatedAt: 1,
    changeId: 'one',
  }
  const repository = {
    id: 'mac-repo',
    name: 'Repo',
    path: '/mac/repo',
    branch: 'main',
    gitIdentity: 'github.com/team/repo',
  }
  const sources = [
    {
      profile: { id: 'mac' },
      name: 'Mac',
      snapshot: {
        defaults: decode(runtimeDefaultsSchema, {
          scopedSettings: {
            environment: { taskDefaults: { execution: 'main' } },
            shared: [shared],
          },
        }),
        workspace: {
          repositories: [
            { ...repository, taskDefaults: { execution: 'main' as const } },
            { id: 'folder', name: 'Folder', path: '/mac/folder', branch: '' },
          ],
        },
      },
    },
    {
      profile: { id: 'linux' },
      name: 'Linux',
      snapshot: {
        defaults: decode(runtimeDefaultsSchema, {
          scopedSettings: { environment: {}, shared: [shared] },
        }),
        workspace: { repositories: [{ ...repository, id: 'linux-repo', path: '/linux/repo' }] },
      },
    },
    { profile: { id: 'offline' }, name: 'Offline', snapshot: null },
  ]
  const field = { group: 'taskDefaults', key: 'execution' } as const
  expect(
    settingOverrides(sources, field, { scope: 'global' }).map((entry) => [
      entry.scope,
      entry.computer,
      entry.project,
      entry.value,
      entry.target,
    ]),
  ).toEqual([
    ['environment', 'Mac', undefined, 'main', { environmentId: 'mac', projectId: '' }],
    [
      'project',
      undefined,
      'Repo',
      'worktree',
      { environmentId: '', projectId: 'git:github.com/team/repo' },
    ],
    [
      'environment-project',
      'Mac',
      'Repo',
      'main',
      { environmentId: 'mac', projectId: 'git:github.com/team/repo' },
    ],
  ])
  expect(
    settingOverrides(sources, field, { scope: 'environment', environmentId: 'linux' }).map(
      (entry) => entry.scope,
    ),
  ).toEqual(['project'])
  expect(
    settingOverrides(sources, field, { scope: 'project', repository }).map((entry) => [
      entry.scope,
      entry.environmentId,
      entry.repositoryId,
    ]),
  ).toEqual([['environment-project', 'mac', 'mac-repo']])
  expect(settingOverrides(sources, field, { scope: 'environment-project', repository })).toEqual([])
})

test('does not attribute a fresh inherited value to an outdated source snapshot', () => {
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: { environment: { taskDefaults: { execution: 'worktree' } }, shared: [] },
  })
  const setting = {
    field: { group: 'taskDefaults', key: 'execution' },
    scope: 'environment-project',
    repository: { id: 'repo', name: 'Repo', path: '/repo', branch: 'main' },
    value: undefined,
    inheritedValue: 'main',
  } as const
  expect(settingInheritanceIsCurrent(runtime, setting, 'environment')).toBe(false)
  expect(
    settingInheritanceIsCurrent(runtime, { ...setting, inheritedValue: 'worktree' }, 'environment'),
  ).toBe(true)
})
