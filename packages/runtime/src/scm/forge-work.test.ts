import { expect, it, vi } from 'vitest'
import { forgeIssueCreateSchema, forgePipelineActionSchema } from '@dovo/protocol'
import { GitForgeWork } from './forge-work-git'
import { BitbucketForgeWork } from './forge-work-bitbucket'
import { AzureForgeWork } from './forge-work-azure'
import type { ForgeHttp } from './forge-http'
import type { WorkHttp } from './forge-work-types'
const issue = {
  number: 1,
  title: 'Fix',
  body: '`code`',
  state: 'open',
  html_url: 'https://github.com/me/app/issues/1',
  user: { login: 'me' },
  labels: [],
  updated_at: '2026-09-20T10:00:00Z',
}
it('keeps PRs out of issue results without truncating pagination', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue(
    Array.from({ length: 30 }, (_, i) => ({
      ...issue,
      number: i + 1,
      ...(i === 0 ? { pull_request: {} } : {}),
    })),
  )
  const provider = new GitForgeWork({ json }, 'github', 'me/app')
  const result = await provider.issues('open')
  expect(result.items).toHaveLength(29)
  expect(result.next).toBe('2')
  expect(json).toHaveBeenCalledWith(
    'repos/me/app/issues?state=open&per_page=30&page=1&sort=updated&direction=desc',
    undefined,
  )
})
it('searches beyond the loaded GitHub issues with a fixed repository scope', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ items: [issue], total_count: 65 })
  const result = await new GitForgeWork({ json }, 'github', 'me/app').issues(
    'open',
    undefined,
    'login repo:other/private',
  )
  expect(result.items[0]?.id).toBe('1')
  expect(result.next).toBe('2')
  const url = new URL(json.mock.calls[0]![0], 'https://api.github.com/')
  expect(url.pathname).toBe('/search/issues')
  expect(url.searchParams.get('q')).toBe(
    'repo:me/app is:issue is:open "login" "repo:other/private"',
  )
  expect(url.searchParams.get('sort')).toBe('updated')
})
it('passes literal search text through the Gitea repository issue endpoint', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue([issue])
  await new GitForgeWork({ json }, 'gitea', 'me/app').issues('all', '2', 'login & session')
  expect(json).toHaveBeenCalledWith(
    'api/v1/repos/me/app/issues?state=all&limit=30&page=2&type=issues&q=login%20%26%20session',
    undefined,
  )
})
it('rejects stale edits and sends no mutation', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue(issue)
  const provider = new GitForgeWork({ json }, 'github', 'me/app')
  await expect(
    provider.actOnIssue({ action: 'edit', id: '1', revision: 'old', title: 'new' }),
  ).rejects.toThrow('changed')
  expect(json).toHaveBeenCalledTimes(1)
})
it('sends the captured Gitea content version with the edit', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ ...issue, content_version: 8 })
  const provider = new GitForgeWork({ json }, 'gitea', 'me/app')
  await provider.actOnIssue({
    action: 'edit',
    id: '1',
    revision: `${issue.updated_at}:8`,
    title: 'new',
  })
  expect(json).toHaveBeenLastCalledWith('api/v1/repos/me/app/issues/1', {
    method: 'PATCH',
    body: expect.objectContaining({ title: 'new', content_version: 8 }),
  })
})
it('rejects same-second concurrent Gitea edits using the captured content version', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce([{ ...issue, content_version: 8 }])
    .mockResolvedValueOnce({ ...issue, content_version: 9 })
  const provider = new GitForgeWork({ json }, 'gitea', 'me/app')
  const page = await provider.issues('open')
  await expect(
    provider.actOnIssue({
      action: 'edit',
      id: '1',
      revision: page.items[0]!.revision,
      title: 'new',
    }),
  ).rejects.toThrow('changed')
  expect(json).toHaveBeenCalledTimes(2)
})
it('renders issues and comments belonging to deleted users', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({ ...issue, user: null })
    .mockResolvedValueOnce([
      { id: 12, body: 'Useful context', user: null, created_at: issue.updated_at },
    ])
  const detail = await new GitForgeWork({ json }, 'github', 'me/app').issue('1')
  expect(detail.issue.author).toBe('Deleted user')
  expect(detail.comments[0]?.author).toBe('Deleted user')
})
it('does not create an endless next page for Gitea workflow definitions', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue({
    workflows: Array.from({ length: 30 }, (_, i) => ({ id: `ci-${i}.yml`, name: `CI ${i}` })),
  })
  const result = await new GitForgeWork({ json }, 'gitea', 'me/app').definitions()
  expect(result.items).toHaveLength(30)
  expect(result.next).toBeUndefined()
  expect(json).toHaveBeenCalledExactlyOnceWith('api/v1/repos/me/app/actions/workflows', undefined)
})
it('uses Forgejo update times and Gitea workflow paths and completion times', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      workflow_runs: [
        {
          id: 5,
          title: 'CI',
          html_url: 'https://forge.test/me/app/actions/runs/5',
          status: 'success',
          created: '2026-09-20T10:00:00Z',
          updated: '2026-09-20T10:05:00Z',
          workflow_id: 'ci.yaml',
        },
      ],
    })
    .mockResolvedValueOnce({
      workflow_runs: [
        {
          id: 6,
          display_title: 'CI',
          html_url: 'https://forge.test/me/app/actions/runs/6',
          status: 'completed',
          started_at: '2026-09-20T10:00:00Z',
          completed_at: '2026-09-20T10:05:00Z',
          path: '.gitea/workflows/ci.yaml',
        },
      ],
    })
  const forgejo = await new GitForgeWork({ json }, 'forgejo', 'me/app').pipelines()
  const gitea = await new GitForgeWork({ json }, 'gitea', 'me/app').pipelines()
  expect(forgejo.items[0]?.updatedAt).toBe('2026-09-20T10:05:00Z')
  expect(gitea.items[0]).toMatchObject({ updatedAt: '2026-09-20T10:05:00Z', definition: 'ci.yaml' })
})
it('does not dispatch unimplemented Gitea cancellation', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ version: '1.27.3' })
  await expect(
    new GitForgeWork({ json }, 'gitea', 'me/app').actOnPipeline({ action: 'cancel', id: '5' }),
  ).rejects.toThrow('unavailable')
  expect(json).toHaveBeenCalledTimes(1)
})
it('dispatches workflow inputs once and keeps them out of command arguments', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue(null)
  await new GitForgeWork({ json }, 'github', 'me/app').actOnPipeline({
    action: 'run',
    definition: 'ci.yaml',
    ref: 'feature/demo',
    inputs: { target: 'preview' },
  })
  expect(json).toHaveBeenCalledExactlyOnceWith(
    'repos/me/app/actions/workflows/ci.yaml/dispatches',
    { method: 'POST', body: { ref: 'feature/demo', inputs: { target: 'preview' } } },
  )
})
it('does not emulate a Bitbucket rerun that would lose secured pipeline variables', async () => {
  const json = vi.fn<WorkHttp['json']>()
  await expect(
    new BitbucketForgeWork({ json }, 'me/app').actOnPipeline({ action: 'rerun', id: '123' }),
  ).rejects.toThrow('Use Bitbucket')
  expect(json).not.toHaveBeenCalled()
})
it('explicitly disables retired native Bitbucket issues', async () => {
  const provider = new BitbucketForgeWork({ json: vi.fn<WorkHttp['json']>() }, 'me/app')
  expect((await provider.options()).issues).toBe(false)
  await expect(
    provider.createIssue(forgeIssueCreateSchema.parse({ title: 'test', body: '' })),
  ).rejects.toThrow('no longer supports native issues')
})
it('rejects unbounded pipeline input counts', () => {
  expect(
    forgePipelineActionSchema.safeParse({
      action: 'run',
      definition: 'ci.yml',
      ref: 'main',
      inputs: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), 'x'])),
    }).success,
  ).toBe(false)
})
it('can list Azure pipeline capabilities without requiring work item permissions', async () => {
  const json = vi.fn<WorkHttp['json']>()
  const provider = new AzureForgeWork(
    {
      json,
      jsonResponse: vi.fn<ForgeHttp['jsonResponse']>(),
      connection: {
        id: 'az',
        name: 'Azure',
        provider: 'azure-devops',
        baseUrl: 'https://dev.azure.com/org',
        credential: 'cli',
        revision: '1',
      },
    },
    'Project/repo',
  )
  expect((await provider.options(undefined, 'pipelines')).pipelineActions).toContain('run')
  expect(json).not.toHaveBeenCalled()
})

const azureItem = {
  id: 3,
  rev: 1,
  fields: {
    'System.Title': 'Task',
    'System.TeamProject': 'Project',
    'System.State': 'Active',
    'System.WorkItemType': 'Task',
    'System.ChangedDate': '2026-09-20T10:00:00Z',
  },
}
function azureProvider(json: WorkHttp['json']) {
  return new AzureForgeWork(
    {
      json,
      jsonResponse: vi.fn<ForgeHttp['jsonResponse']>(),
      connection: {
        id: 'az',
        name: 'Azure',
        provider: 'azure-devops',
        baseUrl: 'https://dev.azure.com/org',
        credential: 'cli',
        revision: '1',
      },
    },
    'Project/repo',
  )
}
it('searches Azure work items in their project and quotes WIQL literals', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ workItems: [] })
  await azureProvider(json).issues('all', undefined, "developer's login")
  expect(json).toHaveBeenCalledExactlyOnceWith('Project/_apis/wit/wiql?$top=31&api-version=7.1', {
    method: 'POST',
    body: {
      query:
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Project' AND ([System.Title] CONTAINS 'developer''s login' OR [System.Description] CONTAINS 'developer''s login') ORDER BY [System.Id] DESC",
    },
  })
})
it('accepts the documented null Azure comment continuation token', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce(azureItem)
    .mockResolvedValueOnce({
      comments: [
        {
          id: 1,
          text: '**Markdown**',
          format: 0,
          createdBy: { displayName: 'Dominic' },
          createdDate: '2026-09-20T10:00:00Z',
        },
      ],
      continuationToken: null,
    })
  const detail = await azureProvider(json).issue('3')
  expect(detail.comments[0]?.body).toBe('**Markdown**')
  expect(detail.next).toBeUndefined()
})
it('preserves WIQL order when Azure batch results use a different order', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({ workItems: [{ id: 3 }, { id: 2 }, { id: 1 }] })
    .mockResolvedValueOnce({ value: [1, 2, 3].map((id) => ({ ...azureItem, id })) })
  const page = await azureProvider(json).issues('all')
  expect(page.items.map((item) => item.id)).toEqual(['3', '2', '1'])
})

const gitRun = {
  id: 5,
  name: 'CI',
  html_url: 'https://forge.test/me/app/actions/runs/5',
  status: 'completed',
  conclusion: 'success',
}
it.each(['github', 'gitea', 'forgejo'] as const)(
  'rejects rerunning active or unknown %s runs using the fresh native status',
  async (provider) => {
    for (const status of ['queued', 'in_progress', 'unknown']) {
      const json = vi
        .fn<WorkHttp['json']>()
        .mockImplementation(async (path) =>
          path === 'api/v1/version'
            ? { version: provider === 'gitea' ? '1.27.3' : '16.0.0' }
            : { ...gitRun, status },
        )
      await expect(
        new GitForgeWork({ json }, provider, 'me/app').actOnPipeline({ action: 'rerun', id: '5' }),
      ).rejects.toMatchObject({ status: 409 })
      expect(json.mock.calls.every(([, options]) => options?.method === undefined)).toBe(true)
      expect(json).toHaveBeenLastCalledWith(
        `${provider === 'github' ? '' : 'api/v1/'}repos/me/app/actions/runs/5`,
        undefined,
      )
    }
  },
)
it.each(['github', 'gitea', 'forgejo'] as const)(
  'allows rerunning cancelled %s runs after checking their current state',
  async (provider) => {
    const json = vi.fn<WorkHttp['json']>().mockImplementation(async (path) =>
      path === 'api/v1/version'
        ? { version: provider === 'gitea' ? '1.27.3' : '16.0.0' }
        : {
            ...gitRun,
            status: provider === 'github' ? 'completed' : 'cancelled',
            conclusion: 'cancelled',
          },
    )
    await new GitForgeWork({ json }, provider, 'me/app').actOnPipeline({ action: 'rerun', id: '5' })
    expect(json).toHaveBeenLastCalledWith(
      `${provider === 'github' ? '' : 'api/v1/'}repos/me/app/actions/runs/5/rerun`,
      { method: 'POST' },
    )
    expect(json).toHaveBeenCalledTimes(provider === 'github' ? 2 : 3)
  },
)
it.each(['github', 'forgejo'] as const)(
  'cancels active %s runs after checking their current state',
  async (provider) => {
    const json = vi.fn<WorkHttp['json']>().mockImplementation(async (path) =>
      path === 'api/v1/version'
        ? { version: '16.0.0' }
        : {
            ...gitRun,
            status: provider === 'github' ? 'in_progress' : 'running',
            conclusion: null,
          },
    )
    await new GitForgeWork({ json }, provider, 'me/app').actOnPipeline({
      action: 'cancel',
      id: '5',
    })
    expect(json).toHaveBeenLastCalledWith(
      `${provider === 'github' ? '' : 'api/v1/'}repos/me/app/actions/runs/5/cancel`,
      { method: 'POST' },
    )
  },
)
it.each(['github', 'forgejo'] as const)(
  'rejects cancelling finished, cancelling and unknown %s runs',
  async (provider) => {
    for (const status of ['completed', 'cancelling', 'unknown']) {
      const json = vi
        .fn<WorkHttp['json']>()
        .mockImplementation(async (path) =>
          path === 'api/v1/version'
            ? { version: '16.0.0' }
            : { ...gitRun, status, conclusion: null },
        )
      await expect(
        new GitForgeWork({ json }, provider, 'me/app').actOnPipeline({ action: 'cancel', id: '5' }),
      ).rejects.toMatchObject({ status: 409 })
      expect(json.mock.calls.every(([, options]) => options?.method === undefined)).toBe(true)
    }
  },
)

const azureBuild = {
  id: 5,
  buildNumber: '20260920.1',
  status: 'completed',
  result: 'canceled',
  queueTime: '2026-09-20T10:00:00Z',
  definition: { id: 1, name: 'CI' },
}
it.each(['inProgress', 'notStarted', 'postponed', 'cancelling', 'none'])(
  'rejects Azure retries for native status %s even when a previous result remains',
  async (status) => {
    const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ ...azureBuild, status })
    await expect(
      azureProvider(json).actOnPipeline({ action: 'rerun', id: '5' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(json).toHaveBeenCalledExactlyOnceWith(
      'Project/_apis/build/builds/5?api-version=7.1',
      undefined,
    )
  },
)
it('retries a completed cancelled Azure build once', async () => {
  const json = vi.fn<WorkHttp['json']>().mockResolvedValue(azureBuild)
  await azureProvider(json).actOnPipeline({ action: 'rerun', id: '5' })
  expect(json).toHaveBeenLastCalledWith('Project/_apis/build/builds/5?retry=true&api-version=7.1', {
    method: 'PATCH',
    body: {},
  })
  expect(json).toHaveBeenCalledTimes(2)
})
it.each(['inProgress', 'notStarted', 'postponed'])(
  'cancels an active Azure build with native status %s',
  async (status) => {
    const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ ...azureBuild, status })
    await azureProvider(json).actOnPipeline({ action: 'cancel', id: '5' })
    expect(json).toHaveBeenLastCalledWith('Project/_apis/build/builds/5?api-version=7.1', {
      method: 'PATCH',
      body: { status: 'cancelling' },
    })
  },
)
it.each(['completed', 'cancelling', 'none'])(
  'rejects cancelling an Azure build with native status %s',
  async (status) => {
    const json = vi.fn<WorkHttp['json']>().mockResolvedValue({ ...azureBuild, status })
    await expect(
      azureProvider(json).actOnPipeline({ action: 'cancel', id: '5' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(json).toHaveBeenCalledTimes(1)
  },
)

const bitbucketRun = {
  uuid: '{run-5}',
  build_number: 5,
  created_on: '2026-09-20T10:00:00Z',
  target: { ref_name: 'main' },
}
it.each(['PENDING', 'IN_PROGRESS'])(
  'cancels an active Bitbucket pipeline with native status %s',
  async (status) => {
    const json = vi.fn<WorkHttp['json']>().mockResolvedValue({
      ...bitbucketRun,
      state: { name: status, result: { name: 'FAILED' } },
    })
    await new BitbucketForgeWork({ json }, 'me/app').actOnPipeline({
      action: 'cancel',
      id: '{run-5}',
    })
    expect(json).toHaveBeenLastCalledWith(
      'repositories/me/app/pipelines/%7Brun-5%7D/stopPipeline',
      { method: 'POST' },
    )
  },
)
it.each(['COMPLETED', 'UNKNOWN'])(
  'rejects cancelling a Bitbucket pipeline with native status %s',
  async (status) => {
    const json = vi.fn<WorkHttp['json']>().mockResolvedValue({
      ...bitbucketRun,
      state: { name: status, result: { name: 'FAILED' } },
    })
    await expect(
      new BitbucketForgeWork({ json }, 'me/app').actOnPipeline({ action: 'cancel', id: '{run-5}' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(json).toHaveBeenCalledTimes(1)
  },
)
