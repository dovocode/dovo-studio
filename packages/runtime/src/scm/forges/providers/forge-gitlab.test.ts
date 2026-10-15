import { expect, it, vi } from 'vite-plus/test'
import type { ForgeConnection } from '@dovo/protocol'
import { GitLabForge, gitlabProjectPath } from './forge-gitlab'
import { ForgeHttp } from '../integration/forge-http'
import { GitLabForgeWork } from '../../work/forge-work-gitlab'

const connection: ForgeConnection = {
  id: 'lab',
  name: 'GitLab',
  provider: 'gitlab',
  baseUrl: 'https://gitlab.example',
  credential: 'token',
  revision: '1',
}
const sha = 'a'.repeat(40)
const user = { id: 7, username: 'dominic', avatar_url: 'https://gitlab.example/avatar/7' }
const project = {
  id: 99,
  name: 'App',
  path_with_namespace: 'team/sub/app',
  web_url: 'https://gitlab.example/team/sub/app',
  http_url_to_repo: 'https://gitlab.example/team/sub/app.git',
  default_branch: 'main',
}
const mergeRequest = {
  iid: 42,
  title: 'Change',
  description: 'Body',
  web_url: `${project.web_url}/-/merge_requests/42`,
  state: 'opened',
  draft: true,
  author: user,
  assignees: [],
  reviewers: [user],
  labels: [],
  updated_at: '2026-10-14T10:00:00Z',
  source_branch: 'topic',
  target_branch: 'main',
  sha,
  source_project_id: 99,
  diff_refs: { base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: sha },
}
const issue = {
  iid: 12,
  title: 'Issue',
  description: 'Body',
  state: 'opened',
  web_url: `${project.web_url}/-/issues/12`,
  author: user,
  assignees: [user],
  labels: ['bug'],
  updated_at: '2026-10-14T10:00:00Z',
}
const pipeline = {
  id: 222,
  iid: 12,
  status: 'failed',
  ref: 'main',
  sha,
  web_url: `${project.web_url}/-/pipelines/222`,
  created_at: '2026-10-14T10:00:00Z',
  updated_at: '2026-10-14T10:01:00Z',
}
const root = '/api/v4/projects/team%2Fsub%2Fapp'
function setup(resolve: (url: URL, request?: RequestInit) => unknown) {
  const requests: { url: URL; request?: RequestInit }[] = []
  const fetcher: typeof fetch = async (input, request) => {
    const url = new URL(input instanceof Request ? input.url : input)
    requests.push({ url, request })
    return Response.json(resolve(url, request))
  }
  const http = new ForgeHttp(connection, () => 'Bearer secret', fetcher)
  return {
    pulls: new GitLabForge(http, 'team/sub/app'),
    work: new GitLabForgeWork(http, 'team/sub/app'),
    requests,
  }
}

it('encodes nested namespaces as one GitLab project key and rejects path overrides', () => {
  expect(gitlabProjectPath('team/sub/app')).toBe(root)
  for (const repository of [
    'one',
    'team/../app',
    'team//app',
    'team/app?token=x',
    'team%2Fapp/project',
    'team/app\\x',
  ])
    expect(() => gitlabProjectPath(repository)).toThrow('Enter the GitLab project')
})
it('reads merge request details and all notes/diffs, preserving draft and account flags', async () => {
  const { pulls, requests } = setup((url) => {
    if (url.pathname === '/api/v4/user') return user
    if (url.pathname === root) return project
    if (url.pathname.endsWith('/notes'))
      return url.searchParams.get('page') === '1'
        ? Array.from({ length: 50 }, (_, id) => ({
            id,
            body: 'Comment',
            author: user,
            created_at: '',
            system: false,
          }))
        : [{ id: 51, body: 'Last note', author: user, created_at: '', system: false }]
    if (url.pathname.endsWith('/diffs'))
      return [
        {
          old_path: 'file.ts',
          new_path: 'file.ts',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
          diff: '@@ -1 +1 @@\n-old\n+new',
        },
      ]
    return mergeRequest
  })
  const detail = await pulls.detail(42)
  expect(detail.pull).toMatchObject({
    provider: 'gitlab',
    number: 42,
    draft: true,
    viewerIsAuthor: true,
    viewerReviewRequested: true,
    cloneUrl: project.http_url_to_repo,
    headRef: 'refs/merge-requests/42/head',
  })
  expect(detail.comments).toHaveLength(51)
  expect(detail.files[0]).toMatchObject({ path: 'file.ts', patch: '@@ -1 +1 @@\n-old\n+new' })
  expect(detail.capabilities?.actions).not.toContain('inline-comment')
  expect(requests.some(({ url }) => url.searchParams.get('page') === '2')).toBe(true)
})
it('rejects changed commits before dispatch and sends the expected SHA to merge', async () => {
  const { pulls, requests } = setup((url, request) => {
    if (request?.method === 'PUT') return { ...mergeRequest, state: 'merged' }
    return mergeRequest
  })
  await expect(pulls.act({ action: 'close', number: 42, headSha: 'b'.repeat(40) })).rejects.toThrow(
    'changed',
  )
  expect(requests.every(({ request }) => request?.method === 'GET')).toBe(true)
  await pulls.act({ action: 'merge', number: 42, headSha: sha, method: 'squash' })
  expect(requests.at(-1)?.request).toMatchObject({
    method: 'PUT',
    body: JSON.stringify({ sha, squash: true }),
  })
})
it('creates drafts and preserves GitLab closed/merged list semantics', async () => {
  const { pulls, requests } = setup((url, request) => {
    if (url.pathname === '/api/v4/user') return user
    if (request?.method === 'POST') return mergeRequest
    return [
      mergeRequest,
      { ...mergeRequest, iid: 43, state: 'merged' },
      { ...mergeRequest, iid: 44, state: 'closed' },
    ]
  })
  const result = await pulls.list('closed', 1)
  expect(result.pulls.map((pull) => pull.state)).toEqual(['merged', 'closed'])
  expect(result.pulls[0].authorAvatarUrl).toBe(user.avatar_url)
  await pulls.create({ title: 'Change', head: 'topic', base: 'main', body: 'Body', draft: true })
  expect(requests.at(-1)?.request?.body).toBe(
    JSON.stringify({
      title: 'Draft: Change',
      description: 'Body',
      source_branch: 'topic',
      target_branch: 'main',
    }),
  )
})
it('preserves issue revision checks, resolves assignees, and clears assignees explicitly', async () => {
  const { work, requests } = setup((url) => (url.pathname === '/api/v4/users' ? [user] : issue))
  await expect(
    work.actOnIssue({ action: 'edit', id: '12', revision: 'old', title: 'New' }),
  ).rejects.toThrow('changed')
  expect(requests.every(({ request }) => request?.method === 'GET')).toBe(true)
  await work.actOnIssue({ action: 'edit', id: '12', revision: issue.updated_at, assignees: [] })
  expect(requests.at(-1)?.request?.body).toBe(JSON.stringify({ assignee_ids: [0] }))
  await work.createIssue({
    title: 'Issue',
    body: 'Body',
    type: 'Issue',
    assignees: ['dominic'],
    labels: ['bug'],
  })
  expect(requests.at(-1)?.request?.body).toBe(
    JSON.stringify({ title: 'Issue', description: 'Body', assignee_ids: [7], labels: 'bug' }),
  )
})
it('paginates pipeline jobs, keeps failure details, and only retries failed pipelines', async () => {
  const { work, requests } = setup((url) => {
    if (url.pathname.endsWith('/jobs'))
      return Array.from({ length: 50 }, (_, id) => ({
        id: id + 1,
        name: 'Test',
        stage: 'test',
        status: 'failed',
        web_url: `${project.web_url}/-/jobs/${id + 1}`,
        started_at: null,
        finished_at: null,
        failure_reason: 'script_failure',
      }))
    return pipeline
  })
  const detail = await work.pipeline('222')
  expect(detail.next).toBe('2')
  expect(detail.jobs[0]?.errors).toEqual(['script failure'])
  await work.actOnPipeline({ action: 'rerun', id: '222' })
  expect(requests.at(-1)?.url.pathname).toBe(`${root}/pipelines/222/retry`)
  expect(requests.at(-1)?.request?.method).toBe('POST')
  await expect(work.actOnPipeline({ action: 'cancel', id: '222' })).rejects.toThrow('unavailable')
})
it('invalidates rejected GitLab credentials', async () => {
  const unauthorized = vi.fn<() => void>()
  const http = new ForgeHttp(
    connection,
    () => 'Bearer secret',
    async () => new Response('', { status: 401 }),
    unauthorized,
  )
  await expect(new GitLabForge(http, 'team/sub/app').repository()).rejects.toThrow('Authentication')
  expect(unauthorized).toHaveBeenCalledOnce()
})
