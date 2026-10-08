import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import { defaultTaskHarness, taskFamilyRunToken } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../execution/types'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
vi.setConfig(runtimeIntegration)
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function taskId(run: AgentRun) {
  if (!run.taskId) throw new Error('Expected a task execution')
  return run.taskId
}
it('rechecks a stopped child against newly narrowed parent permissions at admission', async () => {
  const s = await setup()
  const childFinished = barrier()
  const parentRelease = barrier()
  let childId = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        run.onText('Done')
        return
      }
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'review',
        name: 'Review',
        prompt: 'Review',
        provider: 'claude',
      }).id
      await s.tasks.subagentWait(taskId(run), childId)
      childFinished.resolve()
      await parentRelease.promise
      run.onText('Parent done')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const running = await s.tasks.start(parent.id)
  try {
    await childFinished.promise
    s.store.updateTask(parent.id, (task) => ({
      ...task,
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    }))
    expect(s.store.task(childId).harness?.permission).toBe('ask')
    await expect(s.tasks.start(childId)).rejects.toThrow('cannot exceed')
  } finally {
    parentRelease.resolve()
    await running.done
  }
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
it('runs a Claude child from Codex in the same checkout, returns its answer, and retries without duplicating it', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  let childId = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (run.agent.provider === 'claude') {
        run.onText('Child final answer')
        return
      }
      const input = {
        taskId: taskId(run),
        key: 'review',
        name: 'Review',
        prompt: 'Review the current checkout',
        provider: 'claude' as const,
        permission: 'full-access' as const,
      }
      const child = s.tasks.subagentSpawn(input)
      childId = child.id
      expect(s.tasks.subagentSpawn(input).id).toBe(child.id)
      const result = await s.tasks.subagentWait(taskId(run), child.id)
      expect(result.status).toBe('review')
      expect(result.result).toBe('Child final answer')
      expect(s.store.task(child.id).harness?.permission).toBe('ask')
      run.onText(`Parent received: ${result.result}`)
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Delegate a review',
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(s.store.task(parent.id).error).toBeUndefined()
  expect(runs).toHaveLength(2)
  expect(runs[0].cwd).toBe(runs[1].cwd)
  expect(s.store.task(parent.id).subagents).toMatchObject([
    { source: 'dovo', taskId: childId, provider: 'claude', status: 'completed' },
  ])
  const other = s.tasks.create({
    title: 'Other',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  expect(() => s.tasks.subagentResult(other.id, childId)).toThrow('another thread')
  expect(() =>
    s.tasks.subagentSpawn({
      taskId: parent.id,
      key: 'idle',
      name: 'Idle',
      prompt: 'No',
      provider: 'claude',
    }),
  ).toThrow('active parent')
})
it('keeps children working after a reply and delivers completion once without escalating access', async () => {
  const s = await setup()
  const childStarted = barrier()
  const releaseChild = barrier()
  let childId = ''
  let childPermission = ''
  let parentTurns = 0
  let receivedPrompt = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        childPermission = run.agent.permission
        childStarted.resolve()
        await releaseChild.promise
        run.signal.throwIfAborted()
        run.onText('Child async answer')
        return
      }
      if (++parentTurns > 1) {
        receivedPrompt = run.prompt
        run.onText('Parent incorporated child answer')
        return
      }
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'inspect',
        name: 'Inspect',
        prompt: 'Inspect',
        provider: 'claude',
        permission: 'full-access',
      }).id
      await childStarted.promise
      expect((await s.tasks.subagentWait(taskId(run), childId, 0)).running).toBe(true)
      run.onText('Finishing parent')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    agentId: '',
    harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    repositoryId: 'repo',
    objective: 'Delegate inspection',
  })
  try {
    await (
      await s.tasks.start(parent.id)
    ).done
    expect(s.store.task(childId).status).toBe('running')
    expect(s.store.task(parent.id).subagents?.[0]?.status).toBe('working')
    const lastPromptAt = s.store.task(parent.id).lastPromptAt
    releaseChild.resolve()
    await waitForRuntime(() => {
      expect(parentTurns).toBe(2)
      expect(s.store.task(parent.id).activeRunId).toBeUndefined()
    })
    expect(
      s.store.task(parent.id).messages.filter((message) => message.subagentResultId === childId),
    ).toHaveLength(1)
    expect(s.store.task(parent.id).lastPromptAt).toBe(lastPromptAt)
    expect(s.store.task(childId).delegation?.completion).toBe('queued')
    expect(receivedPrompt).toContain('Child async answer')
    expect(childPermission).toBe('read-only')
  } finally {
    releaseChild.resolve()
  }
})
it('persists a failed child result without failing the parent turn', async () => {
  const s = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'opencode') throw new Error('Provider unavailable')
      const child = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'check',
        name: 'Check',
        prompt: 'Check',
        provider: 'opencode',
      })
      const result = await s.tasks.subagentWait(taskId(run), child.id)
      expect(result.status).toBe('failed')
      expect(result.error).toContain('Provider unavailable')
      run.onText('Child failed; handled in parent')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Delegate',
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(s.store.task(parent.id).status).toBe('review')
})

it('resolves scoped ACP configurations, rejects stale attempts and conflicting retry keys, and limits active children', async () => {
  const s = await setup()
  const preset = {
    ...defaultTaskHarness('acp'),
    id: 'registered',
    name: 'Registered',
    executablePath: 'test-acp',
    model: 'host-model',
    permission: 'full-access' as const,
  }
  const current = s.defaults.get()
  s.defaults.save(
    { ...current, scopedSettings: { environment: { agents: [preset] }, shared: [] } },
    false,
  )
  const children: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'acp') {
        children.push(run)
        await new Promise<void>((resolve) => {
          if (run.signal.aborted) resolve()
          else run.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return
      }
      const input = {
        taskId: taskId(run),
        agentId: preset.id,
        key: 'registered-0',
        name: 'Registered 0',
        prompt: 'Inspect',
      }
      expect(() => s.tasks.subagentSpawn({ ...input, parentRunId: 'stale-attempt' })).toThrow(
        'parent turn has ended',
      )
      const child = s.tasks.subagentSpawn(input)
      expect(() => s.tasks.subagentSpawn({ ...input, prompt: 'Another goal' })).toThrow(
        'different request',
      )
      for (let index = 1; index < 4; index++)
        s.tasks.subagentSpawn({ ...input, key: `registered-${index}`, name: `Registered ${index}` })
      expect(() => s.tasks.subagentSpawn({ ...input, key: 'too-many' })).toThrow('maximum four')
      await waitForRuntime(() => expect(children).toHaveLength(4))
      expect(
        children.every(
          (child) => child.agent.model === 'host-model' && child.agent.permission === 'ask',
        ),
      ).toBe(true)
      expect(() =>
        s.store.patch({
          collection: 'tasks',
          id: child.id,
          changes: {
            harness: {
              before: s.store.task(child.id).harness,
              after: { ...s.store.task(child.id).harness, permission: 'full-access' },
            },
          },
        }),
      ).toThrow('Stop the active turn')
      s.tasks.subagentCancel(taskId(run), child.id)
      expect((await s.tasks.subagentWait(taskId(run), child.id)).status).toBe('cancelled')
      expect(() =>
        s.store.updateTask(child.id, (task) => ({
          ...task,
          agentOverrides: { permission: 'full-access' },
        })),
      ).toThrow('cannot exceed')
      run.onText('Checked scope and limits')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Delegate',
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  s.tasks.stopAgents(parent.id, taskFamilyRunToken(s.store.get().tasks, parent.id))
  await waitForRuntime(() =>
    expect(s.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true),
  )
  expect(s.tasks.subagentList(parent.id)).toHaveLength(4)
})

it('keeps children across queued parent turns and drains them on explicit cancellation', async () => {
  const s = await setup()
  const childStarted = barrier()
  const childAborted = barrier()
  const releaseChild = barrier()
  const secondStarted = barrier()
  let attempts = 0
  let childId = ''
  let cleaned = false
  let secondSawWorking = false
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        childStarted.resolve()
        await new Promise<void>((resolve) => {
          if (run.signal.aborted) resolve()
          else run.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        childAborted.resolve()
        await releaseChild.promise
        cleaned = true
        return
      }
      attempts++
      if (attempts === 1) {
        childId = s.tasks.subagentSpawn({
          taskId: taskId(run),
          key: 'first',
          name: 'Child',
          prompt: 'Work',
          provider: 'claude',
        }).id
        await childStarted.promise
        await s.tasks.send(taskId(run), 'second', 'Next turn')
        run.onText('First finished')
      } else {
        secondSawWorking = !cleaned && s.tasks.subagentResult(taskId(run), childId).running
        secondStarted.resolve()
        await new Promise<void>((resolve) => {
          if (run.signal.aborted) resolve()
          else run.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const running = await s.tasks.start(parent.id)
  try {
    await secondStarted.promise
    expect(attempts).toBe(2)
    expect(secondSawWorking).toBe(true)
    s.tasks.cancel(parent.id)
    await childAborted.promise
    expect(cleaned).toBe(false)
    releaseChild.resolve()
    await expect(running.done).rejects.toThrow('Cancelled by user')
    expect(s.store.task(parent.id).status).toBe('cancelled')
    expect(s.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true)
  } finally {
    releaseChild.resolve()
  }
})

it.each(['failed', 'cancelled'] as const)(
  'drains child cleanup before capturing a %s parent checkpoint',
  async (outcome) => {
    const s = await setup()
    const childStarted = barrier()
    const childAborted = barrier()
    const releaseChild = barrier()
    const finishParent = barrier()
    let childId = ''
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        if (run.agent.provider === 'claude') {
          childStarted.resolve()
          await new Promise<void>((resolve) => {
            if (run.signal.aborted) resolve()
            else run.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          childAborted.resolve()
          await releaseChild.promise
          await writeFile(join(run.cwd, 'hello.txt'), 'child cleanup write\n')
          return
        }
        childId = s.tasks.subagentSpawn({
          taskId: taskId(run),
          key: 'writer',
          name: 'Writer',
          prompt: 'Work',
          provider: 'claude',
        }).id
        await childStarted.promise
        if (outcome === 'cancelled')
          await new Promise<void>((resolve) => {
            if (run.signal.aborted) resolve()
            else run.signal.addEventListener('abort', () => resolve(), { once: true })
          })
        else await finishParent.promise
        if (outcome === 'failed') throw new Error('Parent provider failed')
        run.onText('Parent done')
      },
    })
    const parent = s.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
    })
    const running = await s.tasks.start(parent.id)
    try {
      await childStarted.promise
      if (outcome === 'cancelled') s.tasks.cancel(parent.id)
      else finishParent.resolve()
      await childAborted.promise
      expect(s.store.task(parent.id).turns?.at(-1)?.checkpoint?.after).toBeUndefined()
      expect(() =>
        s.tasks.subagentSpawn({
          taskId: parent.id,
          key: 'late',
          name: 'Late',
          prompt: 'Too late',
          provider: 'claude',
        }),
      ).toThrow('active parent turn')
      releaseChild.resolve()
      const failure = await running.done.then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
      expect(failure).toBe(outcome === 'cancelled' ? 'Cancelled by user' : 'Parent provider failed')
      const task = s.store.task(parent.id)
      expect(task.status).toBe(outcome)
      expect(s.tasks.subagentResult(parent.id, childId).running).toBe(false)
      const after = task.turns?.at(-1)?.checkpoint?.after
      if (!after) throw new Error('Expected a completed checkpoint')
      const cwd = await s.checkouts.directory(parent.id)
      expect(await s.git.command(cwd, ['show', `${after}:hello.txt`])).toBe('child cleanup write\n')
      const files = task.turns?.at(-1)?.checkpoint?.files
      expect(files?.map((file) => file.path)).toContain('hello.txt')
    } finally {
      finishParent.resolve()
      releaseChild.resolve()
    }
  },
)

it('holds asynchronous results in a paused queue and lets a read remove the pending wake', async () => {
  const s = await setup()
  const started = barrier()
  const release = barrier()
  let childId = ''
  let parentTurns = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        started.resolve()
        await release.promise
        run.onText('Paused result')
        return
      }
      parentTurns++
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'paused',
        name: 'Paused',
        prompt: 'Work',
        provider: 'claude',
      }).id
      await started.promise
      s.tasks.queue.change(taskId(run), 'pause')
      run.onText('Parent paused')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  try {
    await (
      await s.tasks.start(parent.id)
    ).done
    release.resolve()
    await waitForRuntime(() =>
      expect(s.store.task(parent.id).queue?.[0]?.subagentResultId).toBe(childId),
    )
    expect(parentTurns).toBe(1)
    expect(s.store.task(parent.id).queuePaused).toBe(true)
    expect(() => s.tasks.subagentResult(parent.id, childId, true, 'stale-parent-run')).toThrow(
      'parent turn has ended',
    )
    expect(s.store.task(childId).delegation?.completion).toBe('queued')
    expect(s.tasks.subagentResult(parent.id, childId).result).toBe('Paused result')
    expect(s.store.task(parent.id).queue).toEqual([])
    expect(s.store.task(childId).delegation?.completion).toBe('read')
    await s.tasks.runScheduled()
    expect(s.store.task(parent.id).queue).toEqual([])
    expect(parentTurns).toBe(1)
  } finally {
    release.resolve()
  }
})

it('stops children from an idle parent, rejects stale group stops, and never wakes after Stop', async () => {
  const s = await setup()
  const started = barrier()
  let childId = ''
  let parentTurns = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        started.resolve()
        await new Promise<void>((resolve) =>
          run.signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        return
      }
      parentTurns++
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'stop',
        name: 'Stop',
        prompt: 'Work',
        provider: 'claude',
      }).id
      await started.promise
      run.onText('Waiting asynchronously')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const stale = taskFamilyRunToken(s.store.get().tasks, parent.id)
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(() => s.tasks.stopAgents(parent.id, stale)).toThrow('Agent state changed')
  expect(s.store.task(childId).status).toBe('running')
  s.tasks.stopAgents(parent.id, taskFamilyRunToken(s.store.get().tasks, parent.id))
  await waitForRuntime(() => expect(s.store.task(childId).activeRunId).toBeUndefined())
  expect(s.store.task(childId).status).toBe('cancelled')
  expect(s.store.task(childId).delegation?.completion).toBe('disposed')
  expect(parentTurns).toBe(1)
  expect(s.store.task(parent.id).queue ?? []).toEqual([])
})

it('waits for nested results to be incorporated before delivering the child to the root', async () => {
  const s = await setup()
  const grandchildStarted = barrier()
  const release = barrier()
  let childId = ''
  let rootTurns = 0
  let childTurns = 0
  let childPrompt = ''
  let rootPrompt = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'opencode') {
        grandchildStarted.resolve()
        await release.promise
        run.onText('Grandchild finding')
      } else if (run.agent.provider === 'claude') {
        if (++childTurns === 1) {
          s.tasks.subagentSpawn({
            taskId: taskId(run),
            key: 'nested',
            name: 'Nested',
            prompt: 'Inspect',
            provider: 'opencode',
          })
          await grandchildStarted.promise
          run.onText('Child waiting')
        } else {
          childPrompt = run.prompt
          run.onText('Child incorporated grandchild')
        }
      } else if (++rootTurns === 1) {
        childId = s.tasks.subagentSpawn({
          taskId: taskId(run),
          key: 'child',
          name: 'Child',
          prompt: 'Work',
          provider: 'claude',
        }).id
        await grandchildStarted.promise
        run.onText('Root waiting')
      } else {
        rootPrompt = run.prompt
        run.onText('Root complete')
      }
    },
  })
  const parent = s.tasks.create({
    title: 'Root',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  try {
    await (
      await s.tasks.start(parent.id)
    ).done
    await waitForRuntime(() => expect(s.store.task(childId).activeRunId).toBeUndefined())
    expect(s.tasks.subagentResult(parent.id, childId).running).toBe(true)
    expect(s.store.task(parent.id).subagents?.[0]?.status).toBe('working')
    expect(rootTurns).toBe(1)
    release.resolve()
    await waitForRuntime(() => {
      expect(rootTurns).toBe(2)
      expect(s.store.task(parent.id).activeRunId).toBeUndefined()
    })
    expect(childTurns).toBe(2)
    expect(childPrompt).toContain('Grandchild finding')
    expect(rootPrompt).toContain('Child incorporated grandchild')
    expect(s.tasks.subagentResult(parent.id, childId).running).toBe(false)
  } finally {
    release.resolve()
  }
})

it('retains a completion when the queue is full and retries delivery once space is available', async () => {
  const s = await setup()
  const started = barrier()
  const release = barrier()
  let childId = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        started.resolve()
        await release.promise
        run.onText('Full queue result')
        return
      }
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'full',
        name: 'Full',
        prompt: 'Work',
        provider: 'claude',
      }).id
      await started.promise
      s.tasks.queue.change(taskId(run), 'pause')
      for (let i = 0; i < 50; i++) s.tasks.queue.add(taskId(run), `queued-${i}`, `User input ${i}`)
      run.onText('Parent paused')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  try {
    await (
      await s.tasks.start(parent.id)
    ).done
    release.resolve()
    await waitForRuntime(() => expect(s.store.task(childId).activeRunId).toBeUndefined())
    expect(s.store.task(childId).delegation?.completion).toBe('pending')
    s.tasks.queue.change(parent.id, 'remove', 'queued-0')
    await s.tasks.runScheduled()
    expect(s.store.task(childId).delegation?.completion).toBe('queued')
    expect(
      s.store.task(parent.id).queue?.filter((message) => message.subagentResultId === childId),
    ).toHaveLength(1)
    await s.tasks.runScheduled()
    expect(s.store.task(parent.id).queue).toHaveLength(50)
  } finally {
    release.resolve()
  }
})
