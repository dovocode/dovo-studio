import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import { defaultTaskHarness, resolveTaskAgent, taskFamilyRunToken, type Task } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../execution/types'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OwnedProcessShutdownError } from '../execution/stop-owned-child'
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
it('updates an ended child to narrowed parent access and stops the running parent', async () => {
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
  const stopped = running.done.then(
    () => undefined,
    (error: unknown) => error,
  )
  try {
    await childFinished.promise
    s.store.updateTask(parent.id, (task) => ({
      ...task,
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    }))
    expect(resolveTaskAgent(s.store.task(childId), s.store.get().agents)?.permission).toBe(
      'read-only',
    )
  } finally {
    parentRelease.resolve()
    expect(await stopped).toMatchObject({
      message: expect.stringContaining('Access was tightened'),
    })
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
it.each(['failed', 'cancelled'] as const)(
  'cancels an orphan %s child and its descendants without losing their histories',
  async (status) => {
    const s = await setup()
    const parent = s.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Delegate',
    })
    s.store.updateTask(parent.id, (task) => ({ ...task, status: 'review' }))
    const children = [parent.id]
    for (const key of ['child', 'descendant']) {
      const child = s.tasks.create({
        title: key,
        repositoryId: 'repo',
        agentId: 'agent',
        objective: 'Inspect',
      })
      s.store.updateTaskHistory(child.id, (task) => ({
        ...task,
        status,
        activeRunId: `orphan-${key}`,
        activity: 'Stale activity',
        queuePaused: false,
        queue: [{ id: `queued-${key}`, role: 'user', text: 'Held input', createdAt: '' }],
        delegation: {
          parentTaskId: children.at(-1)!,
          parentRunId: 'retired-parent',
          key,
          completion: 'disposed',
        },
        messages: [
          ...task.messages,
          {
            id: `answer-${key}`,
            role: 'assistant',
            text: 'Retained answer',
            createdAt: '',
          },
        ],
      }))
      children.push(child.id)
    }
    const histories = children.slice(1).map((id) => s.store.task(id).messages)
    const result = s.tasks.subagentCancel(parent.id, children[1])
    expect(result).toMatchObject({
      status: 'cancelled',
      running: false,
      subagent: { status: 'stopped' },
    })
    for (const [index, id] of children.slice(1).entries()) {
      expect(s.store.task(id)).toMatchObject({
        status: 'cancelled',
        queuePaused: true,
        delegation: { completion: 'disposed' },
      })
      expect(s.store.task(id).activeRunId).toBeUndefined()
      expect(s.store.task(id).activity).toBeUndefined()
      expect(s.store.task(id).messages).toEqual(histories[index])
      expect(s.store.task(id).queue).toHaveLength(1)
    }
    expect(s.tasks.hasWorkingFamily(parent.id)).toBe(false)
    expect(s.tasks.subagentCancel(parent.id, children[1]).running).toBe(false)
  },
)
it('releases a failed child only after late shutdown confirmation and keeps its queue paused', async () => {
  const s = await setup()
  const confirmed = barrier()
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Delegate',
  })
  // Keep the parent tool binding live while the failed child owns the shared checkout.
  const parentRelease = barrier()
  let childId = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        run.onText('Retained partial answer')
        throw new OwnedProcessShutdownError('Provider shutdown was not confirmed', {
          confirmed: confirmed.promise,
        })
      }
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'late-exit',
        name: 'Child',
        prompt: 'Inspect',
        provider: 'claude',
      }).id
      await parentRelease.promise
      run.onText('Done')
    },
  })
  const running = await s.tasks.start(parent.id)
  try {
    await waitForRuntime(() => expect(childId).not.toBe(''))
    await waitForRuntime(() => expect(s.store.task(childId).status).toBe('failed'))
    const attempt = s.store.task(childId).activeRunId
    expect(attempt).toBeTypeOf('string')
    expect(s.store.task(childId).turns?.at(-1)?.checkpoint?.after).toBeUndefined()
    s.store.updateTask(childId, (task) => ({
      ...task,
      queue: [{ id: 'held', role: 'user', text: 'Do not replay', createdAt: '' }],
    }))
    expect(s.tasks.subagentCancel(parent.id, childId).running).toBe(true)
    expect(s.store.providerActions.state(`interrupt:${attempt}`)).toBe('uncertain')
    expect(s.tasks.subagentCancel(parent.id, childId).running).toBe(true)
    expect(s.store.providerActions.state(`interrupt:${attempt}`)).toBe('uncertain')
    await expect(s.tasks.start(childId)).rejects.toThrow('delegation was stopped')
    const competing = s.tasks.create({
      title: 'Competing',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Wait',
    })
    await expect(s.tasks.start(competing.id)).rejects.toThrow('Another task is running')
    confirmed.resolve()
    await waitForRuntime(() =>
      expect(s.tasks.subagentResult(parent.id, childId).running).toBe(false),
    )
    expect(s.store.task(childId).activeRunId).toBeUndefined()
    expect(s.store.task(childId).queuePaused).toBe(true)
    expect(s.store.task(childId).queue).toHaveLength(1)
    expect(
      s.store.task(childId).messages.some((message) => message.text === 'Retained partial answer'),
    ).toBe(true)
    expect(s.store.providerActions.state(`interrupt:${attempt}`)).toBe('completed')
    expect(s.tasks.subagentResult(parent.id, childId).subagent?.status).toBe('stopped')
    expect(() => s.tasks.requireIdle(childId)).not.toThrow()
  } finally {
    confirmed.resolve()
    parentRelease.resolve()
    await running.done
  }
})
it('runs read-only audits without Git checkpoints and releases their completed provider', async () => {
  const s = await setup()
  const linked = await fixture()
  cleanups.push(linked.cleanup)
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [
      ...workspace.repositories,
      { id: 'linked', name: 'Linked', path: linked.directory, branch: 'main' },
    ],
  }))
  const snapshot = vi.spyOn(s.git, 'snapshot')
  const changes = vi.spyOn(s.git, 'changes')
  const release = vi.spyOn(s.agents, 'releaseTask').mockResolvedValue()
  let childId = ''
  let childPermission: AgentRun['agent']['permission'] | undefined
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        childPermission = run.agent.permission
        run.onText('Audit complete')
        return
      }
      snapshot.mockClear()
      changes.mockClear()
      childId = s.tasks.subagentSpawn({
        taskId: taskId(run),
        key: 'read-only-audit',
        name: 'Audit',
        prompt: 'Inspect',
        provider: 'claude',
        permission: 'read-only',
      }).id
      const result = await s.tasks.subagentWait(taskId(run), childId)
      expect(result.result).toBe('Audit complete')
      expect(snapshot).not.toHaveBeenCalled()
      expect(changes).not.toHaveBeenCalled()
      expect(s.store.task(childId).turns?.at(-1)?.checkpoint).toBeUndefined()
      expect(release).toHaveBeenCalledWith(childId)
      run.onText('Parent complete')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Audit',
    linkedCheckouts: [{ id: 'linked', repositoryId: 'linked', access: 'edit', execution: 'main' }],
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(s.store.task(childId).status).toBe('review')
  expect(childPermission).toBe('read-only')
  expect(snapshot).toHaveBeenCalledTimes(2)
  expect(s.store.task(parent.id).turns?.at(-1)?.checkpoint?.linked).toHaveLength(1)
  expect(changes).toHaveBeenCalledOnce()
})
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
    ).toHaveLength(0)
    expect(s.store.task(parent.id).queue ?? []).toEqual([])
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
      expect(() => s.tasks.subagentSpawn({ ...input, key: 'too-many' })).toThrow('maximum 4')
      s.preferences.save({ maxActiveChildAgents: 5 })
      s.tasks.subagentSpawn({ ...input, key: 'registered-4', name: 'Registered 4' })
      s.preferences.save({ maxActiveChildAgents: 2 })
      expect(() => s.tasks.subagentSpawn({ ...input, key: 'still-too-many' })).toThrow('maximum 2')
      // A retry of the same child is still allowed, and lowering the limit never stops children.
      expect(s.tasks.subagentSpawn(input).id).toBe(child.id)
      await waitForRuntime(() => expect(children).toHaveLength(5))
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
  await s.tasks.stopAgents(parent.id, taskFamilyRunToken(s.store.get().tasks, parent.id))
  await waitForRuntime(() =>
    expect(s.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true),
  )
  expect(s.tasks.subagentList(parent.id)).toHaveLength(5)
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

it('holds asynchronous results in a paused inbox and lets a read remove the pending wake', async () => {
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
      expect(s.store.task(parent.id).subagentInbox?.[0]?.subagentResultId).toBe(childId),
    )
    expect(parentTurns).toBe(1)
    expect(s.store.task(parent.id).queuePaused).toBe(true)
    expect(() => s.tasks.subagentResult(parent.id, childId, true, 'stale-parent-run')).toThrow(
      'parent turn has ended',
    )
    expect(s.store.task(childId).delegation?.completion).toBe('queued')
    expect(s.tasks.subagentResult(parent.id, childId).result).toBe('Paused result')
    expect(s.store.task(parent.id).queue ?? []).toEqual([])
    expect(s.store.task(childId).delegation?.completion).toBe('read')
    expect(s.store.task(parent.id).subagentInbox).toEqual([])
    await s.tasks.runScheduled()
    expect(s.store.task(parent.id).queue ?? []).toEqual([])
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
  await s.tasks.stopAgents(parent.id, taskFamilyRunToken(s.store.get().tasks, parent.id))
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

it('delivers a completion independently of a full user queue', async () => {
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
    expect(s.store.task(childId).delegation?.completion).toBe('queued')
    expect(s.store.task(parent.id).queue).toHaveLength(50)
    expect(s.store.task(parent.id).subagentInbox).toHaveLength(1)
    await s.tasks.runScheduled()
    expect(s.store.task(parent.id).queue).toHaveLength(50)
    expect(s.store.task(parent.id).subagentInbox).toHaveLength(1)
    expect(s.tasks.subagentResult(parent.id, childId).result).toBe('Full queue result')
    expect(s.store.task(parent.id).subagentInbox).toEqual([])
    expect(s.store.task(parent.id).queue).toHaveLength(50)
  } finally {
    release.resolve()
  }
})

it.each([false, true])(
  'recovers an interrupted nested family without stranding its root (automatic=%s)',
  async (automatic) => {
    const s = await setup()
    const root = s.tasks.create({
      title: 'Root',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Work',
    })
    const child = s.tasks.create({
      title: 'Child',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Work',
    })
    const grandchild = s.tasks.create({
      title: 'Grandchild',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Work',
    })
    for (const [task, parentId] of [
      [child, root.id],
      [grandchild, child.id],
    ] as const) {
      s.store.updateTask(task.id, (current) => ({
        ...current,
        status: 'failed',
        restartRecovery: { kind: 'turn', automatic },
        delegation: {
          parentTaskId: parentId,
          parentRunId: 'interrupted-run',
          key: task.id,
          completion: 'pending',
        },
      }))
    }
    s.tasks.continueAfterRestart(() => automatic)
    expect(s.tasks.subagentResult(root.id, child.id, false).running).toBe(false)
    expect(
      s.store
        .task(root.id)
        .subagentInbox?.filter((message) => message.subagentResultId === child.id),
    ).toHaveLength(1)
    expect(s.store.task(child.id).queue ?? []).toEqual([])
    expect(s.store.task(grandchild.id).status).toBe('cancelled')
    s.tasks.continueAfterRestart(() => automatic)
    expect(
      s.store
        .task(root.id)
        .subagentInbox?.filter((message) => message.subagentResultId === child.id),
    ).toHaveLength(1)
  },
)

it('preserves same-harness connection settings and blocks parent edits while a child runs', async () => {
  const s = await setup()
  const started = barrier()
  let childId = ''
  let turns = 0
  let childAgent: AgentRun['agent'] | undefined
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (++turns === 1) {
        childId = s.tasks.subagentSpawn({
          taskId: taskId(run),
          key: 'connection',
          name: 'Child',
          prompt: 'Work',
          provider: 'codex',
        }).id
        await started.promise
        run.onText('Child continues')
      } else {
        started.resolve()
        childAgent = run.agent
        await new Promise<void>((resolve) =>
          run.signal.addEventListener('abort', () => resolve(), { once: true }),
        )
      }
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Work',
    harness: {
      ...defaultTaskHarness('codex'),
      configDirectory: '/custom/account',
      env: { DOVO_CUSTOM: 'present' },
    },
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(childAgent?.configDirectory).toBe('/custom/account')
  expect(childAgent?.env).toMatchObject({ DOVO_CUSTOM: 'present' })
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: parent.id,
      changes: {
        harness: {
          before: s.store.task(parent.id).harness,
          after: { ...s.store.task(parent.id).harness, permission: 'read-only' },
        },
      },
    }),
  ).toThrow('Stop the active turn')
  expect(() => s.checkouts.linked.save(parent.id, [], [])).toThrow('Finish or stop pending work')
  s.tasks.subagentCancel(parent.id, childId)
  await waitForRuntime(() => expect(s.store.task(childId).activeRunId).toBeUndefined())
  expect(s.store.task(childId).delegation?.completion).toBe('disposed')
  expect(s.store.task(parent.id).queue ?? []).toEqual([])
  expect(turns).toBe(2)
})

it('enforces child capacity and archived ancestors during direct admission', async () => {
  const s = await setup()
  s.preferences.save({ maxActiveChildAgents: 1 })
  const root = s.tasks.create({
    title: 'Root',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  const sibling = s.tasks.create({
    title: 'Active reservation',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  const child = s.tasks.create({
    title: 'Ended child',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  for (const task of [sibling, child])
    s.store.updateTask(task.id, (current) => ({
      ...current,
      status: task.id === child.id ? 'review' : 'draft',
      delegation: {
        parentTaskId: root.id,
        parentRunId: 'old-run',
        key: task.id,
        completion: 'read',
      },
    }))
  await expect(s.tasks.start(child.id)).rejects.toThrow('maximum 1')
  s.store.updateTask(sibling.id, (task) => ({ ...task, status: 'review' }))
  s.store.updateTask(root.id, (task) => ({ ...task, archivedAt: new Date().toISOString() }))
  await expect(s.tasks.start(child.id)).rejects.toThrow('Restore the parent thread')
  s.store.updateTask(root.id, (task) => ({ ...task, archivedAt: undefined }))
  const nested = s.tasks.create({
    title: 'Nested ended child',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  s.store.updateTask(nested.id, (task) => ({
    ...task,
    status: 'review',
    delegation: {
      parentTaskId: child.id,
      parentRunId: 'old-run',
      key: 'nested',
      completion: 'read',
    },
  }))
  s.store.updateTask(sibling.id, (task) => ({ ...task, status: 'draft' }))
  await expect(s.tasks.start(nested.id)).rejects.toThrow('maximum 1')
})

it('rejects unsupported child access before creation and chooses a safe supported fallback', async () => {
  const s = await setup()
  let childId = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'cursor') {
        run.onText('Read-only inspection')
        return
      }
      const before = s.store.get().tasks.length
      const input = {
        taskId: taskId(run),
        key: 'access',
        name: 'Child',
        prompt: 'Inspect',
        permission: 'read-only' as const,
      }
      expect(() => s.tasks.subagentSpawn({ ...input, provider: 'hermes' })).toThrow(
        'has no access mode',
      )
      expect(s.store.get().tasks).toHaveLength(before)
      childId = s.tasks.subagentSpawn({ ...input, provider: 'cursor', permission: 'ask' }).id
      await s.tasks.subagentWait(taskId(run), childId)
      run.onText('Parent complete')
    },
  })
  const parent = s.tasks.create({
    title: 'Read-only parent',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Work',
    harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(s.store.task(childId).harness?.permission).toBe('read-only')
  expect(s.store.task(childId).status).toBe('review')
})

it.each(['read-only', 'ask', 'workspace-write', 'auto', 'full-access'] as const)(
  'inherits %s access across harnesses and named configurations unless explicitly narrowed',
  async (permission) => {
    const s = await setup()
    const preset = {
      ...defaultTaskHarness('claude'),
      id: 'reviewer',
      name: 'Reviewer',
      permission: 'read-only' as const,
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
        if (run.agent.provider === 'claude') {
          children.push(run)
          run.onText('Done')
          return
        }
        for (const [key, options] of [
          ['builtin', { provider: 'claude' as const }],
          ['named', { agentId: preset.id }],
          ['narrowed', { agentId: preset.id, permission: 'read-only' as const }],
        ] as const) {
          const child = s.tasks.subagentSpawn({
            taskId: taskId(run),
            key,
            name: key,
            prompt: 'Inspect without changing files',
            ...options,
          })
          await s.tasks.subagentWait(taskId(run), child.id)
          expect(s.store.task(child.id).harness?.permission).toBe(
            key === 'narrowed' ? 'read-only' : permission,
          )
        }
        run.onText('Parent done')
      },
    })
    const parent = s.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Delegate',
      harness: { ...defaultTaskHarness('codex'), permission },
    })
    await (
      await s.tasks.start(parent.id)
    ).done
    expect(children.map((child) => child.agent.permission)).toEqual([
      permission,
      permission,
      'read-only',
    ])
    expect(s.store.task(parent.id).error).toBeUndefined()
  },
)

it('inherits both advanced controls from the parent rather than a named preset and rejects escalation before creation', async () => {
  const s = await setup()
  const preset = {
    ...defaultTaskHarness('codex'),
    id: 'advanced-preset',
    name: 'Advanced preset',
    approvalPolicy: 'never' as const,
    sandboxMode: 'danger-full-access' as const,
  }
  s.defaults.save(
    { ...s.defaults.get(), scopedSettings: { environment: { agents: [preset] }, shared: [] } },
    false,
  )
  let parentId = ''
  const children: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (taskId(run) !== parentId) {
        children.push(run)
        run.onText('Done')
        return
      }
      const scope = { taskId: parentId, name: 'Child', prompt: 'Fixture work' }
      for (const [key, options] of [
        ['builtin', { provider: 'codex' as const }],
        ['named', { agentId: preset.id }],
        [
          'narrowed',
          {
            agentId: preset.id,
            approvalPolicy: 'untrusted' as const,
            sandboxMode: 'read-only' as const,
          },
        ],
      ] as const) {
        const child = s.tasks.subagentSpawn({ ...scope, key, ...options })
        await s.tasks.subagentWait(parentId, child.id)
        expect(s.store.task(child.id).harness).toMatchObject({
          approvalPolicy: key === 'narrowed' ? 'untrusted' : 'on-request',
          sandboxMode: key === 'narrowed' ? 'read-only' : 'workspace-write',
        })
      }
      const count = s.store.get().tasks.length
      expect(() =>
        s.tasks.subagentSpawn({
          ...scope,
          key: 'approval-escape',
          provider: 'codex',
          approvalPolicy: 'never',
        }),
      ).toThrow('cannot exceed')
      expect(() =>
        s.tasks.subagentSpawn({
          ...scope,
          key: 'sandbox-escape',
          provider: 'codex',
          sandboxMode: 'danger-full-access',
        }),
      ).toThrow('cannot exceed')
      expect(() =>
        s.tasks.subagentSpawn({ ...scope, key: 'unsupported', provider: 'claude' }),
      ).toThrow('does not support sandbox')
      expect(s.store.get().tasks).toHaveLength(count)
      run.onText('Parent done')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Delegate',
    harness: {
      ...defaultTaskHarness('codex'),
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
    },
  })
  parentId = parent.id
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(
    children.map((child) => [
      child.agent.approvalPolicy,
      child.agent.sandboxMode,
      child.agent.permission,
    ]),
  ).toEqual([
    ['on-request', 'workspace-write', 'full-access'],
    ['on-request', 'workspace-write', 'full-access'],
    ['untrusted', 'read-only', 'read-only'],
  ])
  expect(s.store.task(parent.id).error).toBeUndefined()
})

it.each(['approvalPolicy', 'sandboxMode'] as const)(
  'propagates tightened %s to ended children and revokes the running parent',
  async (dimension) => {
    const s = await setup()
    const childFinished = barrier(),
      parentRelease = barrier()
    let childId = '',
      parentId = ''
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        if (taskId(run) !== parentId) {
          run.onText('Done')
          return
        }
        childId = s.tasks.subagentSpawn({
          taskId: parentId,
          key: 'child',
          name: 'Child',
          prompt: 'Fixture',
          provider: 'codex',
        }).id
        await s.tasks.subagentWait(parentId, childId)
        childFinished.resolve()
        await parentRelease.promise
        run.onText('Parent done')
      },
    })
    const parent = s.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Delegate',
      harness: {
        ...defaultTaskHarness('codex'),
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
      },
    })
    parentId = parent.id
    const running = await s.tasks.start(parent.id)
    const stopped = running.done.then(
      () => undefined,
      (error: unknown) => error,
    )
    try {
      await childFinished.promise
      s.store.updateTask(parent.id, (task) => ({
        ...task,
        harness: {
          ...task.harness!,
          ...(dimension === 'approvalPolicy'
            ? { approvalPolicy: 'untrusted' as const }
            : { sandboxMode: 'read-only' as const }),
        },
      }))
      expect(resolveTaskAgent(s.store.task(childId), s.store.get().agents)).toMatchObject({
        approvalPolicy: dimension === 'approvalPolicy' ? 'untrusted' : 'on-request',
        sandboxMode: dimension === 'sandboxMode' ? 'read-only' : 'workspace-write',
      })
    } finally {
      parentRelease.resolve()
      expect(await stopped).toMatchObject({
        message: expect.stringContaining('Access was tightened'),
      })
    }
  },
)

it('retains unconfigured historical child metadata while refusing execution with unknown authority', async () => {
  const s = await setup()
  const parent = {
    id: 'historical-unconfigured-parent',
    title: 'Historical parent',
    repositoryId: 'repo',
    agentId: '',
    status: 'review',
    createdAt: new Date().toISOString(),
    draft: '',
    files: [],
    example: false,
    messages: [{ id: 'historical-user', role: 'user', text: 'Fixture history' }],
  } satisfies Task
  const child = {
    ...parent,
    id: 'historical-unconfigured-child',
    delegation: {
      parentTaskId: parent.id,
      parentRunId: 'historical-run',
      key: 'history',
      completion: 'read' as const,
    },
  }
  s.store.update((workspace) => ({ ...workspace, tasks: [parent, child] }))
  s.store.patch({
    collection: 'tasks',
    id: parent.id,
    changes: { archived: { before: undefined, after: true } },
  })
  expect(s.store.task(child.id).archived).toBe(true)
  s.store.patch({
    collection: 'tasks',
    id: parent.id,
    changes: { archived: { before: true, after: false } },
  })
  expect(s.store.task(child.id).archived).toBe(false)
  s.store.updateTask(child.id, (task) => ({ ...task, title: 'Retained result' }))
  const get = vi.spyOn(s.agents, 'get')
  await expect(s.tasks.start(child.id)).rejects.toThrow('cannot exceed')
  expect(get).not.toHaveBeenCalled()
  expect(s.store.task(child.id).title).toBe('Retained result')
})

it('revokes pending approvals and stops both an active parent and child when their inherited access tightens', async () => {
  const s = await setup()
  const ready = barrier()
  const runs: AgentRun[] = []
  let parentId = '',
    childId = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (taskId(run) === parentId) {
        childId = s.tasks.subagentSpawn({
          taskId: parentId,
          key: 'live-policy',
          name: 'Child',
          prompt: 'Fixture',
          provider: 'claude',
        }).id
      }
      const pending = run.approve('Apply file changes', '{}')
      if (runs.length === 2) ready.resolve()
      expect(await pending).toBe('deny')
      run.signal.throwIfAborted()
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Fixture',
    harness: defaultTaskHarness('codex'),
  })
  parentId = parent.id
  const running = await s.tasks.start(parentId)
  const stopped = running.done.then(
    () => undefined,
    (error: unknown) => error,
  )
  await ready.promise
  expect(s.approvals.list()).toHaveLength(2)
  s.store.updateTask(parentId, (task) => ({
    ...task,
    harness: { ...task.harness!, permission: 'ask' },
  }))
  expect(runs.every((run) => run.signal.aborted)).toBe(true)
  expect(s.approvals.list()).toHaveLength(0)
  expect(resolveTaskAgent(s.store.taskSummary(childId), s.store.get().agents)?.permission).toBe(
    'ask',
  )
  expect(await stopped).toMatchObject({ message: expect.stringContaining('Access was tightened') })
})

it('migrates legacy child notifications to the inbox without reordering user prompts', async () => {
  const s = await setup()
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    status: 'review',
    queuePaused: true,
    draft: 'Keep my draft',
    queue: [
      { id: 'first', role: 'user', text: 'First', createdAt: '' },
      {
        id: 'legacy-result',
        role: 'user',
        text: 'Saved child answer',
        subagentResultId: 'old-child',
        createdAt: '',
      },
      { id: 'last', role: 'user', text: 'Last', createdAt: '' },
    ],
  }))
  await s.tasks.runScheduled()
  await s.tasks.runScheduled()
  expect(s.store.task(parent.id).queue?.map((message) => message.id)).toEqual(['first', 'last'])
  expect(s.store.task(parent.id).subagentInbox?.map((message) => message.id)).toEqual([
    'legacy-result',
  ])
  expect(s.store.task(parent.id).draft).toBe('Keep my draft')
  expect(s.store.task(parent.id).queuePaused).toBe(true)
  expect(s.store.task(parent.id).messages.some((message) => message.subagentResultId)).toBe(false)
})

it('follows up in the same child conversation without duplicate work or stale completion receipts', async () => {
  const s = await setup()
  let childTurns = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        childTurns++
        run.onText(`Answer ${childTurns}`)
        return
      }
      const parentId = taskId(run)
      const child = s.tasks.subagentSpawn({
        taskId: parentId,
        key: 'review',
        name: 'Review',
        prompt: 'First review',
        provider: 'claude',
      })
      expect((await s.tasks.subagentWait(parentId, child.id)).result).toBe('Answer 1')
      await s.tasks.subagentSend(parentId, child.id, 'follow-up', 'Review the fix')
      await s.tasks.subagentSend(parentId, child.id, 'follow-up', 'Review the fix')
      await expect(
        s.tasks.subagentSend(parentId, child.id, 'follow-up', 'Changed prompt'),
      ).rejects.toThrow('different text')
      expect((await s.tasks.subagentWait(parentId, child.id)).result).toBe('Answer 2')
      expect(
        s.store
          .task(child.id)
          .messages.filter((message) => message.role === 'user')
          .map((message) => message.text),
      ).toEqual(['First review', 'Review the fix'])
      expect(s.store.task(parentId).queue ?? []).toEqual([])
      expect(s.store.task(parentId).subagentInbox ?? []).toEqual([])
      run.onText('Both reviews handled')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  expect(childTurns).toBe(2)
})
