import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { taskWaiting } from './task-waiting.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})

it('keeps related PRs linked and hides completed pipelines from project info', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'task-waiting-test-owner-token-at-least-32-characters',
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Fix',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const url = 'https://github.com/team/project/pull/7'
  s.store.updateTask(task.id, (task) => ({
    ...task,
    pullRequest: {
      number: 7,
      url,
      repositoryUrl: 'https://github.com/team/project',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
    },
    linkedPullRequests: [
      { number: 7, url, title: 'Related PR', repositoryUrl: 'https://github.com/team/project' },
    ],
  }))
  vi.spyOn(s.pullRequestWatch, 'manage').mockResolvedValue({ watches: [] })
  const pipeline = {
    repositoryId: 'repo',
    runId: '8',
    url: 'https://github.com/team/project/actions/runs/8',
    sha: '',
    status: 'completed' as const,
    runStatus: 'success',
    startedAt: '',
    checkedAt: '',
  }
  vi.spyOn(s.pipelineWatch, 'manage').mockResolvedValue({ watches: [pipeline] })
  const result = await taskWaiting(s, { taskId: task.id })
  expect(result.dependencies).toEqual([])
  expect(result.related).toEqual([{ label: 'PR #7', project: 'Test', url }])
})
