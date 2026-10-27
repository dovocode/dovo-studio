import { readFileSync, existsSync } from 'node:fs'
import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  defaultTaskHarness,
  questionPromptSchema,
  taskFamilyRunToken,
  taskFamilyWorking,
  taskIsWorking,
  subagentVisible,
  nativeAgentWorking,
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

it('keeps a finished Codex child idle and hidden after a sibling sends it a message', async () => {
  const { s, task, owner } = await setup('codex')
  s.store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
  owner.onSubagentEvent?.(
    'item/completed',
    { threadId: 'child', item: { type: 'agentMessage', text: 'Review complete' } },
    'native-session',
  )
  owner.onSubagentEvent?.(
    'turn/completed',
    { threadId: 'child', turn: { id: 'review-turn', status: 'completed' } },
    'native-session',
  )
  const finished = s.store.taskSummary(task.id).subagents
  expect(finished).toMatchObject([{ status: 'completed', result: 'Review complete' }])
  for (const method of ['item/started', 'item/completed'])
    owner.onSubagentEvent?.(
      method,
      {
        threadId: 'sibling',
        item: {
          type: 'subAgentActivity',
          agentThreadId: 'child',
          agentPath: '/root/reviewer',
          kind: 'interacted',
        },
      },
      'native-session',
    )
  const saved = s.store.taskSummary(task.id)
  expect(saved.subagents).toEqual(finished)
  expect(saved.subagents?.filter((agent) => subagentVisible(agent, true))).toEqual([])
  expect(saved.subagents?.some(nativeAgentWorking)).toBe(false)
  s.tasks.requireIdle(task.id)
})

it('keeps native approvals and questions usable after a reply while retiring parent callbacks', async () => {
  const { s, task, owner, interactions } = await setup()
  const signal = new AbortController().signal
  const prompt = decode(questionPromptSchema, {
    title: 'Child needs input',
    questions: [
      { id: 'direction', header: 'Direction', question: 'Which direction?', options: [] },
    ],
  })
  expect(await owner.approve('Retired', '')).toBe('deny')
  expect(await owner.ask(prompt, signal)).toBeNull()
  const approval = interactions.approve('Child command', 'pwd', signal)
  expect(s.approvals.list()).toMatchObject([{ taskId: task.id, title: 'Child command' }])
  s.approvals.respond(s.approvals.list()[0].id, true)
  expect(await approval).toBe('approve')
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
  expect(await cancelled).toBe('deny')
  expect(s.approvals.list()).toEqual([])
  owner.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
  expect(await interactions.approve('Closed', '', signal)).toBe('deny')
  expect(await interactions.ask(prompt, signal)).toBeNull()
})

it.each(['permission', 'session', 'approvalPolicy', 'sandboxMode'] as const)(
  'refuses a native interaction after its owning %s changes',
  async (changed) => {
    const { s, task, interactions } = await setup()
    s.store.updateTask(task.id, (current) => ({
      ...current,
      ...(changed === 'permission'
        ? { harness: { ...defaultTaskHarness('claude'), permission: 'read-only' as const } }
        : changed === 'approvalPolicy'
          ? { agentOverrides: { approvalPolicy: 'never' as const } }
          : changed === 'sandboxMode'
            ? { agentOverrides: { sandboxMode: 'read-only' as const } }
            : { sessionId: 'replacement-session' }),
    }))
    expect(await interactions.approve('Stale', '', new AbortController().signal)).toBe('deny')
    expect(s.approvals.list()).toEqual([])
  },
)

it('keeps checkout and task settings owned until native children stop, including while idle', async () => {
  const { s, task, owner, stop } = await setup()
  expect(s.store.task(task.id).status).toBe('review')
  expect(taskIsWorking(s.store.task(task.id))).toBe(true)
  expect(s.store.task(task.id).waitingForFeedback).toBeUndefined()
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
  expect(taskIsWorking(s.store.task(task.id))).toBe(false)
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
  expect(s.store.task(task.id).subagentInbox).toHaveLength(1)
  expect(s.store.task(task.id).subagentInbox?.[0].text).toContain('Child answer')
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

it('stops a native child that outlives its parent turn and expires its approval when access tightens', async () => {
  const { s, task, interactions, stop } = await setup()
  const pending = interactions.approve('Native child command', 'pwd', new AbortController().signal)
  expect(s.approvals.list()).toHaveLength(1)
  s.store.updateTask(task.id, (current) => ({
    ...current,
    harness: { ...current.harness!, permission: 'read-only' },
  }))
  await expect(pending).resolves.toBe('deny')
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  expect(s.store.taskSummary(task.id).subagents?.[0].status).toBe('stopped')
  expect(await interactions.approve('Stale callback', 'pwd', new AbortController().signal)).toBe(
    'deny',
  )
})

it('expires obsolete approvals on widening without stopping a native child or granting its old callback new authority', async () => {
  const { s, task, interactions, stop } = await setup()
  const signal = new AbortController().signal
  const pending = interactions.approve('Old policy command', 'pwd', signal)
  s.store.updateTask(task.id, (current) => ({
    ...current,
    harness: { ...current.harness!, permission: 'full-access' },
  }))
  await expect(pending).resolves.toBe('deny')
  expect(s.approvals.list()).toEqual([])
  expect(stop).not.toHaveBeenCalled()
  expect(s.store.taskSummary(task.id).subagents?.[0].status).toBe('working')
  expect(await interactions.approve('Stale callback', 'pwd', signal)).toBe('deny')
})

it.each(['stop', 'read-only'] as const)(
  'revokes an idle native-child grant synchronously on %s while shutdown is held',
  async (mode) => {
    const { s, task, owner, stop } = await setup()
    const file = owner.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
      ?.envValues?.DOVO_TASK_CREDENTIAL_FILE
    if (!file) throw new Error('Expected run credential file')
    const { token } = decode(
      Schema.Struct({ token: Schema.String }),
      JSON.parse(readFileSync(file, 'utf8')),
    )
    const grant = s.runCredentials.authenticate(token)
    expect(s.store.taskSummary(task.id).activeRunId).toBeUndefined()
    expect(s.store.taskSummary(task.id).subagents?.[0].status).toBe('working')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const shutdown = stop.getMockImplementation()!
    stop.mockImplementation(async (id) => {
      await gate
      await shutdown(id)
    })
    let stopping: Promise<void> | undefined
    try {
      if (mode === 'stop')
        stopping = s.tasks.stopAgents(task.id, taskFamilyRunToken(s.store.get().tasks, task.id))
      else
        s.store.updateTask(task.id, (current) => ({
          ...current,
          harness: { ...current.harness!, permission: 'read-only' },
        }))
      expect(() => s.runCredentials.authenticate(token)).toThrow('expired or revoked')
      expect(grant.signal.aborted).toBe(true)
      expect(existsSync(file)).toBe(false)
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
      expect(s.store.taskSummary(task.id).subagents?.[0].status).toBe('working')
    } finally {
      release()
      await stopping
      await vi.waitFor(() =>
        expect(s.store.taskSummary(task.id).subagents?.[0].status).toBe('stopped'),
      )
    }
  },
)

it('persists and deduplicates late root replies while rejecting stale sessions', async () => {
  const { s, task, owner, runs } = await setup()
  const message = { id: 'late-message', text: 'Cycle 1 has started' }
  owner.onSubagentEvent?.('dovo/session/message', message, 'native-session')
  owner.onSubagentEvent?.('dovo/session/message', message, 'native-session')
  expect(s.store.task(task.id).messages.filter((item) => item.text === message.text)).toHaveLength(
    1,
  )
  expect(s.store.task(task.id).messages.at(-1)?.text).toBe(message.text)
  expect(s.store.task(task.id).consumedMessageIds).toContain('native-message:late-message')
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs.at(-1)?.prompt).not.toContain(message.text)
  s.store.updateTask(task.id, (current) => ({ ...current, sessionId: 'new-session' }))
  owner.onSubagentEvent?.(
    'dovo/session/message',
    { id: 'stale', text: 'Stale output' },
    'native-session',
  )
  expect(s.store.task(task.id).messages.some((item) => item.text === 'Stale output')).toBe(false)
})

it('leaves background command notification delivery to Claude without queueing a duplicate prompt', async () => {
  const { s, task, owner, runs } = await setup()
  owner.onSubagentEvent?.(
    'system',
    {
      type: 'system',
      subtype: 'task_started',
      task_type: 'local_bash',
      task_id: 'monitor',
      is_backgrounded: true,
      description: 'Watch tests',
    },
    'native-session',
  )
  expect(s.store.task(task.id).subagents?.find((record) => record.id === 'monitor')).toMatchObject({
    kind: 'background',
    status: 'working',
  })
  owner.onSubagentEvent?.(
    'system',
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'monitor',
      status: 'completed',
      summary: 'Five cycles passed',
    },
    'native-session',
  )
  await s.tasks.runScheduled()
  expect(s.store.task(task.id).subagents?.find((record) => record.id === 'monitor')).toMatchObject({
    completion: 'read',
    result: 'Five cycles passed',
  })
  expect(s.store.task(task.id).subagentInbox ?? []).toEqual([])
  expect(runs).toHaveLength(1)
})
