import { expect, it } from 'vitest'
import { gitRemoteIdentity, projectMachineGroups } from './project-machines'
import { taskMachineDraft } from './task-machine-draft'
import { decode } from './schema'
import { taskSchema } from './workspace'
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
it('uses stable group labels independent of runtime order', () => {
  const entries = ['Project checkout', 'Project'].map((name, index) => ({
    runtimeId: `${index}`,
    repository: { id: 'repo', name, path: '/repo', branch: 'main', gitIdentity: 'host/team/repo' },
  }))
  expect(projectMachineGroups(entries)[0].name).toBe(
    projectMachineGroups([...entries].reverse())[0].name,
  )
})
