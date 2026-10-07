import { expect, test } from 'vite-plus/test'
import { settingLayers, settingValueLabel } from './setting-layers.js'
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
