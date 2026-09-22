import { expect, it, vi } from 'vitest'
import { forgePipelineDetailSchema } from '@dovo/protocol'
import { GitForgeWork } from './forge-work-git.js'
import { AzureForgeWork } from './forge-work-azure.js'
import { BitbucketForgeWork } from './forge-work-bitbucket.js'
import type { ForgeHttp } from './forge-http.js'
import type { WorkHttp } from './forge-work-types.js'

const started = '2026-09-20T10:00:00Z'
const completed = '2026-09-20T10:02:00Z'
const gitRun = {
  id: 42,
  html_url: 'https://github.com/me/app/actions/runs/42',
  head_branch: 'feature',
  head_sha: 'a'.repeat(40),
  status: 'completed',
  conclusion: 'failure',
  created_at: started,
  updated_at: completed,
}
const gitJob = {
  id: 43,
  name: 'Build',
  html_url: 'https://github.com/me/app/actions/runs/42/job/43',
  status: 'completed',
  conclusion: 'failure',
  runner_name: 'builder-1',
  started_at: started,
  completed_at: completed,
  steps: [
    {
      number: 1,
      name: 'Compile',
      status: 'completed',
      conclusion: 'failure',
      started_at: started,
      completed_at: completed,
    },
    {
      number: 2,
      name: 'Publish',
      status: 'completed',
      conclusion: 'skipped',
      started_at: null,
      completed_at: null,
    },
  ],
}

it('retains GitHub workflow context and timed runner steps without inventing run completion', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      ...gitRun,
      name: 'CI',
      display_title: 'Fix cancellation',
      run_number: 9,
      run_attempt: 2,
      event: 'push',
      run_started_at: started,
      head_commit: { message: 'Fix cancellation\n\nKeep retries idempotent.' },
    })
    .mockResolvedValueOnce({ jobs: [gitJob] })
  const detail = forgePipelineDetailSchema.parse(
    await new GitForgeWork({ json }, 'github', 'me/app').pipeline('42'),
  )
  expect(detail.run).toMatchObject({
    number: '9',
    attempt: 2,
    event: 'push',
    workflow: 'CI',
    startedAt: started,
    commitMessage: 'Fix cancellation\n\nKeep retries idempotent.',
  })
  expect(detail.run.completedAt).toBeUndefined()
  expect(detail.jobs[0]).toMatchObject({
    runner: 'builder-1',
    startedAt: started,
    completedAt: completed,
    steps: [
      {
        id: '1',
        number: 1,
        name: 'Compile',
        status: 'failure',
        startedAt: started,
        completedAt: completed,
      },
      { id: '2', name: 'Publish', status: 'skipped' },
    ],
  })
  expect(detail.jobs[0]?.steps?.[1]?.startedAt).toBeUndefined()
  expect(json).toHaveBeenCalledTimes(2)
})

it('normalizes the Gitea workflow path and legacy attempt sentinel, preserving skipped steps', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      ...gitRun,
      path: '.gitea/workflows/ci.yml',
      run_number: 9,
      run_attempt: 0,
      event: 'workflow_dispatch',
      started_at: started,
      completed_at: completed,
    })
    .mockResolvedValueOnce({ jobs: [gitJob] })
  const detail = forgePipelineDetailSchema.parse(
    await new GitForgeWork({ json }, 'gitea', 'me/app').pipeline('42'),
  )
  expect(detail.run).toMatchObject({
    workflow: 'ci.yml',
    number: '9',
    event: 'workflow_dispatch',
    startedAt: started,
    completedAt: completed,
  })
  expect(detail.run.attempt).toBeUndefined()
  expect(detail.jobs[0]?.steps?.map((step) => step.status)).toEqual(['failure', 'skipped'])
})

it('accepts null optional workflow metadata without dropping pending runs', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      ...gitRun,
      status: 'queued',
      conclusion: null,
      name: null,
      path: null,
      workflow_id: null,
      run_number: null,
      run_attempt: null,
      event: null,
      started_at: null,
      completed_at: null,
      head_commit: { message: null },
    })
    .mockResolvedValueOnce({
      jobs: [{ ...gitJob, runner_name: null, started_at: null, completed_at: null, steps: null }],
    })
  const detail = forgePipelineDetailSchema.parse(
    await new GitForgeWork({ json }, 'gitea', 'me/app').pipeline('42'),
  )
  expect(detail.run.number).toBeUndefined()
  expect(detail.run.workflow).toBeUndefined()
  expect(detail.run.attempt).toBeUndefined()
  expect(detail.run.event).toBeUndefined()
  expect(detail.jobs[0]?.runner).toBeUndefined()
  expect(detail.jobs[0]?.steps).toBeUndefined()
})

it('uses Forgejo native run timing and leaves unsupported job details absent', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      id: 42,
      html_url: 'https://codeberg.org/me/app/actions/runs/9',
      index_in_repo: 9,
      title: 'Fix cancellation',
      event: 'pull_request',
      trigger_event: 'pull_request_target',
      workflow_id: 'ci.yml',
      status: 'running',
      started,
      stopped: '0001-01-01T00:00:00Z',
      created: started,
      updated: completed,
    })
    .mockResolvedValueOnce([
      { id: 43, name: 'Build', status: 'running', runs_on: ['ubuntu-latest'] },
    ])
  const detail = forgePipelineDetailSchema.parse(
    await new GitForgeWork({ json }, 'forgejo', 'me/app').pipeline('42'),
  )
  expect(detail.run).toMatchObject({
    number: '9',
    event: 'pull_request_target',
    workflow: 'ci.yml',
    startedAt: started,
  })
  expect(detail.run.completedAt).toBeUndefined()
  expect(detail.jobs[0]?.runner).toBeUndefined()
  expect(detail.jobs[0]?.steps).toBeUndefined()
  expect(detail.jobs[0]?.startedAt).toBeUndefined()
})

it('groups Azure tasks under their own jobs and retains ordered steps with bounded errors', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      id: 42,
      buildNumber: 'release-2026.9',
      status: 'completed',
      result: 'failed',
      queueTime: started,
      startTime: started,
      finishTime: completed,
      reason: 'individualCI',
      definition: { id: 5, name: 'Release' },
    })
    .mockResolvedValueOnce({
      records: [
        {
          id: 'job-2',
          name: null,
          type: 'Job',
          state: 'completed',
          result: 'skipped',
          order: 2,
          workerName: null,
          startTime: null,
          finishTime: null,
        },
        {
          id: 'compile',
          parentId: 'job-1',
          name: 'Compile',
          type: 'Task',
          state: 'completed',
          result: 'failed',
          order: 2,
          startTime: started,
          finishTime: completed,
          issues: [
            { type: 'warning', message: 'Omit warning from errors' },
            ...Array.from({ length: 12 }, (_, i) => ({
              type: 'error',
              message: `Failure ${i}: ${'x'.repeat(2500)}`,
            })),
          ],
        },
        {
          id: 'job-1',
          name: 'Build',
          type: 'Job',
          state: 'completed',
          result: 'failed',
          workerName: 'agent-1',
          order: 1,
          startTime: started,
          finishTime: completed,
          issues: [{ type: 'error', message: 'Build failed' }],
        },
        {
          id: 'checkout',
          parentId: 'job-1',
          name: 'Checkout',
          type: 'Task',
          state: 'completed',
          result: 'succeeded',
          order: 1,
        },
        {
          id: 'publish',
          parentId: 'job-2',
          name: null,
          type: 'Task',
          state: 'completed',
          result: 'skipped',
          order: null,
        },
      ],
    })
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
  const detail = forgePipelineDetailSchema.parse(await provider.pipeline('42'))
  expect(detail.run).toMatchObject({
    number: 'release-2026.9',
    workflow: 'Release',
    event: 'individualCI',
    startedAt: started,
    completedAt: completed,
  })
  expect(detail.jobs.map((job) => job.id)).toEqual(['job-1', 'job-2'])
  expect(detail.jobs[0]).toMatchObject({
    runner: 'agent-1',
    errors: ['Build failed'],
    startedAt: started,
    completedAt: completed,
  })
  expect(detail.jobs[0]?.steps?.map((step) => step.id)).toEqual(['checkout', 'compile'])
  expect(detail.jobs[1]?.steps?.map((step) => step.id)).toEqual(['publish'])
  expect(detail.jobs[1]?.name).toBe('job-2')
  expect(detail.jobs[1]?.runner).toBeUndefined()
  expect(detail.jobs[1]?.steps?.[0]?.number).toBeUndefined()
  const step = detail.jobs[0]?.steps?.[1]
  expect(step?.errors).toHaveLength(10)
  expect(step?.errors?.[0]?.length).toBe(2000)
  expect(step?.errors?.[0]).toMatch(/…$/)
  expect(step?.url).toContain('&j=job-1&t=compile')
})

it('retains Bitbucket triggers, commits, timed steps and configuration errors without fake substeps', async () => {
  const json = vi
    .fn<WorkHttp['json']>()
    .mockResolvedValueOnce({
      uuid: '{run-42}',
      build_number: 42,
      created_on: started,
      completed_on: completed,
      trigger: { type: 'pipeline_trigger_manual' },
      target: {
        ref_name: 'main',
        commit: { hash: 'a'.repeat(40), message: 'Release fix' },
        selector: { pattern: 'release' },
      },
      state: {
        name: 'COMPLETED',
        result: { name: 'ERROR', error: { message: 'Configuration invalid' } },
      },
    })
    .mockResolvedValueOnce({
      values: [
        {
          uuid: '{step-43}',
          name: 'Build',
          started_on: started,
          completed_on: completed,
          state: {
            name: 'COMPLETED',
            result: { name: 'ERROR', error: { message: 'Runner unavailable' } },
          },
          script_commands: [{ name: 'Compile', command: 'pnpm build' }],
        },
      ],
    })
  const detail = forgePipelineDetailSchema.parse(
    await new BitbucketForgeWork({ json }, 'me/app').pipeline('{run-42}'),
  )
  expect(detail.run).toMatchObject({
    number: '42',
    event: 'manual',
    workflow: 'release',
    commitMessage: 'Release fix',
    completedAt: completed,
    errors: ['Configuration invalid'],
  })
  expect(detail.run.startedAt).toBeUndefined()
  expect(detail.jobs[0]).toMatchObject({
    name: 'Build',
    status: 'ERROR',
    startedAt: started,
    completedAt: completed,
    errors: ['Runner unavailable'],
  })
  expect(detail.jobs[0]?.steps).toBeUndefined()
  expect(detail.jobs[0]?.runner).toBeUndefined()
})

it('keeps previously cached minimal pipeline details valid', () => {
  const detail = forgePipelineDetailSchema.parse({
    run: {
      id: '1',
      title: 'CI',
      url: 'https://example.com/runs/1',
      ref: 'main',
      sha: '',
      actor: '',
      status: 'queued',
      createdAt: started,
      updatedAt: started,
    },
    jobs: [{ id: '2', name: 'Build', status: 'queued', url: 'https://example.com/runs/1' }],
  })
  expect(detail.run.workflow).toBeUndefined()
  expect(detail.jobs[0]?.steps).toBeUndefined()
})
