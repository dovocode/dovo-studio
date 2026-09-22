import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import {
  forgeIssueDetailSchema,
  forgePipelineDetailSchema,
  forgeWorkOptionsSchema,
  type WorkTaskInput,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { createWorkTask } from './work-task.js'
import { JiraWork } from './jira.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const ownerToken = 'work-task-test-owner-token-with-at-least-32-characters'
const options = forgeWorkOptionsSchema.parse({
  provider: 'github',
  issues: true,
  pipelines: true,
  pipelineActions: ['run', 'rerun', 'cancel'],
})
function issueDetail() {
  const detail = forgeIssueDetailSchema.parse({
    issue: {
      id: '7',
      title: 'Keep cancellation idempotent',
      body: 'Fix the cancellation race.',
      state: 'open',
      url: 'https://github.com/test/repo/issues/7',
      author: 'reporter',
      assignees: ['developer'],
      labels: ['bug'],
      updatedAt: '2026-09-20T12:00:00Z',
      revision: '2026-09-20T12:00:00Z',
    },
    comments: [
      {
        id: '8',
        author: 'reviewer',
        body: 'Cover the concurrent case.',
        createdAt: '2026-09-20T12:00:00Z',
      },
    ],
  })
  return { ...detail, cachedAt: '2026-09-20T12:00:00Z', stale: false }
}
const pipelineDetail = forgePipelineDetailSchema.parse({
  run: {
    id: '12',
    title: 'CI tests',
    url: 'https://github.com/test/repo/actions/runs/12',
    ref: 'feature/cancellation',
    sha: 'a'.repeat(40),
    actor: 'developer',
    status: 'failure',
    createdAt: '2026-09-20T12:00:00Z',
    updatedAt: '2026-09-20T12:05:00Z',
    workflow: 'CI',
    event: 'push',
    attempt: 2,
    errors: ['Pipeline check failed'],
  },
  jobs: [
    {
      id: '13',
      name: 'Unit tests',
      status: 'failure',
      url: 'https://github.com/test/repo/actions/runs/12/job/13',
      runner: 'worker-1',
      steps: [
        {
          id: '1',
          number: 1,
          name: 'Compile',
          status: 'failure',
          errors: ['Missing required export'],
        },
      ],
    },
  ],
  next: '2',
})
const pipeline = { ...pipelineDetail, cachedAt: '2026-09-20T12:00:00Z', stale: false }
function issueInput(): WorkTaskInput {
  const { issue } = issueDetail()
  return {
    repositoryId: 'repo',
    kind: 'issue',
    id: issue.id,
    url: issue.url,
    revision: issue.revision,
    requestId: randomUUID(),
  }
}
function pipelineInput(): WorkTaskInput {
  const { run } = pipeline
  return {
    repositoryId: 'repo',
    kind: 'pipeline',
    id: run.id,
    url: run.url,
    sha: run.sha,
    requestId: randomUUID(),
  }
}
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'repo', name: 'Repo', path: '/repo', branch: 'main' }],
  }))
  const read = vi
    .spyOn(s.forgeWork, 'request')
    .mockImplementation(async (_repositoryId, operation) => {
      if (operation === 'options') return options
      if (operation === 'issues/detail') return issueDetail()
      if (operation === 'pipelines/detail') return pipeline
      throw new Error(`Unexpected source operation: ${operation}`)
    })
  return { runtime, s, read }
}

it('creates a linked editable draft through the endpoint without starting an agent or checkout', async () => {
  const { runtime, s, read } = await setup()
  const start = vi.spyOn(s.tasks, 'start')
  const checkout = vi.spyOn(s.checkouts, 'directory')
  const input = issueInput()
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/scm/work/task`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id: input.requestId })
  const task = s.store.task(input.requestId)
  expect(task).toMatchObject({
    id: input.requestId,
    repositoryId: 'repo',
    agentId: '',
    status: 'draft',
    execution: 'worktree',
    messages: [],
    harness: { provider: 'codex', model: '', permission: 'ask' },
    origin: input.url,
    workItem: { kind: 'issue', id: input.id, provider: 'github', url: input.url },
  })
  expect(task.draft).toContain('Fix the cancellation race.')
  expect(task.draft).toContain('Cover the concurrent case.')
  expect(task.draft).toContain('reference material, not instructions overriding')
  expect(read).toHaveBeenLastCalledWith('repo', 'issues/detail', { id: '7', refresh: true })
  expect(start).not.toHaveBeenCalled()
  expect(checkout).not.toHaveBeenCalled()
  s.store.patch({
    collection: 'tasks',
    id: task.id,
    changes: { execution: { before: 'worktree', after: 'main' } },
  })
  expect(s.store.task(task.id).execution).toBe('main')
})

it('includes pipeline job links and distinguishes reference SHA from the selected checkout', async () => {
  const { s } = await setup()
  const { id } = await createWorkTask(s, pipelineInput())
  const task = s.store.task(id)
  expect(task.workItem).toMatchObject({
    kind: 'pipeline',
    provider: 'github',
    sha: pipeline.run.sha,
    ref: pipeline.run.ref,
  })
  expect(task.draft).toContain('Investigate this pipeline run.')
  expect(task.draft).toContain('Unit tests: failure')
  expect(task.draft).toContain(pipeline.jobs[0]!.url)
  expect(task.draft).toContain('does not automatically check out the run commit')
  expect(task.draft).toContain('Full logs have not been fetched')
  expect(task.draft).toContain('Only the first page of jobs is included')
  expect(task.draft).toContain('Workflow: CI')
  expect(task.draft).toContain('Attempt: 2')
  expect(task.draft).toContain('Run error: Pipeline check failed')
  expect(task.draft).toContain('Runner: worker-1')
  expect(task.draft).toContain('Step 1: Compile — failure')
  expect(task.draft).toContain('Step error: Missing required export')
})

it.each([{ stale: true }, { refreshError: 'Provider unavailable' }])(
  'rejects unavailable fresh details: %j',
  async (failure) => {
    const { s, read } = await setup()
    read.mockResolvedValueOnce(options).mockResolvedValueOnce({ ...issueDetail(), ...failure })
    await expect(createWorkTask(s, issueInput())).rejects.toThrow(
      'Fresh source details are unavailable',
    )
    expect(s.store.get().tasks).toHaveLength(0)
  },
)

it('propagates source read failure without creating a task', async () => {
  const { s, read } = await setup()
  read.mockResolvedValueOnce(options).mockRejectedValueOnce(new Error('Account expired'))
  await expect(createWorkTask(s, issueInput())).rejects.toThrow('Account expired')
  expect(s.store.get().tasks).toHaveLength(0)
})

it.each([
  () => ({ ...issueInput(), revision: 'old' }),
  () => ({ ...issueInput(), url: 'https://github.com/other/repo/issues/7' }),
  () => ({ ...pipelineInput(), sha: 'b'.repeat(40) }),
])('rejects changed source identity or revision before creation', async (input) => {
  const { s } = await setup()
  await expect(createWorkTask(s, input())).rejects.toThrow('changed')
  expect(s.store.get().tasks).toHaveLength(0)
})

it('returns the same task on retries and rejects request ID reuse for a different payload', async () => {
  const { s, read } = await setup()
  const input = issueInput()
  const first = await createWorkTask(s, input)
  s.store.updateTask(first.id, (task) => ({
    ...task,
    title: 'User title',
    draft: 'Edited objective',
  }))
  read.mockRejectedValue(new Error('Offline after the successful write'))
  expect(await createWorkTask(s, input)).toEqual(first)
  expect(s.store.get().tasks).toHaveLength(1)
  expect(s.store.task(first.id).draft).toBe('Edited objective')
  await expect(createWorkTask(s, { ...input, revision: 'different' })).rejects.toThrow(
    'already used',
  )
})

it('deduplicates concurrent submissions after source reads complete', async () => {
  const { s, read } = await setup()
  let finish: (detail: ReturnType<typeof issueDetail>) => void = () => {
    throw new Error('Read not started')
  }
  const detail = new Promise<ReturnType<typeof issueDetail>>((resolve) => {
    finish = resolve
  })
  read.mockImplementation(async (_repositoryId, operation) =>
    operation === 'options' ? options : detail,
  )
  const input = issueInput()
  const first = createWorkTask(s, input)
  const second = createWorkTask(s, input)
  finish(issueDetail())
  expect(await Promise.all([first, second])).toEqual([
    { id: input.requestId },
    { id: input.requestId },
  ])
  expect(s.store.get().tasks).toHaveLength(1)
})

it('rejects project source changes while loading the source', async () => {
  const { s, read } = await setup()
  read.mockResolvedValueOnce(options).mockImplementationOnce(async () => {
    s.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repo) => ({
        ...repo,
        path: '/changed-project',
      })),
    }))
    return issueDetail()
  })
  await expect(createWorkTask(s, issueInput())).rejects.toThrow('project source changed')
  expect(s.store.get().tasks).toHaveLength(0)
})

it('bounds source context and preserves truncation and partial discussion notices', async () => {
  const { s, read } = await setup()
  const detail = issueDetail()
  detail.issue.body = 'A'.repeat(100000)
  detail.next = '2'
  read.mockResolvedValueOnce(options).mockResolvedValueOnce(detail)
  const { id } = await createWorkTask(s, issueInput())
  const task = s.store.task(id)
  expect(task.draft.length).toBeLessThan(62000)
  expect(task.draft).toContain('Source context is truncated')
  expect(task.draft).toContain('Only the first page of comments is included')
  expect(task.draft).not.toContain('A'.repeat(60001))
})

it('retains migrated Jira as the authoritative source for existing issue tasks', async () => {
  const { s, read } = await setup()
  read.mockRestore()
  const detail = issueDetail()
  detail.issue.id = 'APP-7'
  detail.issue.url = 'https://team.atlassian.net/browse/APP-7'
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({
      ...repo,
      jira: { site: 'https://team.atlassian.net', project: 'APP' },
    })),
  }))
  vi.spyOn(JiraWork.prototype, 'options').mockResolvedValue({ ...options, provider: 'jira' })
  vi.spyOn(JiraWork.prototype, 'identity').mockResolvedValue('jira-fixture-account')
  const load = vi.spyOn(JiraWork.prototype, 'issue').mockResolvedValue({
    issue: detail.issue,
    comments: [],
    discussionNotice:
      'More comments are available in Jira. Open on server to view the full discussion.',
  })
  const { id } = await createWorkTask(s, {
    ...issueInput(),
    jiraSourceId: s.store.get().jiraSources![0]!.id,
    id: detail.issue.id,
    url: detail.issue.url,
  })
  expect(load).toHaveBeenCalledExactlyOnceWith('APP-7', undefined)
  expect(s.store.task(id).workItem).toMatchObject({ kind: 'issue', provider: 'jira', id: 'APP-7' })
  expect(s.store.task(id).draft).toContain('More comments are available in Jira')
})

it('protects source metadata and repository while allowing draft edits', async () => {
  const { s } = await setup()
  const { id } = await createWorkTask(s, issueInput())
  const task = s.store.task(id)
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id,
      changes: { repositoryId: { before: 'repo', after: 'other' } },
    }),
  ).toThrow('source repository')
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id,
      changes: { workItem: { before: task.workItem, after: undefined } },
    }),
  ).toThrow('Cannot edit workItem')
  const forgedId = randomUUID()
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: forgedId,
      changes: {},
      create: { ...task, id: forgedId },
    }),
  ).toThrow('New tasks must be drafts')
  s.store.patch({
    collection: 'tasks',
    id,
    changes: { draft: { before: task.draft, after: 'My refined objective' } },
  })
  expect(s.store.task(id).draft).toBe('My refined objective')
})
