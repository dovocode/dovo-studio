import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  defaultTaskHarness,
  questionPromptSchema,
  taskFamilyRunToken,
  taskFamilyWorking,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'
import type { AgentAdapter, AgentRun } from './types'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(provider: 'claude' | 'codex' = 'claude') {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const runs: AgentRun[] = []
  let owner: AgentRun | undefined
  const stop = vi.fn<(id?: string) => Promise<void>>(async () => {
    owner?.onSubagentEvent?.(
      'system',
      { type: 'system', subtype: 'task_notification', task_id: 'child', status: 'stopped' },
      'native-session',
    )
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (owner) {
        run.onSession('native-session')
        run.onText('Result incorporated')
        return
      }
      owner = run
      run.onSession('native-session')
      run.onSubagentEvent?.(
        provider === 'codex' ? 'item/started' : 'system',
        {
          ...(provider === 'codex'
            ? { threadId: 'child', item: { type: 'commandExecution' } }
            : {}),
          type: 'system',
          subtype: 'task_started',
          task_type: 'local_agent',
          task_id: 'child',
        },
        'native-session',
      )
      run.onNativeSession?.({ stop }, 'native-session')
      run.onNativeTurnEnd?.()
      run.onText('Parent replied')
    },
  })
  const task = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Work',
    harness: { ...defaultTaskHarness(provider), permission: 'ask' },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  if (!owner?.nativeAgentInteractions) throw new Error('Expected native-agent interactions')
  return { s, task, owner, stop, runs, interactions: owner.nativeAgentInteractions }
}

it('keeps native approvals and questions usable after a reply while retiring parent callbacks', async () => {
  const { s, task, owner, interactions } = await setup()
  const signal = new AbortController().signal
  const prompt = decode(questionPromptSchema, {
    title: 'Child needs input',
    questions: [
      { id: 'direction', header: 'Direction', question: 'Which direction?', options: [] },
    ],
  })
  expect(await owner.approve('Retired', '')).toBe(false)
  expect(await owner.ask(prompt, signal)).toBeNull()
  const approval = interactions.approve('Child command', 'pwd', signal)
  expect(s.approvals.list()).toMatchObject([{ taskId: task.id, title: 'Child command' }])
  s.approvals.respond(s.approvals.list()[0].id, true)
  expect(await approval).toBe(true)
  const question = interactions.ask(prompt, signal)
  const questionId = s.questions.list()[0].id
  const answers = { direction: ['Continue'] }
  s.questions.respond(questionId, answers)
  expect(await question).toEqual(answers)
  // A repeated response uses the same durable receipt and never queues a new parent turn.
  s.questions.respond(questionId, answers)
  expect(s.store.task(task.id).activeRunId).toBeUndefined()
  expect(s.store.task(task.id).messages.at(-1)?.text).toBe('Parent replied')
  const controller = new AbortController()
  const cancelled = interactions.approve('Cancelled child request', '', controller.signal)
  controller.abort()
  expect(await cancelled).toBe(false)
  expect(s.approvals.list()).toEqual([])
  owner.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
  expect(await interactions.approve('Closed', '', signal)).toBe(false)
  expect(await interactions.ask(prompt, signal)).toBeNull()
})

it.each(['permission', 'session'] as const)(
  'refuses a native interaction after its owning %s changes',
  async (changed) => {
    const { s, task, interactions } = await setup()
    s.store.updateTask(task.id, (current) => ({
      ...current,
      ...(changed === 'permission'
        ? { harness: { ...defaultTaskHarness('claude'), permission: 'read-only' as const } }
        : { sessionId: 'replacement-session' }),
    }))
    expect(await interactions.approve('Stale', '', new AbortController().signal)).toBe(false)
    expect(s.approvals.list()).toEqual([])
  },
)

it('keeps checkout and task settings owned until native children stop, including while idle', async () => {
  const { s, task, owner, stop } = await setup()
  expect(s.store.task(task.id).status).toBe('review')
  expect(taskFamilyWorking(s.store.get().tasks, task.id)).toBe(true)
  expect(() => s.tasks.requireIdle(task.id)).toThrow('Stop')
  await expect(s.tasks.withCheckoutMutation(owner.cwd, async () => {})).rejects.toThrow(
    'running agent',
  )
  const token = taskFamilyRunToken(s.store.get().tasks, task.id)
  await s.tasks.stopAgents(task.id, token, 'child')
  expect(stop).toHaveBeenCalledWith('child')
  expect(s.store.task(task.id).subagents?.[0]).toMatchObject({
    status: 'stopped',
    completion: 'disposed',
  })
  expect(taskFamilyWorking(s.store.get().tasks, task.id)).toBe(false)
  expect(() => s.tasks.stopAgents(task.id, token)).toThrow('Agent state changed')
  s.tasks.requireIdle(task.id)
  await s.tasks.withCheckoutMutation(owner.cwd, async () => {})
})

it('queues a late native result once, honors a paused queue, and wakes the parent after resuming', async () => {
  const { s, task, owner } = await setup()
  s.store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
  const finish = () =>
    owner.onSubagentEvent?.(
      'system',
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'child',
        status: 'completed',
        summary: 'Child answer',
      },
      'native-session',
    )
  finish()
  finish()
  await s.tasks.runScheduled()
  await s.tasks.runScheduled()
  expect(s.store.task(task.id).subagents?.[0]).toMatchObject({
    result: 'Child answer',
    completion: 'queued',
  })
  expect(s.store.task(task.id).queue).toHaveLength(1)
  expect(s.store.task(task.id).queue?.[0].text).toContain('Child answer')
  expect(s.store.task(task.id).activeRunId).toBeUndefined()
  s.store.updateTask(task.id, (current) => ({ ...current, queuePaused: false }))
  await s.tasks.runScheduled()
  await vi.waitFor(() =>
    expect(s.store.task(task.id).messages.at(-1)?.text).toBe('Result incorporated'),
  )
  expect(s.store.task(task.id).queue ?? []).toHaveLength(0)
})

it.each(['claude', 'codex'] as const)(
  'keeps a %s task-tool session binding stable across real follow-up turns',
  async (provider) => {
    const { s, task, runs } = await setup(provider)
    const binding = (run: AgentRun) =>
      run.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')?.envValues
        ?.DOVO_TASK_RUN_ID
    const first = binding(runs[0])
    expect(first).toMatch(/^native-session:/)
    expect(() => s.tasks.subagentList(task.id, first)).not.toThrow()
    await (
      await s.tasks.start(task.id)
    ).done
    expect(binding(runs[1])).toBe(first)
    expect(runs[1].sessionId).toBe('native-session')
    runs[1].onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
    expect(() => s.tasks.subagentList(task.id, first)).toThrow('parent turn has ended')
  },
)

it('serializes simultaneous native stops without leaving the second child running', async () => {
  const { s, task, owner } = await setup()
  owner.onSubagentEvent?.(
    'system',
    { type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'second' },
    'native-session',
  )
  const stopped: string[] = []
  owner.onNativeSession?.(
    {
      stop: async (id) => {
        if (!id) throw new Error('Expected a targeted child stop')
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        stopped.push(id)
        owner.onSubagentEvent?.(
          'system',
          { type: 'system', subtype: 'task_notification', task_id: id, status: 'stopped' },
          'native-session',
        )
      },
    },
    'native-session',
  )
  const token = taskFamilyRunToken(s.store.get().tasks, task.id)
  await Promise.all([
    s.tasks.stopAgents(task.id, token, 'child'),
    s.tasks.stopAgents(task.id, token, 'second'),
  ])
  expect(stopped).toEqual(['child', 'second'])
  expect(taskFamilyWorking(s.store.get().tasks, task.id)).toBe(false)
})
