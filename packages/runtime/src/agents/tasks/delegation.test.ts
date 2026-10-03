import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import { defaultTaskHarness } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../execution/types'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function taskId(run: AgentRun) {
  if (!run.taskId) throw new Error('Expected a task execution')
  return run.taskId
}
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
