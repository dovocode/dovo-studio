import { decode } from '@dovo/protocol'
import type { AgentAdapter } from './types'
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import type { AgentRun, AgentSteer } from './types'
import { defaultTaskHarness, type Agent, type Task } from '@dovo/protocol'
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
  expect(s.store.task(task.id).messages.at(-1)?.text).toBe('Hello world')
  expect(s.store.task(task.id).status).toBe('review')
  expect(s.store.task(task.id).turns?.at(-1)?.runtimeHost).toBeTruthy()
  expect(s.activity.list('tool.completed', 'agent-event', 0).events[0].payload).toContain(
    'git status',
  )
  s.store.updateTask(task.id, (t) => ({
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
it('serializes repository runs and cancellation denies pending approvals and releases the lock', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(await run.approve('Command', 'test')).toBe(false)
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
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
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
  await vi.waitFor(() => expect(prompts).toHaveLength(1))
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
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
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
      expect(s.store.get().tasks[0].turns?.at(-1)?.checkpoint?.before).toBeTruthy()
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
it.each([false, true])('steers ahead of queued input and preserves paused=%s', async (paused) => {
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
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
  await s.tasks.send(task.id, 'later', 'Do this later')
  if (paused) s.tasks.queue.change(task.id, 'pause')
  await s.tasks.steer(task.id, 'steering', 'Change direction now')
  await expect(first.done).rejects.toThrow('Interrupted to apply steering')
  await vi.waitFor(() => expect(s.store.task(task.id).status).toBe('review'))
  expect(runs[1].sessionId).toBe('steering-session')
  expect(runs[1].prompt).toContain('Change direction now')
  expect(runs[1].prompt).not.toContain('Do this later')
  expect(s.store.task(task.id).turns?.[0].checkpoint?.after).toBeTruthy()
  await vi.waitFor(() => expect(runs).toHaveLength(paused ? 2 : 3))
  expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(paused ? ['later'] : [])
  expect(runs.at(-1)?.prompt).toContain(paused ? 'Change direction now' : 'Do this later')
  await s.tasks.steer(task.id, 'steering', 'Change direction now')
  expect(s.store.task(task.id).messages.filter((m) => m.id === 'steering')).toHaveLength(1)
})
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
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
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
        before: null,
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
          run.onSteer?.(steer)
          await completed
          run.onSteer?.(undefined)
        }
        run.onText('After steering')
      },
    })
    const task = s.tasks.create({
      title: 'Native',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original',
    })
    const execution = await s.tasks.start(task.id)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    await s.tasks.send(task.id, 'later', 'Do this later')
    if (paused) s.tasks.queue.change(task.id, 'pause')
    await s.tasks.steer(task.id, 'live', 'New direction')
    await s.tasks.steer(task.id, 'live', 'New direction')
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
    release()
    await execution.done
    expect(runs).toHaveLength(paused ? 1 : 2)
    expect(s.store.task(task.id).queue?.map((m) => m.id)).toEqual(paused ? ['later'] : [])
    expect(s.store.task(task.id).turns?.every((turn) => turn.status === 'completed')).toBe(true)
    expect(s.store.task(task.id).consumedMessageIds).toContain('live')
    expect(runs[1]?.prompt).toBe(paused ? undefined : 'user: Do this later')
    expect(runs[1]?.sessionId).toBe(paused ? undefined : 'native-session')
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
  await vi.waitFor(() => expect(ready).toBe(true))
  await s.tasks.steer(task.id, 'live', 'New direction')
  expect(s.store.task(task.id).error).toContain('not confirmed')
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
  const originalTask = s.store.task.bind(s.store)
  let injected = false
  vi.spyOn(s.store, 'task').mockImplementation((id) => {
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
    await vi.waitFor(() => expect(ready).toBe(true))
    await s.tasks.send(task.id, 'later', 'Do this later')
    const steering = s.tasks.steer(task.id, 'live', 'New direction')
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
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
    await vi.waitFor(() => expect(s.questions.list()).toHaveLength(1))
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
    await vi.waitFor(() =>
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
  await vi.waitFor(() => expect(s.questions.list()).toHaveLength(1))
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
  await vi.waitFor(() => expect(s.questions.list()).toHaveLength(2))
  const [first, second] = s.questions.list()
  s.questions.respond(first.id, {
    answer: ['One'],
  })
  await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
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
    await vi.waitFor(() => expect(s.store.task(task.id).status).toBe('review'))
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
            permission: 'ask',
            resources: {
              mcpServers: [],
              skills: [],
            },
          }
    expect(configured).toMatchObject(expected)
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
