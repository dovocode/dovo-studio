import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import { defaultTaskHarness } from '@dovo/protocol'
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
it('cancels children when their parent finishes and never escalates a read-only parent', async () => {
  const s = await setup()
  let childId = ''
  let childStarted = false
  let childPermission = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'claude') {
        childPermission = run.agent.permission
        childStarted = true
        await new Promise<void>((resolve) => {
          if (run.signal.aborted) resolve()
          else run.signal.addEventListener('abort', () => resolve(), { once: true })
        })
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
      await waitForRuntime(() => expect(childStarted).toBe(true))
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
  await (
    await s.tasks.start(parent.id)
  ).done
  await waitForRuntime(() => expect(s.store.task(childId).status).toBe('cancelled'))
  expect(s.store.task(parent.id).subagents?.[0]?.status).toBe('stopped')
  expect(childPermission).toBe('read-only')
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
      await waitForRuntime(() => expect(s.store.task(child.id).status).toBe('cancelled'))
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
  await waitForRuntime(() =>
    expect(s.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true),
  )
  expect(s.tasks.subagentList(parent.id)).toHaveLength(4)
})

it('drains retired attempt children before a queued turn starts, then drains cancellation', async () => {
  const s = await setup()
  const childStarted = barrier()
  const childAborted = barrier()
  const releaseChild = barrier()
  const secondStarted = barrier()
  let attempts = 0
  let childId = ''
  let cleaned = false
  let secondSawDrained = false
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
        secondSawDrained = cleaned && !s.tasks.subagentResult(taskId(run), childId).running
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
    await childAborted.promise
    expect(attempts).toBe(1)
    releaseChild.resolve()
    await secondStarted.promise
    expect(secondSawDrained).toBe(true)
    s.tasks.cancel(parent.id)
    await expect(running.done).rejects.toThrow('Cancelled by user')
    expect(s.store.task(parent.id).status).toBe('cancelled')
    expect(s.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true)
  } finally {
    releaseChild.resolve()
  }
})

it.each(['completed', 'failed', 'cancelled'] as const)(
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
      expect(failure).toBe(
        outcome === 'completed'
          ? undefined
          : outcome === 'cancelled'
            ? 'Cancelled by user'
            : 'Parent provider failed',
      )
      const task = s.store.task(parent.id)
      expect(task.status).toBe(outcome === 'completed' ? 'review' : outcome)
      expect(s.tasks.subagentResult(parent.id, childId).running).toBe(false)
      const after = task.turns?.at(-1)?.checkpoint?.after
      if (!after) throw new Error('Expected a completed checkpoint')
      const cwd = await s.checkouts.directory(parent.id)
      expect(await s.git.command(cwd, ['show', `${after}:hello.txt`])).toBe('child cleanup write\n')
      const files = outcome === 'completed' ? task.files : task.turns?.at(-1)?.checkpoint?.files
      expect(files?.map((file) => file.path)).toContain('hello.txt')
    } finally {
      finishParent.resolve()
      releaseChild.resolve()
    }
  },
)
