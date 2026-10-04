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
  settingsTargetAtScope,
  taskBehaviorOrigin,
  resourceOrigin,
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

it('moves between explicit scope levels without choosing an unavailable shared or local project', () => {
  const folder = { ...project, id: 'folder', gitIdentity: undefined, kind: 'folder' as const }
  const sources = [
    {
      profile: { id: 'mac' },
      connected: true,
      snapshot: { workspace: { repositories: [folder] } },
    },
    {
      profile: { id: 'linux' },
      connected: true,
      snapshot: { workspace: { repositories: [project] } },
    },
  ]
  const empty = { environmentId: '', projectId: '' }
  expect(settingsTargetAtScope(sources, empty, 'global')).toEqual(empty)
  expect(settingsTargetAtScope(sources, empty, 'environment', 'mac')).toEqual({
    environmentId: 'mac',
    projectId: '',
  })
  const shared = settingsTargetAtScope(sources, empty, 'project', 'mac')!
  expect(shared).toEqual({ environmentId: '', projectId: 'git:github.com/team/repo' })
  expect(settingsTargetAtScope(sources, shared, 'environment-project', 'mac')).toEqual({
    environmentId: 'linux',
    projectId: shared.projectId,
  })
  expect(settingsTargetAtScope(sources.slice(0, 1), empty, 'project')).toBeUndefined()
  expect(settingsTargetAtScope([], empty, 'environment')).toBeUndefined()
})

it('labels lifecycle and named resource sources using the same precedence as effective values', () => {
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: {
        taskBehavior: { quotaResume: false },
        resources: {
          mcpServers: [],
          skills: [
            {
              name: 'review',
              description: 'Review code',
              content: 'Computer review',
              enabled: false,
            },
          ],
        },
      },
      shared: [
        {
          key: 'global',
          updatedAt: 1,
          changeId: 'one',
          value: { taskBehavior: { quotaResume: true } },
        },
      ],
    },
  })
  expect(taskBehaviorOrigin(runtime, project, 'environment-project', {}, 'quotaResume')).toEqual({
    source: 'environment',
    overridden: false,
  })
  expect(
    taskBehaviorOrigin(
      runtime,
      project,
      'environment-project',
      { quotaResume: false },
      'quotaResume',
    ),
  ).toEqual({ source: 'environment-project', overridden: true })
  expect(taskBehaviorOrigin(runtime, project, 'global', {}, 'continueAfterRestart', true)).toEqual({
    source: 'computer-default',
    overridden: false,
  })
  expect(resourceOrigin(runtime, project, 'environment-project', 'skills', 'review')).toBe(
    'environment',
  )
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

it('selects one settings layer and shares project identity across computers without retargeting missing projects', async () => {
  const { resolveSettingsTarget, settingsProjectChoices, settingsProjectId } =
    await import('./scoped-settings')
  const mac = {
    profile: { id: 'mac' },
    connected: false,
    snapshot: { workspace: { repositories: [project] } },
  }
  const linuxProject = { ...project, id: 'linux-checkout', path: '/linux/repo' }
  const linux = {
    profile: { id: 'linux' },
    connected: true,
    snapshot: { workspace: { repositories: [linuxProject] } },
  }
  const empty = {
    profile: { id: 'empty' },
    connected: true,
    snapshot: { workspace: { repositories: [] } },
  }
  const sources = [mac, linux, empty]
  const projectId = settingsProjectId(project, 'mac')
  expect(settingsProjectChoices(sources, '')).toEqual([{ id: projectId, name: project.name }])
  expect(
    resolveSettingsTarget(sources, { environmentId: '', projectId: '' }, 'empty'),
  ).toMatchObject({ scope: 'global', source: empty })
  expect(
    resolveSettingsTarget(sources, { environmentId: 'mac', projectId: '' }, 'linux'),
  ).toMatchObject({ scope: 'environment', source: mac })
  expect(resolveSettingsTarget(sources, { environmentId: '', projectId }, 'empty')).toMatchObject({
    scope: 'project',
    source: linux,
    repository: linuxProject,
  })
  expect(
    resolveSettingsTarget(sources, { environmentId: 'mac', projectId }, 'linux'),
  ).toMatchObject({ scope: 'environment-project', source: mac, repository: project })
  expect(
    resolveSettingsTarget(sources, { environmentId: 'empty', projectId }, 'linux').source,
  ).toBeUndefined()
  expect(
    resolveSettingsTarget(sources, { environmentId: 'removed', projectId: '' }, 'linux').source,
  ).toBeUndefined()
  const local = { ...project, id: 'folder', gitIdentity: undefined }
  const localSource = { ...linux, snapshot: { workspace: { repositories: [local] } } }
  expect(settingsProjectChoices([localSource], '')).toEqual([])
  expect(settingsProjectChoices([localSource], 'linux')).toHaveLength(1)
  expect(
    resolveSettingsTarget([localSource], {
      environmentId: '',
      projectId: settingsProjectId(local, 'linux'),
    }).source,
  ).toBeUndefined()
})

it('shows the effective source of each default, including false/empty overrides and inherited harness groups', async () => {
  const { taskDefaultOrigins } = await import('./scoped-settings')
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: { taskDefaults: { permission: 'ask', setupCommand: 'host' } },
      shared: [
        {
          ...entry('global', 1, 'global'),
          value: {
            taskDefaults: { harness: defaultTaskHarness('claude'), worktreeFromOrigin: true },
          },
        },
        entry(sharedProjectKey(project)!, 2, 'project'),
      ],
    },
  })
  const origins = taskDefaultOrigins(runtime, project, 'environment-project', {
    worktreeFromOrigin: false,
    setupCommand: '',
  })
  expect(origins.find((field) => field.key === 'harness')).toMatchObject({
    source: 'global',
    overridden: false,
  })
  expect(origins.find((field) => field.key === 'permission')).toMatchObject({
    source: 'environment',
  })
  expect(origins.find((field) => field.key === 'worktreeFromOrigin')).toMatchObject({
    source: 'environment-project',
    overridden: true,
  })
  expect(origins.find((field) => field.key === 'setupCommand')).toMatchObject({
    source: 'environment-project',
    overridden: true,
  })
  expect(
    taskDefaultOrigins(runtime, project, 'environment-project', {}).find(
      (field) => field.key === 'setupCommand',
    ),
  ).toMatchObject({ source: 'project', overridden: false })
})
