import { expect, it } from 'vite-plus/test'
import {
  gitRemoteIdentity,
  projectMachineGroups,
  taskProjectGroups,
  preferredProjectEntry,
  projectDefaultServer,
} from './project-machines'
import { runtimeDefaultsSchema } from './runtime-setup'
import { taskMachineDraft } from '../../tasks/task-machine-draft'
import { decode } from '../../shared/schema'
import { taskSchema, defaultTaskHarness } from '../../workspace'
it('prefers an explicit shared name even when it equals that computer’s local label', () => {
  const repository = {
    id: 'one',
    name: 'Customer Portal',
    localName: 'Customer Portal',
    sharedName: 'Customer Portal',
    path: '/one',
    branch: 'main',
    gitIdentity: 'github.com/team/app',
  }
  const groups = projectMachineGroups([
    { repository, runtimeId: 'mac' },
    {
      repository: {
        ...repository,
        id: 'two',
        name: 'app',
        localName: 'app',
        sharedName: undefined,
      },
      runtimeId: 'linux',
    },
  ])
  expect(groups[0].name).toBe('Customer Portal')
})
it('matches SSH and HTTPS without publishing credentials or merging different hosts', () => {
  expect(gitRemoteIdentity('git@github.com:Owner/Repo.git')).toBe('github.com/owner/repo')
  expect(gitRemoteIdentity('https://user:secret@github.com/Owner/Repo.git?token=secret')).toBe(
    'github.com/owner/repo',
  )
  expect(gitRemoteIdentity('ssh://git@github.com:22/Owner/Repo.git')).toBe('github.com/owner/repo')
  expect(gitRemoteIdentity('git@ssh.dev.azure.com:v3/org/project/repo')).toBe(
    gitRemoteIdentity('https://dev.azure.com/org/project/_git/repo'),
  )
  expect(gitRemoteIdentity('/local/repo')).toBeUndefined()
  expect(gitRemoteIdentity('file:///local/repo')).toBeUndefined()
  expect(gitRemoteIdentity('https://one.example/Owner/Repo')).not.toBe(
    gitRemoteIdentity('https://two.example/Owner/Repo'),
  )
})
it('groups verified identities and keeps name-only or local checkouts separate', () => {
  const repository = { id: 'repo', name: 'Repo', branch: 'main', path: '/repo' }
  const groups = projectMachineGroups([
    { runtimeId: 'one', repository: { ...repository, gitIdentity: 'github.com/o/r' } },
    { runtimeId: 'two', repository: { ...repository, gitIdentity: 'github.com/o/r' } },
    { runtimeId: 'one', repository: { ...repository, id: 'local' } },
    { runtimeId: 'two', repository: { ...repository, id: 'local' } },
  ])
  expect(groups).toHaveLength(3)
  expect(groups.find((group) => group.key === 'github.com/o/r')?.entries).toHaveLength(2)
})
it('moves only unsent text into destination defaults without execution state', () => {
  const task = decode(taskSchema, {
    id: 'draft',
    title: 'New task',
    repositoryId: 'source',
    agentId: '',
    status: 'draft',
    createdAt: '2026-09-24T00:00:00Z',
    messages: [],
    files: [],
    draft: 'Please build this',
    example: false,
  })
  const repository = {
    id: 'target',
    name: 'Repo',
    path: '/repo',
    branch: 'main',
    taskDefaults: { execution: 'worktree' as const, setupCommand: 'pnpm install' },
  }
  expect(taskMachineDraft(task, repository)).toMatchObject({
    id: 'draft',
    repositoryId: 'target',
    status: 'draft',
    messages: [],
    draft: 'Please build this',
    execution: 'worktree',
  })
  const scratch = { ...repository, id: 'scratch', kind: 'scratch' as const }
  expect(
    taskMachineDraft({ ...task, autoProject: true, autoProjectExecution: 'worktree' }, scratch),
  ).toMatchObject({ autoProject: true, autoProjectExecution: 'worktree', repositoryId: 'scratch' })
  expect(
    taskMachineDraft({ ...task, autoProject: true, autoProjectExecution: 'main' }, repository),
  ).toMatchObject({ autoProject: undefined, autoProjectExecution: undefined })
  expect(() =>
    taskMachineDraft({ ...task, messages: [{ id: 'sent', role: 'user', text: 'go' }] }, repository),
  ).toThrow('first prompt')
})
it('normalizes provider alternate clone addresses and escaped paths', () => {
  expect(gitRemoteIdentity('ssh://git@ssh.github.com:443/Owner/Repo.git')).toBe(
    'github.com/owner/repo',
  )
  expect(gitRemoteIdentity('ssh://git@altssh.gitlab.com:443/Group/Repo.git')).toBe(
    'gitlab.com/group/repo',
  )
  expect(gitRemoteIdentity('ssh://git@altssh.bitbucket.org:443/Owner/Repo.git')).toBe(
    'bitbucket.org/owner/repo',
  )
  expect(
    gitRemoteIdentity('https://org.visualstudio.com/DefaultCollection/My%20Project/_git/Repo'),
  ).toBe(gitRemoteIdentity('git@ssh.dev.azure.com:v3/org/My Project/Repo'))
  expect(gitRemoteIdentity('https://host.example/team/%72epo.git/')).toBe('host.example/team/repo')
  expect(gitRemoteIdentity('https://host.example/team/repo%2Fother')).not.toBe(
    gitRemoteIdentity('https://host.example/team/repo/other'),
  )
  expect(gitRemoteIdentity('https://host.example/team/%ZZ')).toBeUndefined()
  expect(gitRemoteIdentity('ssh://git@host.example:2222/team/repo')).toBe(
    'host.example:2222/team/repo',
  )
})

it('keeps explicit draft permissions when destination defaults are broader', () => {
  const task = decode(taskSchema, {
    id: 'draft',
    title: 'Restricted',
    repositoryId: 'source',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: 'Work',
    example: false,
    harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    agentOverrides: { approvalPolicy: 'never', sandboxMode: 'read-only' },
  })
  const moved = taskMachineDraft(task, {
    id: 'target',
    name: 'Target',
    path: '/target',
    branch: 'main',
  })
  expect(moved.harness).toMatchObject({
    permission: 'read-only',
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
  })
  expect(moved.agentOverrides).toBeUndefined()
})
it('preserves provider-bound next-message overrides by rejecting a computer move', () => {
  const task = decode(taskSchema, {
    id: 'draft',
    title: 'Draft',
    repositoryId: 'source',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: 'Keep my settings',
    example: false,
    draftTurnSettings: { provider: 'codex', model: 'specialized-model', reasoning: 'high' },
  })
  expect(() =>
    taskMachineDraft(task, { id: 'target', name: 'Target', path: '/target', branch: '' }),
  ).toThrow('Clear next-message overrides')
  expect(task.draftTurnSettings?.model).toBe('specialized-model')
})
it('uses stable group labels independent of runtime order', () => {
  const entries = ['Project checkout', 'Project'].map((name, index) => ({
    runtimeId: `${index}`,
    repository: { id: 'repo', name, path: '/repo', branch: 'main', gitIdentity: 'host/team/repo' },
  }))
  expect(projectMachineGroups(entries)[0].name).toBe(
    projectMachineGroups([...entries].reverse())[0].name,
  )
})

it('pins one project-free choice and groups the same project across servers', () => {
  const repository = {
    id: 'repo',
    name: 'Project',
    path: '/repo',
    branch: 'main',
    gitIdentity: 'host/team/project',
  }
  const groups = taskProjectGroups([
    { runtimeId: 'local', repository },
    { runtimeId: 'remote', repository: { ...repository, id: 'copy' } },
    {
      runtimeId: 'local',
      repository: {
        ...repository,
        id: 'scratch',
        kind: 'scratch' as const,
        gitIdentity: undefined,
      },
    },
    {
      runtimeId: 'remote',
      repository: {
        ...repository,
        id: 'scratch',
        kind: 'scratch' as const,
        gitIdentity: undefined,
      },
    },
  ])
  expect(groups.map((group) => group.name)).toEqual(['No Project', 'Project'])
  expect(groups[0].entries).toHaveLength(2)
  expect(groups[1].entries).toHaveLength(2)
})

it('prefers a project default server and falls back to online valid copies', () => {
  const repository = {
    id: 'repo',
    name: 'Project',
    path: '/repo',
    branch: 'main',
    gitIdentity: 'host/team/project',
  }
  const defaults = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: {},
      shared: [
        {
          key: 'project:host/team/project',
          updatedAt: 1,
          changeId: 'one',
          value: { taskDefaults: { defaultServerId: 'remote' } },
        },
      ],
    },
  })
  const entries = ['local', 'remote', 'third'].map((runtimeId) => ({
    repository,
    runtimeId,
    online: true,
    defaults,
  }))
  expect(preferredProjectEntry(entries, 'local')?.runtimeId).toBe('remote')
  const offline = entries.map((entry) => ({ ...entry, online: entry.runtimeId !== 'remote' }))
  expect(preferredProjectEntry(offline, 'local')?.runtimeId).toBe('local')
  expect(preferredProjectEntry(offline, 'missing')?.runtimeId).toBe('local')
  const invalid = entries.map((entry) => ({
    ...entry,
    repository:
      entry.runtimeId === 'remote'
        ? { ...repository, gitIdentityError: 'Invalid remote' }
        : repository,
  }))
  expect(preferredProjectEntry(invalid, 'local')?.runtimeId).toBe('local')
  expect(
    preferredProjectEntry(
      entries.map((entry) => ({ ...entry, online: false })),
      'local',
    ),
  ).toBeUndefined()
})

it('uses the latest shared default and respects a synced reset instead of a stale server', () => {
  const repository = {
    id: 'repo',
    name: 'Project',
    path: '/repo',
    branch: 'main',
    gitIdentity: 'host/team/project',
  }
  const defaults = (updatedAt: number, defaultServerId?: string) =>
    decode(runtimeDefaultsSchema, {
      scopedSettings: {
        environment: {},
        shared: [
          {
            key: 'project:host/team/project',
            updatedAt,
            changeId: String(updatedAt),
            value: { taskDefaults: { defaultServerId } },
          },
        ],
      },
    })
  const entries = [
    { repository, runtimeId: 'local', online: true, defaults: defaults(1, 'remote') },
    { repository, runtimeId: 'remote', online: true, defaults: defaults(2, 'local') },
  ]
  expect(projectDefaultServer(entries)).toBe('local')
  expect(preferredProjectEntry(entries, 'remote')?.runtimeId).toBe('local')
  entries[1].defaults = defaults(3)
  expect(projectDefaultServer(entries)).toBeUndefined()
  expect(preferredProjectEntry(entries, 'remote')?.runtimeId).toBe('remote')
})

it('does not group folders or unavailable checkouts using stale Git identities', () => {
  const repository = {
    id: 'repo',
    name: 'App',
    path: '/app',
    branch: 'main',
    gitIdentity: 'github.com/team/app',
  }
  const groups = projectMachineGroups([
    { runtimeId: 'one', repository },
    { runtimeId: 'two', repository: { ...repository, kind: 'folder' as const } },
    { runtimeId: 'three', repository: { ...repository, gitIdentityError: 'Checkout unavailable' } },
    { runtimeId: 'four', repository: { ...repository, gitIdentity: 'github.com/fork/app' } },
  ])
  expect(groups).toHaveLength(4)
  expect(groups.filter((group) => group.identity)).toHaveLength(2)
})

it('groups General across computers without treating it as a Git project', () => {
  const entries = [
    {
      runtimeId: 'one',
      repository: {
        id: 'scratch-one',
        kind: 'scratch' as const,
        name: 'No project',
        path: '/private/one',
        branch: 'stale',
        gitIdentity: 'host/old/repo',
      },
    },
    {
      runtimeId: 'two',
      repository: {
        id: 'scratch-two',
        kind: 'scratch' as const,
        name: 'Private folder',
        path: '/private/two',
        branch: '',
      },
    },
    {
      runtimeId: 'one',
      repository: { id: 'regular', name: 'General', path: '/regular', branch: 'main' },
    },
  ]
  const groups = projectMachineGroups(entries)
  expect(groups).toHaveLength(2)
  expect(groups.find((group) => group.key === 'scratch')).toMatchObject({
    name: 'No Project',
    identity: undefined,
    entries: entries.slice(0, 2),
  })
  expect(
    projectMachineGroups([...entries].reverse()).find((group) => group.key === 'scratch')?.name,
  ).toBe('No Project')
  expect(projectMachineGroups(entries, false)).toHaveLength(3)
  expect(projectMachineGroups(entries, false).map((group) => group.name)).toEqual([
    'General',
    'No Project',
    'No Project',
  ])
})
