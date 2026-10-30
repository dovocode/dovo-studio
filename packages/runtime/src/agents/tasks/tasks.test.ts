import { runtimeIntegration, waitForRuntime as waitForTask } from '../../testing/integration'
import {
  decode,
  questionPromptSchema,
  conversationTurns,
  recentTools,
  conversationToolsByMessage,
} from '@dovo/protocol'
import type { AgentAdapter } from '../execution/types'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import type { AgentRun, AgentSteer } from '../execution/types'
import { defaultTaskHarness, type Agent, type Task } from '@dovo/protocol'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => f.workspace)
  return runtime.services
}
it('refreshes harness sessions when optional MCP features change and favors replies over artifacts', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('feature-session')
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Optional tools',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const tools = (index: number) =>
    runs[index]?.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
  expect(tools(0)?.envValues).toMatchObject({
    DOVO_TASK_LINKED_PROJECTS_ENABLED: '1',
    DOVO_TASK_PR_WATCHING_ENABLED: '0',
    DOVO_TASK_PIPELINE_WATCHING_ENABLED: '0',
    DOVO_TASK_ARTIFACTS_ENABLED: '0',
    DOVO_TASK_MEMORY_SCOPES: '[]',
  })
  expect(runs[0]?.agent.instructions).not.toContain('Experimental PR watching')
  expect(runs[0]?.agent.instructions).not.toContain('Memory is available')
  s.memory.configure({ scope: 'system', enabled: true })
  s.memory.configure({ scope: 'project', repositoryId: 'repo', enabled: true })
  s.memory.write({
    scope: 'project',
    repositoryId: 'repo',
    key: 'note',
    content: 'Notes must be explicitly read',
  })
  s.preferences.save({
    enablePullRequestWatching: true,
    enablePipelineWatching: true,
    enableArtifacts: true,
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1]?.sessionId).toBeUndefined()
  expect(tools(1)?.envValues).toMatchObject({
    DOVO_TASK_PR_WATCHING_ENABLED: '1',
    DOVO_TASK_PIPELINE_WATCHING_ENABLED: '1',
    DOVO_TASK_ARTIFACTS_ENABLED: '1',
    DOVO_TASK_MEMORY_SCOPES: '["system","project"]',
  })
  expect(runs[1]?.agent.instructions).toContain('instead of running your own polling loops')
  expect(runs[1]?.agent.instructions).toContain('Prefer normal replies and repository files')
  expect(runs[1]?.agent.instructions).toContain('dovo_task pipeline_watch')
  expect(runs[1]?.agent.instructions).toContain('Proactively watch relevant CI and release runs')
  expect(runs[1]?.agent.instructions).toContain(
    'Register replacement runs after a new push or rerun',
  )
  expect(runs[1]?.agent.instructions).toContain(
    'If registration fails, report that monitoring is not active',
  )
  expect(runs[1]?.agent.instructions).not.toContain(
    'register merely because you triggered a pipeline',
  )
  expect(runs[1]?.agent.instructions).toContain('Memory is available')
  expect(runs[1]?.agent.instructions).not.toContain('Notes must be explicitly read')
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[2]?.sessionId).toBe('feature-session')
  s.preferences.save({ enablePullRequestWatching: false, enableLinkedProjectsTool: false })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[3]?.sessionId).toBeUndefined()
  expect(tools(3)?.envValues?.DOVO_TASK_PR_WATCHING_ENABLED).toBe('0')
  expect(tools(3)?.envValues?.DOVO_TASK_LINKED_PROJECTS_ENABLED).toBe('0')
  expect(runs[3]?.agent.instructions).not.toContain('regular dovo_task linked_projects tool')
  expect(runs[3]?.agent.instructions).not.toContain('Experimental PR watching')
  s.preferences.save({ enablePipelineWatching: false })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[4]?.sessionId).toBeUndefined()
  expect(tools(4)?.envValues?.DOVO_TASK_PIPELINE_WATCHING_ENABLED).toBe('0')
  expect(runs[4]?.agent.instructions).not.toContain('Experimental pipeline watching')
  s.memory.configure({ scope: 'system', enabled: false })
  s.memory.configure({ scope: 'project', repositoryId: 'repo', enabled: false })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[5]?.sessionId).toBeUndefined()
  expect(tools(5)?.envValues?.DOVO_TASK_MEMORY_SCOPES).toBe('[]')
  expect(runs[5]?.agent.instructions).not.toContain('Memory is available')
  s.preferences.save({ enableLinkedProjectsTool: true })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[6]?.sessionId).toBeUndefined()
  expect(tools(6)?.envValues?.DOVO_TASK_LINKED_PROJECTS_ENABLED).toBe('1')
  expect(runs[6]?.agent.instructions).toContain('regular dovo_task linked_projects tool')
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[7]?.sessionId).toBe('feature-session')
  s.preferences.save({ enableLinkedProjectsTool: false })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[8]?.sessionId).toBeUndefined()
  expect(tools(8)?.envValues?.DOVO_TASK_LINKED_PROJECTS_ENABLED).toBe('0')
  expect(runs[8]?.agent.instructions).not.toContain('regular dovo_task linked_projects tool')
})
it('publishes the first provider text immediately and batches subsequent tokens', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onText('First token')
    expect(s.store.task(input.taskId!).messages.at(-1)?.text).toBe('First token')
    input.onText(' and second')
    expect(s.store.task(input.taskId!).messages.at(-1)?.text).toBe('First token')
    input.onTextBoundary?.()
    expect(s.store.task(input.taskId!).messages.at(-1)?.text).toBe('First token and second')
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const task = s.tasks.create({
    title: 'Streaming',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Reply',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(run).toHaveBeenCalledOnce()
  expect(s.store.task(task.id).status).toBe('review')
})
it('starts due follow-ups and chained drafts from the host scheduler', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onText('Done')
    },
  })
  const source = s.tasks.create({
    title: 'Source',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First',
  })
  await (
    await s.tasks.start(source.id)
  ).done
  const follower = s.tasks.create({
    title: 'Follower',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Second',
  })
  s.store.updateTask(follower.id, (task) => ({
    ...task,
    startAfter: { taskId: source.id, messageId: 'chain', text: '' },
  }))
  await s.tasks.runScheduled()
  expect(s.store.task(follower.id).startAfter).toBeUndefined()
  expect(s.store.task(follower.id).status).not.toBe('draft')
  s.store.updateTask(source.id, (task) => ({
    ...task,
    scheduledMessages: [
      { id: 'later', text: 'Check CI', at: new Date(Date.now() - 1000).toISOString() },
    ],
  }))
  await s.tasks.runScheduled()
  expect(s.store.task(source.id).scheduledMessages).toEqual([])
  expect(
    s.store.task(source.id).queue?.some((message) => message.id === 'later') ||
      s.store.task(source.id).messages.some((message) => message.id === 'later'),
  ).toBe(true)
})
it('streams, resumes a task and starts a fresh session when its configuration changes', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('session-1')
      run.onEvent?.('tool.completed', {
        command: 'git status',
        exitCode: 0,
      })
      run.onText('Hello')
      run.onText(' world')
    },
  })
  const task = s.tasks.create({
    title: 'Test',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First request',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(
    runs[0].agent.resources?.mcpServers.find((server) => server.name === 'dovo_task'),
  ).toMatchObject({
    enabled: true,
    transport: 'stdio',
    envValues: { DOVO_TASK_ID: task.id, DOVO_TASK_READ_ONLY: '0' },
  })
  expect(s.store.task(task.id).messages.at(-1)?.text).toBe('Hello world')
  expect(s.store.task(task.id).status).toBe('review')
  expect(s.store.task(task.id).turns?.at(-1)?.runtimeHost).toBeTruthy()
  expect(s.activity.list('tool.completed', 'agent-event', 0).events[0].payload).toContain(
    'git status',
  )
  s.store.updateTaskHistory(task.id, (t) => ({
    ...t,
    messages: [
      ...t.messages,
      {
        id: 'followup',
        role: 'user',
        text: 'Follow up',
      },
    ],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1].sessionId).toBe('session-1')
  expect(runs[1].prompt).toBe('user: Follow up')
  s.store.patch({
    collection: 'agents',
    id: 'agent',
    changes: {
      instructions: {
        before: '',
        after: 'Changed',
      },
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[2].sessionId).toBeUndefined()
  s.store.patch({
    collection: 'agents',
    id: 'agent',
    changes: {
      reasoning: {
        before: null,
        after: 'high',
      },
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[3].sessionId).toBeUndefined()
  expect(runs[3].agent.reasoning).toBe('high')
})
it('records a provider-confirmed manual compaction on the resumed session', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('session-1')
      if (run.compact)
        run.onEvent?.('item/completed', {
          item: { id: 'compact', type: 'contextCompaction' },
        })
      else run.onText('Initial answer')
    },
  })
  const task = s.tasks.create({
    title: 'Compaction',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First request',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTaskHistory(task.id, (current) => ({
    ...current,
    messages: [...current.messages, { id: 'compact-request', role: 'user', text: '/compact' }],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1]).toMatchObject({ compact: true, prompt: '/compact', sessionId: 'session-1' })
  expect(s.store.task(task.id).compactions).toMatchObject([
    { provider: 'codex', trigger: 'manual', sessionId: 'session-1', textOffset: 0 },
  ])
  expect(s.store.task(task.id).contextUsage).toBeUndefined()
})
it('serializes repository runs and cancellation denies pending approvals and releases the lock', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(await run.approve('Command', 'test')).toBe('deny')
      run.signal.throwIfAborted()
    },
  })
  const task = s.tasks.create({
    title: 'First',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Test',
  })
  const second = s.tasks.create({
    title: 'Second',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Test',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(s.approvals.list()).toHaveLength(1))
  await expect(s.tasks.start(second.id)).rejects.toThrow('Another task')
  s.tasks.cancel(task.id)
  await expect(execution.done).rejects.toThrow('Cancelled')
  expect(s.approvals.list()).toHaveLength(0)
  expect(s.store.task(task.id).status).toBe('cancelled')
  expect(s.store.task(task.id).turns?.at(-1)?.checkpoint?.after).toBeTruthy()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async () => {},
  })
  await (
    await s.tasks.start(second.id)
  ).done
})
it('preserves line steering and includes it in the next agent turn', async () => {
  const s = await setup(),
    prompts: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      prompts.push(run.prompt)
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Review',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Fix',
  })
  s.store.updateTask(task.id, (t) => ({
    ...t,
    files: [
      {
        path: 'a.ts',
        before: 'old',
        after: 'new',
        viewed: false,
      },
    ],
  }))
  const starting = s.tasks.start(task.id)
  s.tasks.feedback({
    id: task.id,
    path: 'a.ts',
    side: 'additions',
    start: 1,
    end: 1,
    excerpt: 'new',
    body: 'Handle cancellation',
  })
  expect(s.store.task(task.id).messages.at(-1)?.diffComment?.body).toBe('Handle cancellation')
  expect(() =>
    s.tasks.feedback({
      id: task.id,
      path: 'a.ts',
      side: 'additions',
      start: 1,
      end: 1,
      excerpt: 'stale',
      body: 'Fix',
    }),
  ).toThrow('diff changed')
  await (
    await starting
  ).done
  expect(prompts[0]).toContain('a.ts:1-1 (new version)')
  expect(prompts[0]).toContain('Handle cancellation')
})
it('queues follow-ups during a turn, deduplicates retries and drains in the chosen order', async () => {
  const s = await setup(),
    prompts: string[] = []
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      prompts.push(run.prompt)
      run.onSession('queue-session')
      if (prompts.length === 1) await gate
      run.onText('Completed')
    },
  })
  const task = s.tasks.create({
    title: 'Queue',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(prompts).toHaveLength(1))
  await s.tasks.send(task.id, 'second', 'Second')
  await s.tasks.send(task.id, 'second', 'Second')
  await s.tasks.send(task.id, 'third', 'Third')
  s.tasks.queue.change(task.id, 'up', 'third')
  expect(s.store.task(task.id).queue).toHaveLength(2)
  release()
  await execution.done
  expect(prompts.slice(1)).toEqual(['user: Third', 'user: Second'])
  expect(s.store.task(task.id).queue).toEqual([])
  expect(s.store.task(task.id).turns?.map((turn) => turn.status)).toEqual([
    'completed',
    'completed',
    'completed',
  ])
  expect(s.store.task(task.id).messages.filter((m) => m.id === 'second')).toHaveLength(1)
})
it('pauses remaining input on cancellation and retains failed input on resume', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onSession('interrupted')
      await run.approve('Wait', 'Fixture')
      run.signal.throwIfAborted()
    },
  })
  const task = s.tasks.create({
    title: 'Pause',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Keep this instruction',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(s.approvals.list()).toHaveLength(1))
  await s.tasks.send(task.id, 'followup', 'Then verify')
  s.tasks.cancel(task.id)
  await expect(execution.done).rejects.toThrow('Cancelled by user')
  expect(s.store.task(task.id).queuePaused).toBe(true)
  expect(s.store.task(task.id).queue).toHaveLength(1)
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(run.prompt).toContain('Keep this instruction')
      expect(run.prompt).toContain('Then verify')
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(s.store.task(task.id).turns?.map((turn) => turn.status)).toEqual([
    'cancelled',
    'completed',
  ])
})
it('reserves tasks before checkout preparation and isolates task model overrides', async () => {
  const s = await setup()
  const task = s.tasks.create({
    title: 'Reserve',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Test',
  })
  s.store.patch({
    collection: 'tasks',
    id: task.id,
    changes: {
      agentOverrides: {
        before: null,
        after: {
          model: 'custom-model',
          reasoning: 'high',
        },
      },
    },
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(run.agent.model).toBe('custom-model')
      expect(run.agent.reasoning).toBe('high')
    },
  })
  const first = s.tasks.start(task.id)
  await expect(s.tasks.start(task.id)).rejects.toThrow('already running')
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: task.id,
      changes: {
        archived: {
          before: null,
          after: true,
        },
      },
    }),
  ).toThrow('Stop the active turn')
  await (
    await first
  ).done
  expect(s.store.get().agents[0].model).not.toBe('custom-model')
})
it('keeps completed agent work successful when the diff refresh fails', async () => {
  const s = await setup()
  vi.spyOn(s.git, 'changes').mockRejectedValue(new Error('Review path unavailable'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => run.onText('Done'),
  })
  const task = s.tasks.create({
    title: 'Review failure',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(s.store.task(task.id).status).toBe('review')
  expect(s.store.task(task.id).turns?.[0].status).toBe('completed')
  expect(s.store.task(task.id).error).toContain('Could not refresh changes')
})
it('retains the full conversation when a fresh session fails after a configuration change', async () => {
  const s = await setup(),
    prompts: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      prompts.push(run.prompt)
      run.onSession(prompts.length === 1 ? 'original-session' : 'replacement-session')
      if (prompts.length === 2) throw new Error('Provider disconnected')
      run.onText('Completed')
    },
  })
  const task = s.tasks.create({
    title: 'Resume changed agent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Preserve the original requirement',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.patch({
    collection: 'tasks',
    id: task.id,
    changes: {
      agentOverrides: {
        before: null,
        after: {
          model: 'another-model',
        },
      },
    },
  })
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Provider disconnected')
  await (
    await s.tasks.start(task.id)
  ).done
  expect(prompts[2]).toContain('Preserve the original requirement')
  expect(prompts[2]).toContain('assistant: Completed')
})
it('persists separate checkpoint diffs for completed and failed turns', async () => {
  const s = await setup()
  const { writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  let attempt = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(s.store.task(s.store.get().tasks[0].id).turns?.at(-1)?.checkpoint?.before).toBeTruthy()
      await writeFile(
        join(run.cwd, 'hello.txt'),
        ++attempt === 1 ? 'first turn\n' : 'partial failure\n',
      )
      if (attempt === 2) throw new Error('Provider failed')
    },
  })
  const task = s.tasks.create({
    title: 'Checkpoints',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Edit',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const first = s.store.task(task.id).turns?.[0]?.checkpoint
  expect(first?.files[0]).toMatchObject({
    before: 'original\n',
    after: 'first turn\n',
  })
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Provider failed')
  const turns = s.store.task(task.id).turns
  expect(turns?.[0]?.checkpoint).toEqual(first)
  expect(turns?.[1]).toMatchObject({
    status: 'failed',
    checkpoint: {
      files: [
        {
          path: 'hello.txt',
          before: 'first turn\n',
          after: 'partial failure\n',
          viewed: false,
        },
      ],
    },
  })
})
it('does not start provider work without a baseline and reports after-snapshot failures separately', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>().mockResolvedValue(undefined)
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
  const task = s.tasks.create({
    title: 'Capture failure',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Edit',
  })
  const capture = vi
    .spyOn(s.git, 'snapshot')
    .mockRejectedValueOnce(new Error('Baseline unavailable'))
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Baseline unavailable')
  expect(run).not.toHaveBeenCalled()
  expect(s.store.task(task.id).turns).toBeUndefined()
  capture.mockRestore()
  const snapshot = s.git.snapshot.bind(s.git)
  vi.spyOn(s.git, 'snapshot')
    .mockImplementationOnce(snapshot)
    .mockRejectedValueOnce(new Error('After snapshot unavailable'))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(run).toHaveBeenCalledOnce()
  expect(s.store.task(task.id)).toMatchObject({
    status: 'review',
    turns: [
      {
        status: 'completed',
        checkpoint: {
          error: 'Could not capture turn changes: After snapshot unavailable',
        },
      },
    ],
  })
})
it('retries failed-turn capture without sending another provider prompt', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async () => {
    throw new Error('Provider failed')
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const task = s.tasks.create({
    title: 'Failed capture',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const snapshot = s.git.snapshot.bind(s.git)
  const capture = vi
    .spyOn(s.git, 'snapshot')
    .mockImplementationOnce(snapshot)
    .mockRejectedValueOnce(new Error('Capture unavailable'))
    .mockImplementation(snapshot)
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Provider failed')
  expect(s.store.task(task.id)).toMatchObject({
    status: 'failed',
    runPhase: 'finalizing',
    restartRecovery: { automatic: false },
  })
  await (
    await s.tasks.start(task.id, true)
  ).done
  expect(run).toHaveBeenCalledOnce()
  expect(s.store.task(task.id)).toMatchObject({ status: 'failed', runPhase: undefined })
  expect(s.store.task(task.id).turns?.at(-1)?.checkpoint?.error).toBeUndefined()
  capture.mockRestore()
})
it('applies task permission overrides and starts a fresh provider session', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('permissions-session')
    },
  })
  const task = s.tasks.create({
    title: 'Permissions',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Review',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTask(task.id, (task) => ({
    ...task,
    agentOverrides: {
      permission: 'read-only',
    },
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1].agent.permission).toBe('read-only')
  expect(runs[1].sessionId).toBeUndefined()
  expect(s.store.get().agents[0].permission).toBe('ask')
})
it.each([
  { paused: false, fromQueue: false },
  { paused: true, fromQueue: false },
  { paused: false, fromQueue: true },
  { paused: true, fromQueue: true },
])(
  'steers ahead of queued input and preserves its identity and pause state: %j',
  async ({ paused, fromQueue }) => {
    const { runClientEffect } = await import('@dovo/client-runtime')
    const s = await setup()
    const runs: AgentRun[] = []
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        runs.push(run)
        run.onSession('steering-session')
        if (runs.length === 1) await run.approve('Wait', 'Steering fixture')
        run.signal.throwIfAborted()
        run.onText('Done')
      },
    })
    const task = s.tasks.create({
      title: 'Steer',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original',
    })
    const first = await s.tasks.start(task.id)
    await waitForTask(() => expect(s.approvals.list()).toHaveLength(1))
    if (fromQueue) s.tasks.queue.add(task.id, 'steering', 'Change direction now')
    s.store.updateTask(task.id, (current) => ({ ...current, snoozedUntil: '2099-01-01T00:00:00Z' }))
    await s.tasks.send(task.id, 'later', 'Do this later')
    expect(s.store.task(task.id).snoozedUntil).toBeNull()
    s.store.updateTask(task.id, (current) => ({ ...current, snoozedUntil: '2099-01-01T00:00:00Z' }))
    if (paused) s.tasks.queue.change(task.id, 'pause')
    const runId = s.store.task(task.id).activeRunId
    if (!runId) throw new Error('Expected an active run')
    if (fromQueue) await runClientEffect(s.tasks.steerQueuedEffect(task.id, 'steering', runId))
    else await s.tasks.steer(task.id, 'steering', 'Change direction now')
    expect(s.store.task(task.id).snoozedUntil).toBeNull()
    await expect(first.done).rejects.toThrow('Interrupted to apply steering')
    await waitForTask(() => expect(s.store.task(task.id).status).toBe('review'))
    expect(runs[1].sessionId).toBe('steering-session')
    expect(runs[1].prompt).toContain('Change direction now')
    expect(runs[1].prompt).not.toContain('Do this later')
    expect(s.store.task(task.id).turns?.[0].checkpoint?.after).toBeTruthy()
    await waitForTask(() => expect(runs).toHaveLength(paused ? 2 : 3))
    expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(paused ? ['later'] : [])
    expect(runs.at(-1)?.prompt).toContain(paused ? 'Change direction now' : 'Do this later')
    await s.tasks.steer(task.id, 'steering', 'Change direction now')
    expect(s.store.task(task.id).messages.filter((m) => m.id === 'steering')).toHaveLength(1)
  },
)
it('rejects steering after the active turn has finished without queuing input', async () => {
  const s = await setup()
  const task = s.tasks.create({
    title: 'Idle',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  await expect(s.tasks.steer(task.id, 'steer', 'New direction')).rejects.toThrow('turn finished')
  expect(s.store.task(task.id).queue ?? []).toEqual([])
})
it('Stop during steering leaves the instruction queued without restarting', async () => {
  const s = await setup()
  let release = () => {}
  const finishing = new Promise<void>((resolve) => {
    release = resolve
  })
  const adapter: AgentAdapter = {
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      try {
        await run.approve('Wait', 'Stop steering fixture')
      } finally {
        await finishing
      }
      run.signal.throwIfAborted()
    },
  }
  const runSpy = vi.spyOn(adapter, 'run')
  vi.spyOn(s.agents, 'get').mockResolvedValue(adapter)
  const task = s.tasks.create({
    title: 'Stop steering',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  await s.tasks.start(task.id)
  await waitForTask(() => expect(s.approvals.list()).toHaveLength(1))
  const steering = s.tasks.steer(task.id, 'steering', 'New direction')
  s.tasks.cancel(task.id)
  release()
  await steering
  expect(runSpy).toHaveBeenCalledTimes(1)
  expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(['steering'])
  expect(s.store.task(task.id).queuePaused).toBe(true)
})
it('runs a task-specific harness without a saved agent and resets sessions after harness changes', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('inline-session')
      run.onText('Done')
    },
  })
  s.store.update((w) => ({
    ...w,
    agents: [],
  }))
  const task = s.tasks.create({
    title: 'Inline',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Work',
  })
  const harness = {
    provider: 'codex' as const,
    model: 'inline-model',
    reasoning: 'high',
    permission: 'read-only' as const,
    instructions: 'Task-specific instructions',
    endpoint: 'custom-codex',
  }
  s.store.patch({
    collection: 'tasks',
    id: task.id,
    changes: {
      harness: {
        before: task.harness,
        after: harness,
      },
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[0].agent).toMatchObject({
    ...harness,
    instructions: expect.stringContaining(harness.instructions),
  })
  expect(s.store.get().agents).toEqual([])
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1].sessionId).toBe('inline-session')
  s.store.patch({
    collection: 'tasks',
    id: task.id,
    changes: {
      harness: {
        before: harness,
        after: {
          ...harness,
          model: 'another-model',
        },
      },
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[2].sessionId).toBeUndefined()
  expect(runs[2].agent.model).toBe('another-model')
})
it('applies project resources with custom-agent overrides and resets changed sessions', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  const skill = {
    name: 'review',
    description: 'Review',
    content: 'Project rules',
    enabled: true,
  }
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({
      ...repo,
      resources: {
        mcpServers: [],
        skills: [skill],
      },
    })),
  }))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('resources-session')
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Resources',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Review',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[0].agent.instructions).toContain('Project rules')
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      resources: {
        mcpServers: [],
        skills: [
          {
            ...skill,
            enabled: false,
          },
        ],
      },
    })),
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1].agent.instructions).not.toContain('Project rules')
  expect(runs[1].sessionId).toBeUndefined()
})
it.each([false, true])(
  'steers natively without restarting or replaying accepted input (paused=%s)',
  async (paused) => {
    const s = await setup()
    const runs: AgentRun[] = []
    let release = () => {}
    const completed = new Promise<void>((resolve) => {
      release = resolve
    })
    const steer = vi.fn<AgentSteer>(async () => {})
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        runs.push(run)
        run.onSession('native-session')
        if (runs.length === 1) {
          run.onText('Before steering')
          run.onTextBoundary?.()
          run.onEvent?.('item/started', {
            item: {
              type: 'commandExecution',
              id: 'ownership-command',
              command: 'echo before',
              status: 'inProgress',
            },
          })
          run.onSteer?.(steer)
          await completed
          run.onSteer?.(undefined)
        }
        run.onText('After steering')
        run.onEvent?.('item/completed', {
          item: {
            type: 'commandExecution',
            id: 'ownership-command',
            command: 'echo before',
            status: 'completed',
            aggregatedOutput: 'before',
          },
        })
      },
    })
    const task = s.tasks.create({
      title: 'Native',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original',
    })
    const execution = await s.tasks.start(task.id)
    await waitForTask(() => expect(runs).toHaveLength(1))
    await s.tasks.send(task.id, 'later', 'Do this later')
    if (paused) s.tasks.queue.change(task.id, 'pause')
    const todos: Task['nativeTodos'] = [{ text: 'Previous work', status: 'completed' }]
    s.store.updateTask(task.id, (task) => ({ ...task, nativeTodos: todos }))
    await s.tasks.steer(task.id, 'live', 'New direction')
    expect(s.store.task(task.id).nativeTodos).toBeUndefined()
    s.store.updateTask(task.id, (task) => ({ ...task, nativeTodos: todos }))
    await s.tasks.steer(task.id, 'live', 'New direction')
    expect(s.store.task(task.id).nativeTodos).toEqual(todos)
    expect(steer).toHaveBeenCalledTimes(1)
    expect(steer).toHaveBeenCalledWith({
      id: 'live',
      prompt: 'New direction',
      attachments: [],
    })
    expect(runs[0].signal.aborted).toBe(false)
    expect(
      s.store
        .task(task.id)
        .messages.slice(-3)
        .map((m) => m.text),
    ).toEqual(['Before steering', 'New direction', ''])
    const live = s.store.task(task.id)
    expect(conversationTurns(live)).toHaveLength(1)
    expect(live.messages.every((message) => message.turnId === live.turns?.[0]?.id)).toBe(true)
    expect(live.messages[1]?.textBreaks).toEqual([15])
    release()
    await execution.done
    expect(runs).toHaveLength(paused ? 1 : 2)
    expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(paused ? ['later'] : [])
    expect(s.store.task(task.id).turns?.every((turn) => turn.status === 'completed')).toBe(true)
    expect(s.store.task(task.id).consumedMessageIds).toContain('live')
    expect(runs[1]?.prompt).toBe(paused ? undefined : 'user: Do this later')
    expect(runs[1]?.sessionId).toBe(paused ? undefined : 'native-session')
    {
      const finished = s.store.task(task.id)
      const tools = recentTools(s.activity.list('', 'tool', 0, task.id).events)
      expect(
        conversationToolsByMessage(finished, tools).get(finished.messages[1]!.id),
      ).toHaveLength(1)
      expect(conversationToolsByMessage(finished, tools).has(finished.messages[3]!.id)).toBe(false)
    }
  },
)
it('retains unconfirmed native steering in a paused queue and does not automatically replay it', async () => {
  const s = await setup()
  let release = () => {}
  const completed = new Promise<void>((resolve) => {
    release = resolve
  })
  const steer = vi.fn<AgentSteer>(async () => {
    throw new Error('Connection closed before acknowledgement')
  })
  let ready = false
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onSteer?.(steer)
      ready = true
      await completed
    },
  })
  const task = s.tasks.create({
    title: 'Native',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(ready).toBe(true))
  await s.tasks.steer(task.id, 'live', 'New direction')
  expect(s.store.task(task.id).error).toContain('not confirmed')
  expect(
    s.store.task(task.id).queue?.find((message) => message.id === 'live')?.steering,
  ).toBeUndefined()
  await s.tasks.steer(task.id, 'live', 'New direction')
  release()
  await execution.done
  expect(steer).toHaveBeenCalledTimes(1)
  expect(s.store.task(task.id).queuePaused).toBe(true)
  expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(['live'])
})
it('does not strand input received between the final queue check and run cleanup', async () => {
  const s = await setup()
  const prompts: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onSession('handoff')
      prompts.push(run.prompt)
    },
  })
  const task = s.tasks.create({
    title: 'Handoff',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  const originalTask = s.store.taskSummary.bind(s.store)
  let injected = false
  vi.spyOn(s.store, 'taskSummary').mockImplementation((id) => {
    const value = originalTask(id)
    if (id === task.id && value.status === 'review' && !injected) {
      injected = true
      queueMicrotask(() => {
        void s.tasks.send(id, 'late', 'Arrived at handoff')
      })
    }
    return value
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(injected).toBe(true)
  expect(prompts).toEqual(['user: Original', 'user: Arrived at handoff'])
  expect(s.store.task(task.id).queue).toEqual([])
})
it.each(['pause', 'stop'] as const)(
  'preserves %s requested while native steering is awaiting acknowledgement',
  async (action) => {
    const s = await setup()
    let accept = () => {},
      finish = () => {}
    const acknowledged = new Promise<void>((resolve) => {
      accept = resolve
    })
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    let ready = false
    const steer = vi.fn<AgentSteer>(async () => acknowledged)
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        run.onSteer?.(steer)
        ready = true
        await completed
        run.signal.throwIfAborted()
      },
    })
    const task = s.tasks.create({
      title: 'Native pause',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original',
    })
    const execution = await s.tasks.start(task.id)
    const done = execution.done.catch(() => {})
    await waitForTask(() => expect(ready).toBe(true))
    await s.tasks.send(task.id, 'later', 'Do this later')
    const steering = s.tasks.steer(task.id, 'live', 'New direction')
    await waitForTask(() => expect(steer).toHaveBeenCalledTimes(1))
    expect(s.store.task(task.id).queue?.find((message) => message.id === 'live')?.steering).toBe(
      true,
    )
    if (action === 'stop') s.tasks.cancel(task.id)
    else s.tasks.queue.change(task.id, 'pause')
    accept()
    await steering
    finish()
    await done
    expect(s.store.task(task.id).queuePaused).toBe(true)
    expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(['later'])
    expect(s.store.task(task.id).consumedMessageIds).toContain('live')
  },
)
it.each(['live', 'finished', 'declined'] as const)(
  'delivers Astra message-form answers when %s',
  async (timing) => {
    const s = await setup()
    const { questionPromptSchema } = await import('@dovo/protocol')
    const prompt = decode(questionPromptSchema, {
      title: 'Choose output',
      blocking: false,
      questions: [
        {
          id: 'style',
          header: 'Style',
          question: 'Which output style?',
          options: [
            {
              value: 'Compact',
              label: 'Compact',
            },
          ],
        },
      ],
    })
    const runs: AgentRun[] = []
    let finish = () => {}
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    const steer = vi.fn<AgentSteer>(async () => {})
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        runs.push(run)
        run.onSession('astra-form-session')
        if (runs.length === 1) {
          run.onSteer?.(steer)
          run.onQuestions?.(prompt)
          if (timing === 'live') await completed
        }
        run.onText('Done')
      },
    })
    const task = s.tasks.create({
      title: 'Astra forms',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original',
    })
    const execution = await s.tasks.start(task.id)
    await waitForTask(() => expect(s.questions.list()).toHaveLength(1))
    if (timing !== 'live') await execution.done
    const id = s.questions.list()[0].id
    s.questions.respond(
      id,
      timing === 'declined'
        ? null
        : {
            style: ['Compact'],
          },
    )
    s.questions.respond(
      id,
      timing === 'declined'
        ? null
        : {
            style: ['Compact'],
          },
    )
    await waitForTask(() =>
      expect(timing === 'live' ? steer.mock.calls.length : runs.length).toBe(
        timing === 'live' ? 1 : 2,
      ),
    )
    finish()
    await execution.done
    expect(s.questions.list()).toHaveLength(0)
    expect(s.store.task(task.id).messages.filter((m) => m.role === 'user')).toHaveLength(2)
    expect(
      s.store.task(task.id).messages.find((m) => m.role === 'user' && m.text !== 'Original')?.text,
    ).toBe(
      timing === 'declined'
        ? 'The user declined to answer:\nWhich output style?'
        : 'Which output style?\nCompact',
    )
    expect(steer).toHaveBeenCalledTimes(timing === 'live' ? 1 : 0)
  },
)
it('Stop dismisses Astra message forms without sending an answer or starting another turn', async () => {
  const s = await setup()
  const { questionPromptSchema } = await import('@dovo/protocol')
  const adapter: AgentAdapter = {
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onQuestions?.(
        decode(questionPromptSchema, {
          title: 'Optional',
          blocking: false,
          questions: [
            {
              id: 'one',
              header: '',
              question: 'Any context?',
            },
          ],
        }),
      )
      await run.approve('Wait', 'Fixture')
      run.signal.throwIfAborted()
    },
  }
  const runSpy = vi.spyOn(adapter, 'run')
  vi.spyOn(s.agents, 'get').mockResolvedValue(adapter)
  const task = s.tasks.create({
    title: 'Stop form',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(s.questions.list()).toHaveLength(1))
  s.tasks.cancel(task.id)
  await expect(execution.done).rejects.toThrow('Cancelled')
  expect(s.questions.list()).toHaveLength(0)
  expect(runSpy).toHaveBeenCalledTimes(1)
  expect(s.store.task(task.id).messages.filter((m) => m.role === 'user')).toHaveLength(1)
})
it('queues a second form answer while the first native steering acknowledgement is pending', async () => {
  const s = await setup()
  const { questionPromptSchema } = await import('@dovo/protocol')
  let accept = () => {},
    finish = () => {}
  const acknowledged = new Promise<void>((resolve) => {
    accept = resolve
  })
  const completed = new Promise<void>((resolve) => {
    finish = resolve
  })
  const steer = vi.fn<AgentSteer>(async () => acknowledged)
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (runs.length === 1) {
        run.onSteer?.(steer)
        for (const question of ['First question?', 'Second question?'])
          run.onQuestions?.(
            decode(questionPromptSchema, {
              title: 'Question',
              blocking: false,
              questions: [
                {
                  id: 'answer',
                  header: '',
                  question,
                },
              ],
            }),
          )
        await completed
      }
    },
  })
  const task = s.tasks.create({
    title: 'Concurrent forms',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(s.questions.list()).toHaveLength(2))
  const [first, second] = s.questions.list()
  s.questions.respond(first.id, {
    answer: ['One'],
  })
  await waitForTask(() => expect(steer).toHaveBeenCalledTimes(1))
  s.questions.respond(second.id, {
    answer: ['Two'],
  })
  expect(s.store.task(task.id).queue?.map((m) => m.text)).toContain('Second question?\nTwo')
  accept()
  finish()
  await execution.done
  expect(
    s.store
      .task(task.id)
      .messages.filter((m) => m.role === 'user')
      .map((m) => m.text),
  ).toEqual(['Original', 'First question?\nOne', 'Second question?\nTwo'])
  expect(s.store.task(task.id).queue).toEqual([])
})
it('persists exposed reasoning once per turn item alongside tools and flushes at completion', async () => {
  const s = await setup()
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      provider: 'codex',
    })),
  }))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onEvent?.('item/started', {
        item: {
          id: 'reason',
          type: 'reasoning',
          summary: [],
          content: ['hidden'],
        },
      })
      run.onEvent?.('item/reasoning/summaryTextDelta', {
        itemId: 'reason',
        summaryIndex: 0,
        delta: 'Checking the files.',
      })
      run.onEvent?.('item/reasoning/textDelta', {
        itemId: 'reason',
        delta: 'hidden',
      })
      run.onEvent?.('item/completed', {
        item: {
          id: 'read',
          type: 'commandExecution',
          command: 'git status',
          status: 'completed',
          exitCode: 0,
        },
      })
      run.onText('Done.')
    },
  })
  const task = s.tasks.create({
    title: 'Reasoning',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Test activity',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const rows = s.activity.list('', 'task-activity', 0, task.id).events
  expect(rows.map((row) => row.kind).sort()).toEqual(['reasoning', 'tool'])
  const summary = rows.find((row) => row.kind === 'reasoning')!
  expect(JSON.parse(summary.payload)).toMatchObject({
    turnId: s.store.task(task.id).turns![0]!.id,
    status: 'completed',
    reasoning: {
      text: 'Checking the files.',
    },
  })
  expect(s.activity.list('hidden', '', 0, task.id).events).toEqual([])
})
it('refuses to execute legacy task configuration with a provider different from its first turn', async () => {
  const s = await setup()
  s.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'legacy-provider',
        title: 'Legacy provider mismatch',
        repositoryId: 'repo',
        agentId: 'agent',
        status: 'review',
        createdAt: '',
        messages: [
          {
            id: 'first',
            role: 'user',
            text: 'Continue',
          },
        ],
        files: [],
        draft: '',
        example: false,
        harness: {
          provider: 'claude',
          model: '',
          permission: 'ask',
          endpoint: '',
          instructions: '',
        },
        turns: [
          {
            id: 'original',
            assistantId: 'answer',
            agentId: 'agent',
            provider: 'codex',
            model: '',
            startedAt: '',
            status: 'completed',
          },
        ],
      },
    ],
  }))
  const execute = vi.fn<AgentAdapter['run']>()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: execute,
  })
  const run = await s.tasks.start('legacy-provider')
  await expect(run.done).rejects.toThrow('This task uses codex')
  expect(execute).not.toHaveBeenCalled()
})
it.each(['custom', 'built-in'] as const)(
  'uses the %s choice made in a draft for the first send, including its instructions and resources',
  async (choice) => {
    const s = await setup(),
      runs: AgentRun[] = []
    const custom: Agent = {
      ...defaultTaskHarness('claude'),
      id: 'custom',
      name: 'Project reviewer',
      instructions: 'Review using the team conventions.',
      endpoint: 'custom-claude',
      args: ['--profile', 'review'],
      resources: {
        mcpServers: [],
        skills: [
          {
            name: 'review',
            description: 'Review',
            content: 'Use the custom review skill.',
            enabled: true,
          },
        ],
      },
    }
    const builtin = defaultTaskHarness('codex')
    const task: Task = {
      id: 'new-task',
      title: 'New task',
      repositoryId: 'repo',
      agentId: choice === 'custom' ? '' : custom.id,
      harness: choice === 'custom' ? builtin : null,
      agentOverrides:
        choice === 'built-in'
          ? {
              model: 'old-override',
            }
          : undefined,
      status: 'draft',
      createdAt: '',
      messages: [],
      files: [],
      draft: 'Review the project',
      example: false,
    }
    s.store.update((workspace) => ({
      ...workspace,
      agents: [...workspace.agents, custom],
      tasks: [...workspace.tasks, task],
    }))
    s.store.patch({
      collection: 'tasks',
      id: task.id,
      changes: {
        agentId: {
          before: task.agentId,
          after: choice === 'custom' ? custom.id : '',
        },
        harness: {
          before: task.harness,
          after: choice === 'custom' ? null : builtin,
        },
        agentOverrides: {
          before: task.agentOverrides,
          after: null,
        },
      },
    })
    if (choice === 'custom')
      s.store.patch({
        collection: 'tasks',
        id: task.id,
        changes: {
          agentOverrides: {
            before: null,
            after: {
              model: 'task-model',
              reasoning: 'high',
              permission: 'workspace-write',
            },
          },
        },
      })
    expect(s.store.task(task.id).providerLock).toBeUndefined()
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        runs.push(run)
        run.onText('Reviewed')
      },
    })
    await s.tasks.send(task.id, 'first-input', 'Review the project')
    await waitForTask(() => expect(s.store.task(task.id).status).toBe('review'))
    expect(runs).toHaveLength(1)
    const configured = runs[0].agent
    const expected =
      choice === 'custom'
        ? {
            id: custom.id,
            name: custom.name,
            provider: 'claude',
            endpoint: custom.endpoint,
            args: custom.args,
            resources: custom.resources,
            model: 'task-model',
            reasoning: 'high',
            permission: 'workspace-write',
          }
        : {
            id: `task:${task.id}`,
            provider: 'codex',
            model: '',
            permission: 'full-access',
            resources: {
              mcpServers: [],
              skills: [],
            },
          }
    expect({
      ...configured,
      resources: configured.resources && {
        ...configured.resources,
        mcpServers: configured.resources.mcpServers.filter((server) => server.name !== 'dovo_task'),
      },
    }).toMatchObject(expected)
    expect(configured.args).toEqual(choice === 'custom' ? custom.args : undefined)
    expect(configured.instructions.includes(custom.instructions)).toBe(choice === 'custom')
    expect(configured.instructions.includes('Use the custom review skill.')).toBe(
      choice === 'custom',
    )
    expect(configured.endpoint === custom.endpoint).toBe(choice === 'custom')
    expect(s.store.task(task.id).agentId).toBe(choice === 'custom' ? custom.id : '')
    expect(s.store.task(task.id).agentOverrides).toEqual(
      choice === 'custom'
        ? {
            model: 'task-model',
            reasoning: 'high',
            permission: 'workspace-write',
          }
        : undefined,
    )
    expect(s.store.get().agents.find((agent) => agent.id === custom.id)).toEqual(custom)
    expect(s.store.task(task.id).providerLock).toBe(configured.provider)
    expect(s.store.task(task.id).turns?.[0]).toMatchObject({
      agentId: configured.id,
      provider: configured.provider,
      status: 'completed',
    })
  },
)

it('settles task admission racing executor shutdown without leaving a running task', async () => {
  const { Effect, Fiber, Exit } = await import('effect')
  const s = await setup()
  const task = s.tasks.create({
    title: 'Race',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Race shutdown',
  })
  const starting = Effect.runFork(s.tasks.startEffect(task.id))
  await s.tasks.dispose()
  const result = await Effect.runPromise(Fiber.await(starting).pipe(Effect.timeout('1 second')))
  expect(Exit.isFailure(result)).toBe(true)
  expect(s.store.task(task.id).status).not.toBe('running')
})

it('settles provider output before checkpointing and rejects callbacks from a retired turn', async () => {
  const s = await setup()
  let releaseCapture = () => {}
  const capture = new Promise<void>((resolve) => {
    releaseCapture = resolve
  })
  let provider: AgentRun | undefined
  const snapshot = s.git.snapshot.bind(s.git)
  vi.spyOn(s.git, 'snapshot').mockImplementation(async (cwd, ref) => {
    if (ref.endsWith('/after')) await capture
    return snapshot(cwd, ref)
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      provider = run
      run.onSession('owned-session')
      run.onText('Finished')
    },
  })
  const task = s.tasks.create({
    title: 'Finalize',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const execution = await s.tasks.start(task.id)
  try {
    await waitForTask(() => expect(s.store.task(task.id).runPhase).toBe('finalizing'))
    const turn = s.store.task(task.id).turns?.at(-1)
    expect(turn?.status).toBe('completed')
    expect(turn?.finishedAt).toBeTruthy()
    expect(s.store.task(task.id).messages.at(-1)?.text).toBe('Finished')
    expect(() => s.tasks.requireIdle(task.id)).toThrow('active turn')
    const revision = s.store.version()
    provider?.onText('late output')
    provider?.onSession('stale-session')
    provider?.onActivity('Still working')
    provider?.onEvent?.('item/started', {
      item: { type: 'subAgentActivity', agentThreadId: 'stale', kind: 'started' },
    })
    expect(await provider?.approve('Too late', 'Must not appear')).toBe('deny')
    expect(
      await provider?.ask(
        decode(questionPromptSchema, {
          title: 'Retired provider',
          questions: [{ id: 'late', header: 'Late', question: 'Too late?', options: [] }],
        }),
      ),
    ).toBeNull()
    expect(s.store.version()).toBe(revision)
    expect(s.approvals.list()).toHaveLength(0)
    s.tasks.queue.change(task.id, 'pause')
    const steering = s.tasks.steer(task.id, 'during-finalize', 'Next request')
    await waitForTask(() => expect(s.store.task(task.id).queue?.[0]?.id).toBe('during-finalize'))
    expect(provider?.signal.aborted).toBe(false)
    expect(s.store.task(task.id).queue?.[0]?.id).toBe('during-finalize')
    releaseCapture()
    await steering
    await execution.done
    await waitForTask(() => expect(s.store.task(task.id).runPhase).toBeUndefined())
    expect(s.store.task(task.id).turns?.[0]?.finishedAt).toBe(turn?.finishedAt)
    expect(s.store.task(task.id).sessionId).toBe('owned-session')
  } finally {
    releaseCapture()
    await execution.done
  }
})

it('acknowledges retried removed submissions without resurrecting them or starting a provider', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>()
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const task = s.tasks.create({
    title: 'Retry',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  s.tasks.queue.change(task.id, 'pause')
  await s.tasks.send(task.id, 'request', 'Follow-up')
  s.tasks.queue.change(task.id, 'remove', 'request')
  expect(await s.tasks.send(task.id, 'request', 'Follow-up')).toEqual({ ok: true })
  expect(await s.tasks.steer(task.id, 'request', 'Follow-up')).toEqual({ ok: true })
  expect(s.store.task(task.id).queue).toEqual([])
  expect(run).not.toHaveBeenCalled()
})

it('keeps provider success when finalization storage fails and retries capture without another prompt', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Done'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const task = s.tasks.create({
    title: 'Capture failure',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Do work',
  })
  const update = s.store.updateTaskHistory.bind(s.store)
  let fail = true
  vi.spyOn(s.store, 'updateTaskHistory').mockImplementation((id, fn, receipt, action) => {
    const next = fn(s.store.task(id))
    if (fail && next.status === 'review') {
      fail = false
      throw new Error('SQLite finalization failure')
    }
    return update(id, fn, receipt, action)
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const completed = s.store.task(task.id).turns?.at(-1)
  expect(completed?.status).toBe('completed')
  expect(s.store.task(task.id)).toMatchObject({
    status: 'review',
    runPhase: 'finalizing',
    queuePaused: true,
  })
  expect(s.store.task(task.id).error).toContain('SQLite finalization failure')
  await (
    await s.tasks.start(task.id)
  ).done
  expect(run).toHaveBeenCalledTimes(1)
  expect(s.store.task(task.id).turns?.at(-1)?.finishedAt).toBe(completed?.finishedAt)
  expect(s.store.task(task.id).turns?.at(-1)?.checkpoint?.after).toBeTruthy()
  expect(s.store.task(task.id).runPhase).toBeUndefined()
  expect(s.store.task(task.id).error).toBeUndefined()
})

it('durably admits each queued turn before inspecting its checkout', async () => {
  const s = await setup()
  const { WorkspaceStore } = await import('../../storage/workspace')
  const task = s.tasks.create({
    title: 'Queue crash',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First request',
  })
  s.tasks.queue.add(task.id, 'second-input', 'Second request')
  // First request is already in the transcript; hold the follow-up until its own turn.
  s.store.updateTask(task.id, (t) => ({
    ...t,
    restartRecovery: { kind: 'turn', automatic: false },
  }))
  const inspect = s.git.inspect.bind(s.git)
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let recovered: Task | undefined
  vi.spyOn(s.git, 'inspect').mockImplementation(async (cwd) => {
    if (s.store.task(task.id).runAttempt?.inputMessageIds.includes('second-input')) {
      recovered = new WorkspaceStore(s.db).task(task.id)
      await gate
    }
    return inspect(cwd)
  })
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Done'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const execution = await s.tasks.start(task.id)
  try {
    await waitForTask(() => expect(recovered).toBeDefined())
    expect(recovered).toMatchObject({
      status: 'failed',
      restartRecovery: { kind: 'turn', automatic: true },
      runAttempt: { inputMessageIds: ['second-input'], promptAccepted: false },
      queue: [],
    })
    expect(recovered?.messages.some((m) => m.id === 'second-input')).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  } finally {
    release()
    await execution.done
  }
})

it('retains legacy session consumption when admitting a new queued request', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (context) => {
    context.onSession('legacy-session')
    context.onText('Done')
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const task = s.tasks.create({
    title: 'Legacy',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Already completed original',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTask(task.id, (current) => ({ ...current, consumedMessageIds: undefined }))
  s.tasks.queue.add(task.id, 'follow-up', 'New queued request')
  await (
    await s.tasks.start(task.id)
  ).done
  expect(run.mock.calls[1][0].prompt).toContain('New queued request')
  expect(run.mock.calls[1][0].prompt).not.toContain('Already completed original')
})

it('flushes streamed text at provider boundaries and retains them on the assistant message', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onText('Progress.')
      run.onTextBoundary?.()
      run.onTextBoundary?.()
      run.onText('Final answer.')
      run.onTextBoundary?.()
    },
  })
  const task = s.tasks.create({
    title: 'Boundaries',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Test boundaries',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const reply = s.store.task(task.id).messages.find((message) => message.role === 'assistant')
  expect(reply).toMatchObject({ text: 'Progress.Final answer.', textBreaks: [9, 22] })
})

it.each([false, true])(
  'replaces only the current provider text and preserves sealed progress and tools (flushed=%s)',
  async (flushed) => {
    const s = await setup()
    const draft = ' \nDraft ❤️. \n'
    let taskId = ''
    const waitForFlushedText = () =>
      waitForTask(() =>
        expect(s.store.task(taskId).messages.at(-1)?.text).toBe('Progress.' + draft),
      )
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        run.onText('Progress.')
        run.onTextBoundary?.()
        run.onEvent?.('item/started', {
          item: { type: 'commandExecution', id: 'tool', command: 'pwd', status: 'inProgress' },
        })
        run.onText(draft)
        if (flushed) await waitForFlushedText()
        run.onTextReplace?.('Final ❤️.', draft.length)
        run.onText(' Draft suffix.')
        run.onTextReplace?.('Final ❤️. Confirmed.', 'Final ❤️. Draft suffix.'.length)
        run.onEvent?.('item/completed', {
          item: { type: 'commandExecution', id: 'tool', command: 'pwd', status: 'completed' },
        })
      },
    })
    const task = s.tasks.create({
      title: 'Canonical response',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Finalize text',
    })
    taskId = task.id
    await (
      await s.tasks.start(task.id)
    ).done
    const finished = s.store.task(task.id)
    const reply = finished.messages.find((message) => message.role === 'assistant')
    expect(finished.status).toBe('review')
    expect(finished.error).toBeUndefined()
    expect(finished.turns?.at(-1)?.status).toBe('completed')
    expect(reply).toMatchObject({ text: 'Progress.Final ❤️. Confirmed.', textBreaks: [9] })
    const tools = recentTools(s.activity.list('', 'tool', 0, task.id).events)
    expect(tools).toMatchObject([{ status: 'completed' }])
    expect(JSON.parse(tools[0]!.payload)).toMatchObject({ toolId: 'tool' })
    expect(conversationToolsByMessage(finished, tools).get(reply!.id)).toHaveLength(1)
  },
)

it('keeps steering input and tool ownership when canonical text replaces a segment across messages', async () => {
  const s = await setup()
  let current: AgentRun | undefined
  let release = () => {}
  const completed = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      current = run
      run.onText('Earlier progress.')
      run.onTextBoundary?.()
      run.onText('Old draft.')
      run.onEvent?.('item/started', {
        item: {
          type: 'commandExecution',
          id: 'original-tool',
          command: 'pwd',
          status: 'inProgress',
        },
      })
      run.onSteer?.(async () => {})
      await completed
      run.onText('New draft.')
      run.onTextReplace?.('Canonical answer.', 'Old draft.New draft.'.length)
      run.onEvent?.('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'original-tool',
          command: 'pwd',
          status: 'completed',
        },
      })
    },
  })
  const task = s.tasks.create({
    title: 'Steered response',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original request',
  })
  const execution = await s.tasks.start(task.id)
  try {
    await waitForTask(() => expect(current).toBeDefined())
    await s.tasks.steer(task.id, 'steering-input', 'A clarification')
  } finally {
    release()
    await execution.done
  }
  const finished = s.store.task(task.id)
  expect(finished.status).toBe('review')
  expect(finished.messages.map((message) => message.text)).toEqual([
    'Original request',
    'Earlier progress.',
    'A clarification',
    'Canonical answer.',
  ])
  expect(finished.messages[1]?.textBreaks).toEqual([17])
  expect(conversationTurns(finished)).toHaveLength(1)
  const tools = recentTools(s.activity.list('', 'tool', 0, task.id).events)
  expect(tools).toMatchObject([{ status: 'completed' }])
  expect(JSON.parse(tools[0]!.payload)).toMatchObject({ toolId: 'original-tool' })
  expect(conversationToolsByMessage(finished, tools).get(finished.messages[1]!.id)).toHaveLength(1)
  expect(conversationToolsByMessage(finished, tools).has(finished.messages[3]!.id)).toBe(false)
})

it('rejects replacements that would erase text outside the provider execution', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onText('Keep this.')
      run.onTextReplace?.('Invalid replacement.', 1000)
    },
  })
  const task = s.tasks.create({
    title: 'Invalid replacement',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Keep user input',
  })
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow(
    'Provider text replacement exceeds its streamed output',
  )
  const finished = s.store.task(task.id)
  expect(finished).toMatchObject({
    status: 'failed',
    error: 'Provider text replacement exceeds its streamed output',
  })
  expect(finished.messages.map((message) => message.text)).toEqual([
    'Keep user input',
    'Keep this.',
  ])
})

it('retains separate subscription quotas and identifies a reading that arrives before account metadata', async () => {
  const s = await setup()
  let number = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      number++
      run.onEvent?.('account/rateLimits/read', {
        rateLimits: { primary: { usedPercent: number * 10, windowDurationMins: 300 } },
      })
      run.onEvent?.('account/read', {
        account: { type: 'chatgpt', email: `account${number}@example.com`, planType: 'pro' },
      })
      run.onText('Done')
    },
  })
  for (let index = 0; index < 2; index++) {
    const task = s.tasks.create({
      title: 'Usage',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Check',
    })
    await (
      await s.tasks.start(task.id)
    ).done
    expect(s.store.task(task.id).turns?.at(-1)?.usageAccount?.label).toBe(
      `account${index + 1}@example.com`,
    )
  }
  expect(s.store.get().planLimits).toMatchObject([
    { account: { label: 'account1@example.com' }, usedPercent: 10 },
    { account: { label: 'account2@example.com' }, usedPercent: 20 },
  ])
})

it('persists session-owned native agents after a reply while keeping late output and replaced sessions fenced', async () => {
  const s = await setup()
  let provider: AgentRun | undefined
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      provider = run
      run.onSession('native-session')
      run.onText('Parent reply')
      run.onSubagentEvent?.(
        'item/started',
        { threadId: 'native-child', item: { type: 'commandExecution' } },
        'native-session',
      )
    },
  })
  const task = s.tasks.create({
    title: 'Native lifecycle',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Inspect',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(s.store.task(task.id).subagents?.[0]).toMatchObject({
    id: 'native-child',
    status: 'working',
    sessionLive: true,
  })
  provider?.onSubagentEvent?.(
    'turn/completed',
    { threadId: 'native-child', turn: { status: 'completed' } },
    'native-session',
  )
  expect(s.store.task(task.id).subagents?.[0]?.status).toBe('completed')
  provider?.onText('Late parent output')
  expect(s.store.task(task.id).messages.at(-1)?.text).toBe('Parent reply')
  s.store.updateTask(task.id, (task) => ({ ...task, sessionId: 'replacement-session' }))
  const revision = s.store.version()
  provider?.onSubagentEvent?.(
    'item/started',
    { threadId: 'stale-child', item: { type: 'commandExecution' } },
    'native-session',
  )
  expect(s.store.version()).toBe(revision)
})

it.each(['accept', 'reject'] as const)(
  'steers the original queued message once without a temporary duplicate: %s',
  async (outcome) => {
    const s = await setup()
    const { runClientEffect } = await import('@dovo/client-runtime')
    let acknowledge = () => {},
      finish = () => {},
      ready = false
    const ack = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    const steer = vi.fn<AgentSteer>(async () => {
      await ack
      if (outcome === 'reject') throw new Error('not accepted')
    })
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        run.onSteer?.(steer)
        ready = true
        await completed
      },
    })
    const task = s.tasks.create({
      title: 'Queued steering',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original',
    })
    const execution = await s.tasks.start(task.id)
    await waitForTask(() => expect(ready).toBe(true))
    s.tasks.queue.add(task.id, 'queued-input', 'New direction')
    s.tasks.queue.add(task.id, 'later-input', 'Later')
    const runId = s.store.task(task.id).activeRunId!
    const handoff = runClientEffect(s.tasks.steerQueuedEffect(task.id, 'queued-input', runId))
    await waitForTask(() => expect(steer).toHaveBeenCalledTimes(1))
    expect(steer.mock.calls[0]?.[0].id).toBe('queued-input')
    expect(s.store.task(task.id).queue?.map((message) => message.id)).toEqual([
      'queued-input',
      'later-input',
    ])
    expect(
      s.store.task(task.id).messages.filter((message) => message.text === 'New direction'),
    ).toHaveLength(0)
    const before = s.store.task(task.id)
    const blocked = [
      () => s.tasks.queue.edit(task.id, 'queued-input', 'Edited direction', 'New direction'),
      () => s.tasks.queue.change(task.id, 'remove', 'queued-input'),
      () => s.tasks.queue.change(task.id, 'restore', 'queued-input'),
      () =>
        s.tasks.queue.restore(task.id, {
          requestId: 'restore-during-steering',
          messageId: 'queued-input',
          expectedText: 'New direction',
          expectedTurnSettings: null,
          expectedDraftTurnSettings: null,
          expectedAttachmentIds: [],
        }),
    ]
    for (const action of blocked) expect(action).toThrow('being delivered')
    expect(s.store.task(task.id)).toEqual(before)
    // A lost HTTP response retried during acknowledgement must not reinject the message.
    await runClientEffect(s.tasks.steerQueuedEffect(task.id, 'queued-input', runId))
    acknowledge()
    await handoff
    expect(s.store.task(task.id).queue?.map((message) => message.id)).toEqual(
      outcome === 'accept' ? ['later-input'] : ['queued-input', 'later-input'],
    )
    expect(
      s.store
        .task(task.id)
        .messages.filter((message) => message.text === 'New direction')
        .map((message) => message.id),
    ).toEqual(outcome === 'accept' ? ['queued-input'] : [])
    expect(s.store.task(task.id).queuePaused).toBe(outcome === 'reject')
    await runClientEffect(s.tasks.steerQueuedEffect(task.id, 'queued-input', runId))
    expect(steer).toHaveBeenCalledTimes(1)
    s.tasks.queue.change(task.id, 'pause')
    finish()
    await execution.done
  },
)

it('applies Claude steering received during finalization even when the remaining queue is paused', async () => {
  const s = await setup()
  let releaseCapture = () => {}
  const capture = new Promise<void>((resolve) => {
    releaseCapture = resolve
  })
  const snapshot = s.git.snapshot.bind(s.git)
  let captured = false
  vi.spyOn(s.git, 'snapshot').mockImplementation(async (cwd, ref) => {
    if (ref.endsWith('/after') && !captured) {
      captured = true
      await capture
    }
    return snapshot(cwd, ref)
  })
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('claude-session')
      run.onText('Done')
    },
  })
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, provider: 'claude' })),
  }))
  const task = s.tasks.create({
    title: 'Claude steering',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  const initial = await s.tasks.start(task.id)
  try {
    await waitForTask(() => expect(s.store.task(task.id).runPhase).toBe('finalizing'))
    s.tasks.queue.add(task.id, 'later', 'Later request')
    s.tasks.queue.change(task.id, 'pause')
    const steering = s.tasks.steer(task.id, 'steer-finalizing', 'Change direction')
    await waitForTask(() =>
      expect(
        s.store.task(task.id).queue?.some((message) => message.id === 'steer-finalizing'),
      ).toBe(true),
    )
    releaseCapture()
    await steering
    await initial.done
    await waitForTask(() => expect(runs).toHaveLength(2))
    expect(runs[0].signal.aborted).toBe(false)
    expect(runs[1].sessionId).toBe('claude-session')
    expect(runs[1].prompt).toContain('Change direction')
    expect(runs[1].prompt).not.toContain('Later request')
    expect(s.store.task(task.id).queuePaused).toBe(true)
    expect(s.store.task(task.id).queue?.map((message) => message.id)).toEqual(['later'])
  } finally {
    releaseCapture()
    await initial.done
  }
})

it('persists queued model choices without changing the active run or saved agent defaults', async () => {
  const { runClientEffect } = await import('@dovo/client-runtime')
  const s = await setup()
  const runs: AgentRun[] = []
  let releaseFirst = () => {}
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (runs.length === 1) await first
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Models per turn',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Initial',
  })
  const original = s.store.task(task.id)
  const execution = await s.tasks.start(task.id)
  try {
    await waitForTask(() => expect(runs).toHaveLength(1))
    const send = (id: string, model: string, reasoning: string) =>
      runClientEffect(
        s.tasks.sendEffect(task.id, id, id, [], false, false, {
          provider: 'codex',
          model,
          reasoning,
        }),
      )
    await send('large', 'large-model', 'high')
    await send('small', 'small-model', 'low')
    await s.tasks.send(task.id, 'defaults', 'Use thread defaults')
    expect(runs).toHaveLength(1)
    expect(runs[0].agent.model).toBe('')
    expect(s.store.task(task.id).harness).toEqual(original.harness)
    await expect(
      runClientEffect(
        s.tasks.steerQueuedEffect(task.id, 'large', s.store.task(task.id).activeRunId!),
      ),
    ).rejects.toThrow('queued turn')
  } finally {
    releaseFirst()
    await execution.done
  }
  expect(runs.map((run) => [run.agent.model, run.agent.reasoning])).toEqual([
    ['', undefined],
    ['large-model', 'high'],
    ['small-model', 'low'],
    ['small-model', 'low'],
  ])
  const finished = s.store.task(task.id)
  expect(finished.turns?.map((turn) => [turn.model, turn.reasoning])).toEqual(
    runs.map((run) => [run.agent.model, run.agent.reasoning]),
  )
  expect(finished.harness).toEqual(original.harness)
  expect(finished.agentOverrides).toEqual({
    ...original.agentOverrides,
    model: 'small-model',
    reasoning: 'low',
    serviceTier: null,
    cyberAccessProgram: null,
  })
  expect(s.store.get().agents[0].model).toBe('')
})

it('runs input before a paused message, waits there, and drains later input only after resuming', async () => {
  const s = await setup(),
    prompts: string[] = []
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      prompts.push(run.prompt)
      run.onSession('individual-pauses')
      if (prompts.length === 1) await gate
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Paused input',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(prompts).toHaveLength(1))
  await s.tasks.send(task.id, 'before', 'Run before the pause')
  await s.tasks.send(task.id, 'held', 'Hold this message')
  await s.tasks.send(task.id, 'ready', 'Run this message')
  s.tasks.queue.setPaused(task.id, 'held', true)
  release()
  await execution.done
  expect(prompts).toEqual(['user: First', 'user: Run before the pause'])
  expect(s.store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual([
    'held',
    'ready',
  ])
  expect(s.store.taskSummary(task.id).queuePaused).toBeFalsy()
  await expect(s.tasks.start(task.id)).rejects.toThrow('Resume the first queued message')
  expect(prompts).toHaveLength(2)
  s.tasks.queue.setPaused(task.id, 'held', false)
  await (
    await s.tasks.start(task.id)
  ).done
  expect(prompts).toEqual([
    'user: First',
    'user: Run before the pause',
    'user: Hold this message',
    'user: Run this message',
  ])
  expect(s.store.taskSummary(task.id).queue).toEqual([])
})

it('honors a message paused while its checkout is still being prepared', async () => {
  const s = await setup()
  const task = s.tasks.create({
    title: 'Pause during preparation',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  s.tasks.queue.add(task.id, 'held', 'Run when resumed')
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const directory = s.checkouts.directory.bind(s.checkouts)
  let preparing = false
  vi.spyOn(s.checkouts, 'directory').mockImplementation(async (...args) => {
    preparing = true
    await gate
    return directory(...args)
  })
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Done'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const starting = s.tasks.start(task.id)
  try {
    await waitForTask(() => expect(preparing).toBe(true))
    s.tasks.queue.setPaused(task.id, 'held', true)
  } finally {
    release()
  }
  await (
    await starting
  ).done
  expect(run).not.toHaveBeenCalled()
  expect(s.store.taskSummary(task.id)).toMatchObject({
    status: 'draft',
    queue: [{ id: 'held', paused: true }],
  })
  expect(s.store.taskSummary(task.id).queuePaused).toBeFalsy()
  expect(s.store.taskSummary(task.id).activeRunId).toBeUndefined()
  s.tasks.queue.setPaused(task.id, 'held', false)
  await (
    await s.tasks.start(task.id)
  ).done
  expect(run).toHaveBeenCalledTimes(1)
})

it('emits completed shell commands once with paired inputs and excludes failed or late events', async () => {
  const s = await setup()
  const completed: Array<{
    taskId: string
    turnId: string
    tool: { input?: unknown; output?: unknown }
  }> = []
  const stop = s.tasks.onCommandCompleted((event) => completed.push(event))
  let emit: AgentRun['onEvent']
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      emit = run.onEvent
      run.onSession('command-session')
      run.onEvent?.('item/started', {
        item: { id: 'create', type: 'commandExecution', command: 'git status' },
      })
      const result = {
        item: {
          id: 'create',
          type: 'commandExecution',
          exitCode: 0,
          status: 'completed',
          aggregatedOutput: 'clean',
        },
      }
      run.onEvent?.('item/completed', result)
      run.onEvent?.('item/completed', result)
      run.onEvent?.('item/completed', {
        item: {
          id: 'failed',
          type: 'commandExecution',
          command: 'git status',
          exitCode: 1,
          status: 'completed',
        },
      })
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Command events',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Check status',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(completed).toHaveLength(1)
  expect(completed[0]).toMatchObject({
    taskId: task.id,
    tool: { input: 'git status', output: 'clean' },
  })
  expect(completed[0].turnId).toBe(s.store.task(task.id).turns?.at(-1)?.id)
  emit?.('item/completed', {
    item: { id: 'late', type: 'commandExecution', command: 'git status', status: 'completed' },
  })
  expect(completed).toHaveLength(1)
  stop()
})

it('bounds a model handover without changing saved history and resumes the replacement session', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession(runs.length === 1 ? 'original-session' : 'handover-session')
      run.onText(runs.length === 1 ? 'Older output '.repeat(10000) : 'Done')
    },
  })
  const task = s.tasks.create({
    title: 'Budgeted handover',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Keep the original requirement',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const oldMessages = structuredClone(s.store.task(task.id).messages)
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    agentOverrides: { model: 'another-model' },
    messages: [
      ...task.messages,
      { id: 'followup-budget', role: 'user', text: 'Finish the latest request' },
    ],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1].sessionId).toBeUndefined()
  expect(runs[1].prompt).toContain('Keep the original requirement')
  expect(runs[1].prompt).toContain('Finish the latest request')
  expect(runs[1].prompt).toContain('Earlier conversation omitted')
  expect(Buffer.byteLength(runs[1].prompt)).toBeLessThanOrEqual(64000)
  expect(s.store.task(task.id).messages.slice(0, oldMessages.length)).toEqual(oldMessages)
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    messages: [...task.messages, { id: 'next-budget', role: 'user', text: 'Next' }],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[2].sessionId).toBe('handover-session')
  expect(runs[2].prompt).toBe('user: Next')
})

it('recovers a context-rejected resume and retains the original and failed pending input', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (runs.length === 2) throw new Error('context_length_exceeded')
      run.onSession(runs.length === 1 ? 'full-session' : 'recovered-session')
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Recover handover',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original objective',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    messages: [
      ...task.messages,
      { id: 'pending-recovery', role: 'user', text: 'Keep this pending request' },
    ],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs).toHaveLength(3)
  expect(runs[1].sessionId).toBe('full-session')
  expect(runs[2].sessionId).toBeUndefined()
  expect(runs[2].prompt).toContain('Original objective')
  expect(runs[2].prompt).toContain('Keep this pending request')
  expect(s.store.task(task.id).sessionId).toBe('recovered-session')
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    messages: [...task.messages, { id: 'next-recovery', role: 'user', text: 'Next' }],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[3].sessionId).toBe('recovered-session')
  expect(runs[3].prompt).toBe('user: Next')
})

it('replaces a provider-confirmed exhausted session before submitting pending input', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession(runs.length === 1 ? 'exhausted' : 'replacement')
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Full context',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original objective',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    contextUsage: { used: 200000, limit: 200000, updatedAt: new Date().toISOString() },
    messages: [...task.messages, { id: 'full-pending', role: 'user', text: 'Next request' }],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[1].sessionId).toBeUndefined()
  expect(runs[1].prompt).toContain('Original objective')
  expect(runs[1].prompt).toContain('Next request')
  expect(s.store.task(task.id).contextUsage).toBeUndefined()
})

it('preserves accepted but unfinished input when a later continue message needs a bounded handover', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('original')
      run.onText(runs.length === 2 ? 'Partial output '.repeat(10000) : 'Done')
      if (runs.length === 2) throw new Error('Provider disconnected after accepting input')
    },
  })
  const task = s.tasks.create({
    title: 'Failed input',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original scope',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    messages: [
      ...task.messages,
      { id: 'unfinished-request', role: 'user', text: 'Implement the API and validate its schema' },
    ],
  }))
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Provider disconnected')
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    agentOverrides: { model: 'new-model' },
    messages: [...task.messages, { id: 'continue-failed', role: 'user', text: 'Continue' }],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[2].prompt).toContain('Original scope')
  expect(runs[2].prompt).toContain('Implement the API and validate its schema')
  expect(runs[2].prompt).toContain('user: Continue')
  expect(runs[2].prompt).toContain('Earlier conversation omitted')
})

it('keeps hook-repair instructions and prior output when its resumed session rejects context', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      resources: {
        skills: [],
        mcpServers: [],
        hooks: [
          {
            name: 'check',
            enabled: true,
            event: 'after-turn',
            timeoutSeconds: 10,
            command:
              "node -e \"const fs=require('node:fs');if(!fs.existsSync('.handover-hook')){fs.writeFileSync('.handover-hook','');process.stdout.write('Expected check failure');process.exitCode=1}\"",
          },
        ],
      },
    })),
  }))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (runs.length === 2) throw new Error('context_length_exceeded')
      run.onSession(runs.length === 1 ? 'original' : 'repaired')
      run.onText(runs.length === 1 ? 'Work before hooks' : 'Repair completed')
    },
  })
  const task = s.tasks.create({
    title: 'Hook recovery',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original requirement',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs).toHaveLength(3)
  expect(runs[2].sessionId).toBeUndefined()
  expect(runs[2].prompt).toContain('Original requirement')
  expect(runs[2].prompt).toContain('Work before hooks')
  expect(runs[2].prompt).toContain('Required project/agent checks failed')
  expect(runs[2].prompt).toContain('Expected check failure')
})

it('keeps native child approvals available after blocked context recovery but fences stopped or replaced sessions', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  const stop = vi.fn<() => Promise<void>>(async () => {})
  const approval = vi.spyOn(s.approvals, 'request').mockResolvedValue('approve')
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('native-session')
      run.onNativeSession?.({ stop }, 'native-session')
      if (runs.length === 2) throw new Error('context_length_exceeded')
      run.onText('Parent reply')
      run.onSubagentEvent?.(
        'item/started',
        { threadId: 'native-child', item: { type: 'commandExecution' } },
        'native-session',
      )
    },
  })
  const task = s.tasks.create({
    title: 'Native approvals',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Inspect',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    messages: [...task.messages, { id: 'blocked-context', role: 'user', text: 'Continue' }],
  }))
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow(
    'background commands are still active',
  )
  expect(stop).not.toHaveBeenCalled()
  const native = runs[1].nativeAgentInteractions
  expect(native).toBeDefined()
  await expect(
    native!.approve('Command', 'Inspect files', new AbortController().signal),
  ).resolves.toBe('approve')
  expect(approval).toHaveBeenCalledTimes(1)
  s.store.updateTask(task.id, (task) => ({ ...task, status: 'cancelled' }))
  await expect(
    native!.approve('Command', 'Inspect files', new AbortController().signal),
  ).resolves.toBe('deny')
  s.store.updateTask(task.id, (task) => ({ ...task, status: 'failed', sessionId: 'replacement' }))
  await expect(
    native!.approve('Command', 'Inspect files', new AbortController().signal),
  ).resolves.toBe('deny')
  expect(approval).toHaveBeenCalledTimes(1)
})

it('blocks configuration handovers without revoking the live native session credential', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  const stop = vi.fn<() => Promise<void>>(async () => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('native-session')
      run.onNativeSession?.({ stop }, 'native-session')
      run.onText('Parent reply')
      run.onSubagentEvent?.(
        'item/started',
        { threadId: 'native-child', item: { type: 'commandExecution' } },
        'native-session',
      )
    },
  })
  const task = s.tasks.create({
    title: 'Native grant',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Inspect',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const { readFile } = await import('node:fs/promises')
  const { Schema } = await import('effect')
  const { runCredentials } = await import('../../auth/run-credentials')
  const file = runs[0].agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
    ?.envValues?.DOVO_TASK_CREDENTIAL_FILE
  expect(file).toBeDefined()
  const { token } = decode(
    Schema.Struct({ token: Schema.String }),
    JSON.parse(await readFile(file!, 'utf8')),
  )
  expect(() => runCredentials(s.store).authenticate(token)).not.toThrow()
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    agentOverrides: { model: 'new-model' },
    messages: [...task.messages, { id: 'blocked-config', role: 'user', text: 'Continue' }],
  }))
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow(
    'background commands are still active',
  )
  expect(runs).toHaveLength(1)
  expect(stop).not.toHaveBeenCalled()
  expect(() => runCredentials(s.store).authenticate(token)).not.toThrow()
})

it('keeps manual compaction available for an exhausted session after accepted input failed', async () => {
  const s = await setup(),
    runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('full-session')
      if (run.compact)
        run.onEvent?.('item/completed', { item: { id: 'manual', type: 'contextCompaction' } })
      else run.onText('Partial result')
      if (runs.length === 2) throw new Error('Connection lost')
    },
  })
  const task = s.tasks.create({
    title: 'Manual compaction recovery',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    messages: [
      ...task.messages,
      { id: 'failed-before-compact', role: 'user', text: 'Implement feature' },
    ],
  }))
  await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Connection lost')
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    contextUsage: { used: 200000, limit: 200000, updatedAt: new Date().toISOString() },
    messages: [...task.messages, { id: 'manual-compact', role: 'user', text: '/compact' }],
  }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[2]).toMatchObject({ compact: true, prompt: '/compact', sessionId: 'full-session' })
})

it('aborts Stop and completes checkpoint cleanup even when its durable interrupt write fails', async () => {
  const s = await setup()
  let provider: AgentRun | undefined
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      provider = run
      await run.approve('Wait', 'Cancellation persistence failure')
      run.signal.throwIfAborted()
    },
  })
  const task = s.tasks.create({
    title: 'Stop storage failure',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Wait',
  })
  const execution = await s.tasks.start(task.id)
  await waitForTask(() => expect(s.approvals.list()).toHaveLength(1))
  const cancelQuestions = vi.spyOn(s.questions, 'cancelTask')
  vi.spyOn(s.store, 'updateTask').mockImplementationOnce(() => {
    throw new Error('interrupt disk failure')
  })
  expect(() => s.tasks.cancel(task.id)).toThrow('Could not persist all task cancellation state')
  expect(provider?.signal.aborted).toBe(true)
  expect(cancelQuestions).toHaveBeenCalledWith(task.id)
  await expect(execution.done).rejects.toThrow('Cancelled by user')
  expect(s.approvals.list()).toHaveLength(0)
  expect(s.store.task(task.id).turns?.at(-1)?.checkpoint?.after).toBeTruthy()
})

it('aborts and drains every worker before reporting a shutdown persistence failure', async () => {
  const s = await setup()
  const providers: AgentRun[] = []
  let release = () => {}
  const cleanup = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      providers.push(run)
      await run.approve('Wait', 'Shutdown persistence failure')
      await cleanup
      run.signal.throwIfAborted()
    },
  })
  const executions = []
  for (const title of ['First', 'Second']) {
    const task = s.tasks.create({
      title,
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Wait',
      execution: 'worktree',
    })
    executions.push(await s.tasks.start(task.id))
  }
  await waitForTask(() => expect(providers).toHaveLength(2))
  vi.spyOn(s.store, 'updateTask').mockImplementationOnce(() => {
    throw new Error('restart marker disk failure')
  })
  let settled = false
  const closing = s.tasks.dispose().finally(() => {
    settled = true
  })
  const result = closing.catch((error: unknown) => error)
  try {
    await waitForTask(() => expect(providers.every((run) => run.signal.aborted)).toBe(true))
    expect(settled).toBe(false)
  } finally {
    release()
  }
  expect(await result).toMatchObject({
    message: expect.stringContaining('restart marker disk failure'),
  })
  await Promise.all(
    executions.map(({ done }) => expect(done).rejects.toThrow('Runtime shutting down')),
  )
  expect(s.approvals.list()).toHaveLength(0)
})

it('recovers unrelated checkouts while an approval retains the first checkout reservation', async () => {
  const s = await setup()
  const other = await fixture()
  cleanups.push(other.cleanup)
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [...workspace.repositories, { ...other.workspace.repositories[0], id: 'other' }],
  }))
  const tasks = ['repo', 'other', 'repo'].map((repositoryId, index) =>
    s.tasks.create({
      title: `Recovery ${index}`,
      repositoryId,
      agentId: 'agent',
      objective: 'Continue',
    }),
  )
  for (const task of tasks)
    s.store.updateTask(task.id, (current) => ({
      ...current,
      status: 'failed',
      restartRecovery: { kind: 'turn', automatic: true },
    }))
  const invoked: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      invoked.push(run.taskId!)
      if (run.taskId === tasks[0].id) {
        await run.approve('Wait', 'Recovery approval')
        run.signal.throwIfAborted()
      }
      run.onText('Recovered')
    },
  })
  s.tasks.continueAfterRestart(() => true)
  await waitForTask(() => {
    expect(s.approvals.list().some((item) => item.taskId === tasks[0].id)).toBe(true)
    expect(s.store.task(tasks[1].id).status).toBe('review')
    expect(s.store.task(tasks[2].id)).toMatchObject({
      status: 'failed',
      queuePaused: true,
      restartRecovery: { kind: 'turn', automatic: false },
      error: expect.stringContaining('Another task is running'),
    })
  })
  expect(invoked).toEqual(expect.arrayContaining([tasks[0].id, tasks[1].id]))
  expect(invoked).not.toContain(tasks[2].id)
  s.tasks.cancel(tasks[0].id)
})

it('drains delayed scheduler discovery and stops admitting the remaining scheduled messages', async () => {
  const { Effect } = await import('effect')
  const { ModelSelection } = await import('./model-selection')
  const s = await setup()
  const task = s.tasks.create({
    title: 'Delayed scheduled discovery',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Wait',
  })
  s.store.updateTask(task.id, (current) => ({
    ...current,
    scheduledMessages: ['first', 'second'].map((id) => ({
      id,
      text: id,
      at: new Date(0).toISOString(),
    })),
  }))
  let entered = false,
    release = () => {}
  const discovered = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(ModelSelection.prototype, 'resolveEffect').mockImplementation((id) =>
    Effect.promise(async () => {
      entered = true
      await discovered
      s.store.updateTask(id, (current) => ({ ...current, draft: 'discovery finished' }))
    }),
  )
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const scheduled = s.tasks.runScheduled()
  await waitForTask(() => expect(entered).toBe(true))
  let closed = false
  const closing = s.tasks.dispose().then(() => {
    closed = true
  })
  try {
    // An executor handoff gives an incorrectly untracked tick time to escape shutdown.
    await Effect.runPromise(Effect.yieldNow)
    await Effect.runPromise(Effect.yieldNow)
    expect(closed).toBe(false)
  } finally {
    release()
  }
  await Promise.all([closing, scheduled])
  expect(s.store.task(task.id)).toMatchObject({
    draft: 'discovery finished',
    queue: [{ id: 'first' }],
    scheduledMessages: [{ id: 'second' }],
  })
  expect(run).not.toHaveBeenCalled()
  await s.tasks.runScheduled()
  expect(s.store.task(task.id).scheduledMessages).toHaveLength(1)
})
