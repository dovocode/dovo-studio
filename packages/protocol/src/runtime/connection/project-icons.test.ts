import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { repositorySchema } from '../../workspace.js'
import { runtimeDefaultsSchema } from './runtime-setup.js'
import { sharedProjectIcon, sharedProjectIconEntry, migrateProjectIcons } from './project-icons.js'
const icon = 'data:image/png;base64,YQ=='
const repository = decode(repositorySchema, {
  id: 'one',
  name: 'App',
  path: '/app',
  branch: 'main',
  gitIdentity: 'github.com/team/app',
  iconOverride: icon,
})
const runtime = decode(runtimeDefaultsSchema, {})

it('shares custom images while preserving unrelated project settings', () => {
  const before = {
    ...runtime,
    scopedSettings: {
      environment: {},
      shared: [
        {
          key: 'project:github.com/team/app',
          updatedAt: 1,
          changeId: 'one',
          value: { taskDefaults: { setupCommand: 'pnpm install' } },
        },
      ],
    },
  }
  const entry = sharedProjectIconEntry(before, repository, icon, { updatedAt: 2, changeId: 'two' })
  expect(entry?.value.taskDefaults?.setupCommand).toBe('pnpm install')
  expect(entry?.value.projectIcon).toBe(icon)
  const after = { ...before, scopedSettings: { environment: {}, shared: entry ? [entry] : [] } }
  expect(sharedProjectIcon(after, { ...repository, id: 'two', iconOverride: undefined })).toBe(icon)
})

it('migrates existing overrides once and preserves shared resets', () => {
  const migrated = migrateProjectIcons(runtime, [repository], { updatedAt: 1, changeId: 'one' })
  expect(migrated).toBeDefined()
  if (!migrated) throw new Error('Expected migrated settings')
  expect(sharedProjectIcon(migrated, repository)).toBe(icon)
  expect(
    migrateProjectIcons(migrated, [repository], { updatedAt: 2, changeId: 'two' }),
  ).toBeUndefined()
  const reset = sharedProjectIconEntry(migrated, repository, undefined, {
    updatedAt: 2,
    changeId: 'two',
  })
  const after = { ...runtime, scopedSettings: { environment: {}, shared: reset ? [reset] : [] } }
  expect(sharedProjectIcon(after, repository)).toBeUndefined()
  expect(
    migrateProjectIcons(after, [repository], { updatedAt: 3, changeId: 'three' }),
  ).toBeUndefined()
  expect(
    sharedProjectIconEntry(runtime, { ...repository, gitIdentity: undefined }, icon, {
      updatedAt: 1,
      changeId: 'one',
    }),
  ).toBeUndefined()
})

it('keeps stale folder identities, unavailable checkouts and forks out of icon sharing', () => {
  for (const local of [
    { ...repository, kind: 'folder' as const },
    { ...repository, gitIdentityError: 'Checkout unavailable' },
  ]) {
    expect(
      sharedProjectIconEntry(runtime, local, icon, { updatedAt: 1, changeId: 'one' }),
    ).toBeUndefined()
    expect(migrateProjectIcons(runtime, [local], { updatedAt: 1, changeId: 'one' })).toBeUndefined()
  }
  const entry = sharedProjectIconEntry(runtime, repository, icon, { updatedAt: 1, changeId: 'one' })
  const after = { ...runtime, scopedSettings: { environment: {}, shared: entry ? [entry] : [] } }
  expect(
    sharedProjectIcon(after, {
      ...repository,
      gitIdentity: 'github.com/fork/app',
      iconOverride: undefined,
    }),
  ).toBeUndefined()
})
