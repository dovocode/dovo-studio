import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { agentPipeline } from './agent-pipeline.js'

it('reads a scoped job log and retries failed jobs only on a writable thread', async () => {
  const f = await fixture()
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'agent-pipeline-test-token-at-least-32-characters',
    port: 0,
  })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'CI follow-up',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: '',
    })
    const validate = vi.fn<() => void>()
    vi.spyOn(s.tasks, 'assertToolScope').mockImplementation(() => {})
    vi.spyOn(s.pulls, 'sourceContext').mockResolvedValue({
      host: 'github.com',
      provider: 'github',
      repository: 'team/project',
      readerIdentity: 'reader',
      destination: 'destination',
      validate,
    })
    const url = 'https://github.com/team/project/actions/runs/31'
    let jobRun = 31
    const gh = vi.spyOn(s.git, 'githubAccount').mockImplementation(async (args) => {
      if (args[0] === 'run') return 'unit tests\tRun test\tFAIL'
      if (args.includes('repos/team/project/actions/jobs/7'))
        return JSON.stringify({ run_id: jobRun, run_attempt: 2 })
      if (args.includes('repos/team/project/actions/runs/31'))
        return JSON.stringify({
          id: 31,
          html_url: url,
          status: 'completed',
          conclusion: 'failure',
          run_attempt: 2,
        })
      if (args.includes('repos/team/project/actions/runs/31/rerun-failed-jobs')) return ''
      throw new Error('Unexpected GitHub call')
    })
    const input = { taskId: task.id, parentRunId: 'turn', runId: '31' }
    await expect(
      agentPipeline(s, { ...input, action: 'failed-logs', jobId: '7' }, true),
    ).resolves.toMatchObject({
      id: '31',
      url,
      status: 'failure',
      log: expect.stringContaining('Run test'),
    })
    expect(gh.mock.calls.some(([args]) => args.includes('--log-failed'))).toBe(true)
    gh.mockClear()
    jobRun = 32
    await expect(
      agentPipeline(s, { ...input, action: 'failed-logs', jobId: '7' }, true),
    ).rejects.toThrow('current run attempt')
    expect(gh.mock.calls.some(([args]) => args.includes('--log-failed'))).toBe(false)

    gh.mockClear()
    expect(() => agentPipeline(s, { ...input, action: 'retry-failed' }, true)).toThrow(
      'writable thread',
    )
    expect(() =>
      agentPipeline(s, { ...input, action: 'retry-failed', repositoryId: 'unlinked' }, false),
    ).toThrow('editable linked project')
    expect(gh).not.toHaveBeenCalled()

    await expect(
      agentPipeline(s, { ...input, action: 'retry-failed' }, false),
    ).resolves.toMatchObject({ id: '31', url })
    expect(gh.mock.calls.at(-1)?.[0]).toEqual([
      'api',
      '--hostname',
      'github.com',
      '--method',
      'POST',
      'repos/team/project/actions/runs/31/rerun-failed-jobs',
    ])
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
