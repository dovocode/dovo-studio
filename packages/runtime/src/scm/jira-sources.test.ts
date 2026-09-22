import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { forgeIssueDetailSchema, forgeWorkOptionsSchema } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { JiraWork } from './jira.js'
import * as forgeCli from './forge-cli.js'
import { GitForgeWork } from './forge-work-git.js'
import { createWorkTask } from './work-task.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
const token = 'jira-source-test-owner-token-with-at-least-32-characters'
const source = {
  id: 'jira-source',
  site: 'https://team.atlassian.net',
  project: 'TEAM',
  name: 'Team work',
}
const repository = { id: 'repo', name: 'App', path: '/app', branch: 'main' }
const parsedIssue = forgeIssueDetailSchema.parse({
  issue: {
    id: 'TEAM-1',
    title: 'General work',
    url: `${source.site}/browse/TEAM-1`,
    revision: '2026-09-22T12:00:00Z',
    updatedAt: '',
    state: 'Open',
    body: 'Not tied to a codebase.',
    author: '',
    assignees: [],
    labels: [],
  },
  comments: [],
})
const issue = { ...parsedIssue, comments: [] }
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  const s = runtime.services
  vi.spyOn(JiraWork.prototype, 'verify').mockResolvedValue({
    key: source.project,
    self: `${source.site}/rest/api/3/project/TEAM`,
    issueTypes: [],
  })
  const identity = vi.spyOn(JiraWork.prototype, 'identity').mockResolvedValue('jira-account')
  const list = vi
    .spyOn(JiraWork.prototype, 'issues')
    .mockResolvedValue({ items: [issue.issue], next: undefined })
  const detail = vi.spyOn(JiraWork.prototype, 'issue').mockResolvedValue(issue)
  const mutate = vi.spyOn(JiraWork.prototype, 'actOnIssue')
  const create = vi.spyOn(JiraWork.prototype, 'createIssue')
  const post = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/scm/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return { status: response.status, data: (await response.json()) as unknown }
  }
  return { s, post, list, detail, mutate, create, identity }
}

it('connects and browses independent Jira sources with no Dovo repositories', async () => {
  const { s, post, list } = await setup()
  const saved = await post('jira/sources/save', {
    source: { site: source.site, project: source.project, name: source.name },
  })
  expect(saved.status).toBe(200)
  expect(saved.data).toMatchObject({ site: source.site, project: 'TEAM', name: 'Team work' })
  const id = s.store.get().jiraSources![0]!.id
  expect(s.store.get().repositories).toEqual([])
  expect((await post('work/options', { jiraSourceId: id })).data).toMatchObject({
    provider: 'jira',
    issues: true,
  })
  expect((await post('work/issues/list', { jiraSourceId: id })).data).toMatchObject({
    items: [issue.issue],
  })
  expect(list).toHaveBeenCalledExactlyOnceWith('open', undefined, undefined)
  expect(await post('work/issues/list', {})).toMatchObject({ status: 400 })
  expect(await post('work/issues/list', { jiraSourceId: id, repositoryId: 'other' })).toMatchObject(
    { status: 400 },
  )
  const duplicate = await post('jira/sources/save', {
    source: { site: source.site + '/', project: 'team' },
  })
  expect(duplicate.data).toEqual(saved.data)
  expect(s.store.get().jiraSources).toHaveLength(1)
})

it('adds, changes and removes app-only issue links after browsing, without updating Jira', async () => {
  const { s, post, mutate, create } = await setup()
  s.store.update((w) => ({
    ...w,
    jiraSources: [source],
    repositories: [repository, { ...repository, id: 'other' }],
  }))
  expect(
    await post('jira/issues/link', {
      sourceId: source.id,
      issueId: issue.issue.id,
      repositoryId: 'repo',
    }),
  ).toMatchObject({ status: 200, data: { ok: true } })
  expect(s.store.get().jiraIssueLinks).toEqual([
    { sourceId: source.id, issueId: 'TEAM-1', repositoryId: 'repo' },
  ])
  expect(
    await post('jira/issues/link', {
      sourceId: source.id,
      issueId: 'TEAM-1',
      repositoryId: 'other',
    }),
  ).toMatchObject({ status: 200 })
  expect(s.store.get().jiraIssueLinks).toEqual([
    { sourceId: source.id, issueId: 'TEAM-1', repositoryId: 'other' },
  ])
  expect(
    await post('jira/issues/link', { sourceId: source.id, issueId: 'TEAM-1', repositoryId: null }),
  ).toMatchObject({ status: 200 })
  expect(s.store.get().jiraIssueLinks).toEqual([])
  expect(mutate).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
  expect(
    await post('jira/issues/link', {
      sourceId: source.id,
      issueId: 'TEAM-1',
      repositoryId: 'missing',
    }),
  ).toMatchObject({ status: 404 })
})

it('keeps account/source cache identities distinct and refuses stale or mismatched linking', async () => {
  const { s, post, detail, list, identity } = await setup()
  const another = { ...source, id: 'other-source', project: 'OTHER' }
  s.store.update((w) => ({ ...w, jiraSources: [source, another], repositories: [repository] }))
  await s.forgeWork.requestJira(source.id, 'issues/list', { query: 'login' })
  await s.forgeWork.requestJira(source.id, 'issues/list', { query: 'login' })
  await s.forgeWork.requestJira(another.id, 'issues/list', { query: 'login' })
  expect(list).toHaveBeenCalledTimes(2)
  identity.mockResolvedValue('different-account')
  await s.forgeWork.requestJira(source.id, 'issues/list', { query: 'login' })
  expect(list).toHaveBeenCalledTimes(3)
  detail.mockResolvedValueOnce({ ...issue, issue: { ...issue.issue, id: 'OTHER-1' } })
  expect(
    await post('jira/issues/link', {
      sourceId: source.id,
      issueId: 'TEAM-1',
      repositoryId: 'repo',
    }),
  ).toMatchObject({ status: 409 })
  expect(s.store.get().jiraIssueLinks).toBeUndefined()
  detail.mockRejectedValue(new Error('Offline'))
  expect(
    await post('jira/issues/link', {
      sourceId: source.id,
      issueId: 'TEAM-1',
      repositoryId: 'repo',
    }),
  ).toMatchObject({ status: 409 })
  expect(s.store.get().jiraIssueLinks).toBeUndefined()
})

it('validates source and destination still exist while issue details load', async () => {
  const { s, post, detail } = await setup()
  s.store.update((w) => ({ ...w, jiraSources: [source], repositories: [repository] }))
  detail.mockImplementationOnce(async () => {
    s.store.update((w) => ({ ...w, repositories: [] }))
    return issue
  })
  expect(
    await post('jira/issues/link', {
      sourceId: source.id,
      issueId: 'TEAM-1',
      repositoryId: 'repo',
    }),
  ).toMatchObject({ status: 409 })
  expect(s.store.get().jiraIssueLinks).toBeUndefined()
  detail.mockImplementationOnce(async () => {
    s.store.update((w) => ({ ...w, jiraSources: [] }))
    return issue
  })
  await expect(
    s.forgeWork.requestJira(source.id, 'issues/detail', { id: 'TEAM-1', refresh: true }),
  ).rejects.toThrow('source changed')
})

it('creates a task in the chosen Dovo project while retaining its separate Jira source', async () => {
  const { s, post } = await setup()
  s.store.update((w) => ({ ...w, jiraSources: [source], repositories: [repository] }))
  const input = {
    kind: 'issue',
    jiraSourceId: source.id,
    repositoryId: repository.id,
    id: issue.issue.id,
    url: issue.issue.url,
    revision: issue.issue.revision,
    requestId: randomUUID(),
  }
  expect(await post('work/task', input)).toMatchObject({
    status: 200,
    data: { id: input.requestId },
  })
  expect(s.store.task(input.requestId)).toMatchObject({
    repositoryId: repository.id,
    status: 'draft',
    workItem: { provider: 'jira', jiraSourceId: source.id, id: 'TEAM-1' },
  })
  expect(s.store.task(input.requestId).draft).toContain('Not tied to a codebase.')
  expect(s.store.get().jiraIssueLinks).toEqual([
    { sourceId: source.id, issueId: 'TEAM-1', repositoryId: 'repo' },
  ])
  expect(await post('work/task', input)).toMatchObject({ status: 200 })
  expect(await post('work/task', { ...input, jiraSourceId: 'another' })).toMatchObject({
    status: 409,
  })
})

it('does not create a task after its independent Jira source or destination changes', async () => {
  const { s, detail } = await setup()
  s.store.update((w) => ({ ...w, jiraSources: [source], repositories: [repository] }))
  detail.mockImplementationOnce(async () => {
    s.store.update((w) => ({ ...w, repositories: [{ ...repository, path: '/moved' }] }))
    return issue
  })
  await expect(
    createWorkTask(s, {
      kind: 'issue',
      jiraSourceId: source.id,
      repositoryId: repository.id,
      id: issue.issue.id,
      url: issue.issue.url,
      revision: issue.issue.revision,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow('project source changed')
  expect(s.store.get().tasks).toEqual([])
})

it('restores repository native issues when legacy Jira bindings migrate', async () => {
  const { s } = await setup()
  s.store.update((w) => ({
    ...w,
    repositories: [{ ...repository, jira: { site: source.site, project: source.project } }],
  }))
  vi.spyOn(s.git, 'github').mockResolvedValue(
    JSON.stringify({ nameWithOwner: 'me/app', url: 'https://github.com/me/app' }),
  )
  vi.spyOn(GitForgeWork.prototype, 'options').mockResolvedValue(
    forgeWorkOptionsSchema.parse({
      provider: 'github',
      issues: true,
      pipelines: true,
      pipelineActions: [],
    }),
  )
  expect(await s.forgeWork.request(repository.id, 'options', {})).toMatchObject({
    provider: 'github',
  })
  expect(s.store.get().repositories[0]).not.toHaveProperty('jira')
  expect(s.store.get().jiraSources).toMatchObject([{ site: source.site, project: source.project }])
})

it('preserves independent source identity when renaming and removes only its app links', async () => {
  const { s, post } = await setup()
  s.store.update((w) => ({
    ...w,
    jiraSources: [source],
    jiraIssueLinks: [{ sourceId: source.id, issueId: 'TEAM-1', repositoryId: 'repo' }],
  }))
  expect(
    await post('jira/sources/save', { source: { ...source, name: 'Planning' } }),
  ).toMatchObject({ status: 200, data: { id: source.id, name: 'Planning' } })
  expect(
    await post('jira/sources/save', { source: { ...source, project: 'OTHER' } }),
  ).toMatchObject({ status: 409 })
  expect(await post('jira/sources/remove', { sourceId: source.id })).toMatchObject({ status: 200 })
  expect(s.store.get().jiraSources).toEqual([])
  expect(s.store.get().jiraIssueLinks).toEqual([])
})

it('discovers Jira namespaces in runtime home without requiring a code checkout', async () => {
  const { post } = await setup()
  const cli = vi.spyOn(forgeCli, 'runForgeCli').mockImplementation(async (_executable, args) => {
    if (args.join(' ') === 'jira auth status')
      return 'Site: team.atlassian.net\nAccount: user@example.com'
    if (args.includes('list')) return JSON.stringify([{ key: 'TEAM', name: 'Team' }])
    throw new Error('Unexpected command')
  })
  expect(await post('jira/projects/read', {})).toMatchObject({
    status: 200,
    data: { site: source.site, projects: [{ key: 'TEAM', name: 'Team' }] },
  })
  expect(cli).toHaveBeenCalledTimes(2)
  for (const call of cli.mock.calls) expect(call[3]).toBe(homedir())
})
