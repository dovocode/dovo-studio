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
  taskBehaviorOrigin,
  resourceOrigin,
  updateSharedSettingsEntry,
  canonicalSharedSettings,
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

it('merges independent offline categories in both orders and syncs equal-header partial histories', () => {
  const base = entry('project:host/team/app', 1, 'old')
  const icon = updateSharedSettingsEntry(
    base.key,
    base,
    { ...base.value, projectIcon: 'data:image/png;base64,YQ==' },
    { updatedAt: 2, changeId: 'icon' },
  )
  const defaults = updateSharedSettingsEntry(
    base.key,
    base,
    { taskDefaults: { setupCommand: 'new' } },
    { updatedAt: 3, changeId: 'defaults' },
  )
  const [merged] = mergeSharedSettings([icon], [defaults])
  expect(merged.value).toEqual({
    projectIcon: 'data:image/png;base64,YQ==',
    taskDefaults: { setupCommand: 'new' },
  })
  expect(mergeSharedSettings([defaults], [icon])).toEqual([merged])
  expect(pendingSharedSettings([merged], [defaults])).toEqual([merged])
  expect(pendingSharedSettings([defaults], [merged])).toEqual([])
  expect(mergeSharedSettings([merged], [icon], [base])).toEqual([merged])
})

it('retains category reset tombstones when unrelated offline edits arrive later', () => {
  const base = entry('global', 1, 'old')
  const reset = updateSharedSettingsEntry('global', base, {}, { updatedAt: 2, changeId: 'reset' })
  const rename = updateSharedSettingsEntry(
    'global',
    base,
    { ...base.value, projectName: 'Customer Portal' },
    { updatedAt: 3, changeId: 'name' },
  )
  const [merged] = mergeSharedSettings([reset], [rename])
  expect(merged.value).toEqual({ projectName: 'Customer Portal' })
  expect(mergeSharedSettings([merged], [base])[0].value).toEqual(merged.value)
})
it('merges only provider-confirmed identity aliases without changing category revisions', () => {
  const name = updateSharedSettingsEntry(
    'project:github.internal/Team/App',
    undefined,
    { projectName: 'Customer Portal' },
    { updatedAt: 2, changeId: 'name' },
  )
  const defaults = updateSharedSettingsEntry(
    'project:github.internal/team/app',
    undefined,
    { taskDefaults: { setupCommand: 'pnpm install' } },
    { updatedAt: 3, changeId: 'defaults' },
  )
  const sensitive = entry('project:git.internal/Team/App', 1, 'case-sensitive')
  const shared = canonicalSharedSettings([name, defaults, sensitive], (identity) =>
    identity.startsWith('github.internal/') ? identity.toLowerCase() : identity,
  )
  expect(shared).toHaveLength(2)
  expect(shared.find((entry) => entry.key === defaults.key)?.value).toEqual({
    projectName: 'Customer Portal',
    taskDefaults: { setupCommand: 'pnpm install' },
  })
  expect(shared.find((entry) => entry.key === sensitive.key)).toBe(sensitive)
})

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
  const generalSource = {
    ...linux,
    snapshot: {
      workspace: { repositories: [{ ...local, kind: 'scratch' as const, name: 'No project' }] },
    },
  }
  expect(settingsProjectChoices([generalSource], 'linux')).toEqual([
    { id: settingsProjectId(local, 'linux'), name: 'No Project' },
  ])
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

it('resets inherited custom policy at a narrower scope without resurrecting harness overrides', async () => {
  const { selectDefaultPermissionPreset } = await import('../../auth/permission-policy')
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: {},
      shared: [
        {
          key: 'global',
          updatedAt: 1,
          changeId: 'policy',
          value: {
            taskDefaults: {
              permission: 'ask',
              approvalPolicy: 'untrusted',
              sandboxMode: 'read-only',
              harness: {
                ...defaultTaskHarness('codex'),
                approvalPolicy: 'untrusted',
                sandboxMode: 'read-only',
              },
            },
          },
        },
      ],
    },
  })
  const repo = { ...project, taskDefaults: selectDefaultPermissionPreset({}, 'full-access') }
  const resolved = resolveTaskDefaults(runtime, repo).harness
  expect(resolved.permission).toBe('full-access')
  expect(resolved.approvalPolicy).toBeUndefined()
  expect(resolved.sandboxMode).toBeUndefined()
  // Inherit restores the original scope, including its advanced policy.
  const inherited = resolveTaskDefaults(runtime, {
    ...repo,
    taskDefaults: selectDefaultPermissionPreset(repo.taskDefaults, undefined),
  }).harness
  expect(inherited).toMatchObject({
    permission: 'ask',
    approvalPolicy: 'untrusted',
    sandboxMode: 'read-only',
  })
})
it('reviews scoped edits as labeled values without confusing explicit inheritance with a change', async () => {
  const { settingsChanges, validSettingsDays } = await import('./scoped-settings')
  expect(
    settingsChanges(
      { taskBehavior: { quotaResume: false }, taskDefaults: {} },
      { taskBehavior: { quotaResume: true }, taskDefaults: { setupCommand: undefined } },
    ),
  ).toEqual([
    {
      key: 'taskBehavior.quotaResume',
      label: 'Auto-resume limited tasks',
      before: 'Off',
      after: 'On',
    },
  ])
  expect(settingsChanges({ setupCommand: 'before' }, { setupCommand: 'after' })).toEqual([
    { key: 'setupCommand', label: 'Setup command', before: 'before', after: 'after' },
  ])
  for (const value of ['', '1', '365']) expect(validSettingsDays(value)).toBe(true)
  for (const value of ['0', '366', '-1', '1.5', 'abc']) expect(validSettingsDays(value)).toBe(false)
})
