import { runtimeIntegration, waitForRuntime as waitForTask } from '../../testing/integration'
import { randomUUID } from 'node:crypto'
import {
  PLAN_MODE_INSTRUCTION,
  agentTurnSettings,
  decode,
  planAwaitingApproval,
  questionPromptSchema,
  resolveTaskAgent,
} from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { runClientEffect } from '@dovo/client-runtime'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import type { AgentAdapter, AgentRun } from '../execution/types'
import { TaskQueue } from './task-queue'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'test-owner-token-with-at-least-32-characters'
async function start() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => ({
    ...f.workspace,
    agents: f.workspace.agents.map((agent) => ({ ...agent, permission: 'full-access' as const })),
  }))
  return runtime
}
const setup = async () => (await start()).services

it('runs only the plan turn read-only, rejects steering it and restores access for the next prompt', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  let releasePlan = () => {}
  const plan = new Promise<void>((resolve) => {
    releasePlan = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (runs.length === 2) await plan
      run.onText(runs.length === 2 ? '1. Change the file' : 'Done')
    },
  })
  const task = s.tasks.create({
    title: 'Plan',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Explore',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const send = (id: string, text: string, plan = false) =>
    runClientEffect(
      s.tasks.sendEffect(task.id, id, text, [], false, true, undefined, undefined, plan),
    )
  await send('plan', 'Add login', true)
  await waitForTask(() => expect(runs).toHaveLength(2))
  const runId = s.store.taskSummary(task.id).activeRunId!
  await expect(
    runClientEffect(s.tasks.steerEffect(task.id, 'steer', 'Also edit', [], runId)),
  ).rejects.toThrow('planning read-only')
  releasePlan()
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  expect(runs[0].agent.permission).toBe('full-access')
  expect(runs[1].agent).toMatchObject({
    permission: 'read-only',
    approvalPolicy: undefined,
    sandboxMode: undefined,
  })
  expect(runs[1].prompt).toContain(PLAN_MODE_INSTRUCTION)
  // The thread keeps its saved policy; only the plan turn was narrowed.
  expect(s.store.task(task.id).messages.find((message) => message.id === 'plan')?.plan).toBe(true)
  expect(s.store.task(task.id).messages.some((message) => message.id === 'steer')).toBe(false)
  await send('implement', 'The plan looks good. Implement it now.')
  await waitForTask(() => expect(runs).toHaveLength(3))
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  expect(runs[2].agent.permission).toBe('full-access')
  expect(runs[2].prompt).not.toContain(PLAN_MODE_INSTRUCTION)
})

it('keeps a failed plan turn read-only when it is continued without a new prompt', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      if (runs.length === 1) throw new Error('Provider crashed')
      run.onText('1. Plan')
    },
  })
  const task = s.tasks.create({
    title: 'Retry',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  await runClientEffect(
    s.tasks.sendEffect(task.id, 'plan', 'Plan it', [], false, true, undefined, undefined, true),
  )
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('failed'))
  // The failed worker unregisters just after its status is saved.
  await (
    await waitForTask(() => s.tasks.start(task.id))
  ).done
  expect(runs.map((run) => run.agent.permission)).toEqual(['read-only', 'read-only'])
})

it('rejects plan mode for harnesses without read-only access, reviews and queued steering', async () => {
  const s = await setup()
  let release = () => {}
  const running = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      await running
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Plan',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const execution = await s.tasks.start(task.id)
  try {
    await expect(
      runClientEffect(
        s.tasks.sendEffect(
          task.id,
          'review',
          'Review',
          [],
          true,
          false,
          undefined,
          undefined,
          true,
        ),
      ),
    ).rejects.toThrow('without plan mode')
    await runClientEffect(
      s.tasks.sendEffect(
        task.id,
        'queued',
        'Plan next',
        [],
        false,
        false,
        undefined,
        undefined,
        true,
      ),
    )
    await expect(
      runClientEffect(
        s.tasks.steerQueuedEffect(task.id, 'queued', s.store.taskSummary(task.id).activeRunId!),
      ),
    ).rejects.toThrow('own read-only turn')
    expect(
      s.store.taskSummary(task.id).queue?.map((message) => [message.id, message.plan]),
    ).toEqual([['queued', true]])
  } finally {
    release()
    await execution.done
  }
  const hermes = s.tasks.create({
    title: 'Hermes',
    repositoryId: 'repo',
    agentId: '',
    objective: '',
  })
  s.store.patch({
    collection: 'tasks',
    id: hermes.id,
    changes: {
      harness: {
        before: hermes.harness,
        after: {
          provider: 'hermes',
          model: '',
          reasoning: '',
          permission: 'full-access',
          instructions: '',
          endpoint: '',
        },
      },
    },
  })
  await expect(
    runClientEffect(
      s.tasks.sendEffect(hermes.id, 'plan', 'Plan', [], false, true, undefined, undefined, true),
    ),
  ).rejects.toThrow('no read-only mode')
  expect(s.store.taskSummary(hermes.id).queue ?? []).toEqual([])
})

it('persists the plan flag through receipts, editing, duplication, restore and restart', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      agents: [
        {
          id: 'agent',
          name: 'Test',
          provider: 'codex',
          model: '',
          instructions: '',
          permission: 'full-access',
          endpoint: '',
        },
      ],
      tasks: [
        {
          id: 'task',
          title: 'Task',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'review',
          execution: 'main',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Plan this',
          draftPlan: true,
          example: false,
          queuePaused: true,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    queue.add('task', 'normal', 'Plan this')
    // A normal send leaves the toggle for the next draft; only a plan send consumes it.
    expect(store.taskSummary('task').draftPlan).toBe(true)
    queue.add('task', 'plan', 'Plan this', [], undefined, false, false, undefined, { plan: true })
    expect(store.taskSummary('task').draftPlan).toBeUndefined()
    expect(() => queue.add('task', 'plan', 'Plan this')).toThrow('different text')
    expect(
      queue.add('task', 'plan', 'Plan this', [], undefined, false, false, undefined, {
        plan: true,
      }),
    ).toBe(false)
    expect(() =>
      queue.edit(
        'task',
        'normal',
        'Edited',
        'Plan this',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).toThrow('changed')
    expect(() =>
      queue.edit(
        'task',
        'normal',
        'Edited',
        'Plan this',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        true,
      ),
    ).toThrow('changed')
    queue.edit(
      'task',
      'normal',
      'Edited',
      'Plan this',
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      false,
    )
    queue.edit('task', 'plan', 'Plan edited', 'Plan this')
    queue.duplicate('task', 'plan', 'copy')
    const restarted = new TaskQueue(new WorkspaceStore(db))
    expect(store.taskSummary('task').queue?.map((message) => [message.id, message.plan])).toEqual([
      ['normal', true],
      ['plan', true],
      ['copy', true],
    ])
    restarted.edit(
      'task',
      'copy',
      'Copy',
      'Plan edited',
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      true,
    )
    expect(new WorkspaceStore(db).taskSummary('task').queue?.at(-1)?.plan).toBeUndefined()
    const reopened = new WorkspaceStore(db)
    const reopenedQueue = new TaskQueue(reopened)
    reopened.updateTask('task', (task) => ({ ...task, draft: 'Unrelated draft', draftPlan: true }))
    expect(() => reopenedQueue.change('task', 'restore', 'normal')).not.toThrow()
    expect(reopened.taskSummary('task').draftPlan).toBe(true)
    expect(() => reopenedQueue.change('task', 'restore', 'copy')).toThrow('different plan mode')
    reopened.updateTask('task', (task) => ({ ...task, draft: '' }))
    reopenedQueue.change('task', 'restore', 'copy')
    expect(reopened.taskSummary('task')).toMatchObject({ draft: 'Copy', draftPlan: undefined })
  } finally {
    db.close()
  }
})

it('accepts plan messages over HTTP and rejects plan steering and stale queued plan edits', async () => {
  const runtime = await start()
  const s = runtime.services
  const runs: AgentRun[] = []
  let release = () => {}
  const running = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      await running
      run.onText('1. Plan')
    },
  })
  const post = (path: string, body: object) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const task = s.tasks.create({
    title: 'HTTP',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  try {
    expect(
      (
        await post('/api/tasks/message', {
          id: task.id,
          messageId: 'plan',
          text: 'Plan',
          plan: true,
        })
      ).status,
    ).toBe(200)
    await waitForTask(() => expect(runs).toHaveLength(1))
    expect(runs[0].agent.permission).toBe('read-only')
    const runId = s.store.taskSummary(task.id).activeRunId
    const steer = await post('/api/tasks/steer', {
      id: task.id,
      messageId: 'steer',
      text: 'Now',
      runId,
      plan: true,
    })
    expect(steer.status).toBe(409)
    expect(await steer.text()).toContain('Queue this message to plan')
    expect(
      (
        await post('/api/tasks/message', {
          id: task.id,
          messageId: 'next',
          text: 'Next',
          plan: true,
        })
      ).status,
    ).toBe(200)
    const stale = await post('/api/tasks/queue', {
      id: task.id,
      action: 'edit',
      messageId: 'next',
      text: 'Next',
      expectedText: 'Next',
      plan: false,
      expectedPlan: false,
    })
    expect(stale.status).toBe(409)
    expect(
      (
        await post('/api/tasks/queue', {
          id: task.id,
          action: 'edit',
          messageId: 'next',
          text: 'Next',
          expectedText: 'Next',
          plan: false,
          expectedPlan: true,
        })
      ).status,
    ).toBe(200)
    expect(s.store.taskSummary(task.id).queue?.[0]?.plan).toBeUndefined()
  } finally {
    release()
  }
  await waitForTask(() => expect(runs).toHaveLength(2))
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  expect(runs[1].agent.permission).toBe('full-access')
})

it('narrows per-message model settings and fresh sessions only for the plan turn', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession(`session-${runs.length}`)
      run.onText(runs.length === 2 ? '1. Plan' : 'Done')
    },
  })
  const task = s.tasks.create({
    title: 'Models',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Start',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const agent = resolveTaskAgent(s.store.task(task.id), s.store.get().agents)!
  // A full per-message harness cannot widen the plan turn, even when it asks for full access.
  const settings = agentTurnSettings(
    { ...agent, model: 'large-model', reasoning: 'high', permission: 'full-access' },
    true,
  )
  await runClientEffect(
    s.tasks.sendEffect(
      task.id,
      'plan',
      'Plan with a larger model',
      [],
      false,
      true,
      settings,
      undefined,
      true,
    ),
  )
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  await runClientEffect(s.tasks.sendEffect(task.id, 'go', 'Implement it', [], false, true))
  await waitForTask(() => expect(runs).toHaveLength(3))
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  expect(runs.map((run) => [run.agent.permission, run.agent.model])).toEqual([
    ['full-access', ''],
    ['read-only', 'large-model'],
    ['full-access', 'large-model'],
  ])
  expect(runs[1].agent.approvalPolicy).toBeUndefined()
  expect(runs[1].agent.sandboxMode).toBeUndefined()
  // Provider sessions carry their access mode, so neither side resumes the other's session.
  expect(runs.map((run) => run.sessionId)).toEqual([undefined, undefined, undefined])
  expect(resolveTaskAgent(s.store.task(task.id), s.store.get().agents)?.permission).toBe(
    'full-access',
  )
})

it('repeats a plan turn read-only when it is tried again', async () => {
  const s = await setup()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onText('1. Plan')
    },
  })
  const task = s.tasks.create({
    title: 'Again',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  await runClientEffect(
    s.tasks.sendEffect(
      task.id,
      'plan',
      'Plan the change',
      [],
      false,
      true,
      undefined,
      undefined,
      true,
    ),
  )
  await waitForTask(() => {
    expect(s.store.taskSummary(task.id).status).toBe('review')
    expect(s.store.taskSummary(task.id).activeRunId).toBeUndefined()
  })
  const turnId = s.store.task(task.id).turns!.at(-1)!.id
  await runClientEffect(s.tasks.retryTurnEffect(task.id, turnId))
  await waitForTask(() => expect(runs).toHaveLength(2))
  await waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  expect(runs.map((run) => run.agent.permission)).toEqual(['read-only', 'read-only'])
  expect(s.store.task(task.id).messages.filter((message) => message.plan)).toHaveLength(2)
})

it('keeps delegated children within the read-only plan turn', async () => {
  const s = await setup()
  const results: Record<string, unknown> = {}
  let parentId = ''
  let writerId = ''
  let parentTurns = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.taskId !== parentId) {
        run.onText('Child done')
        return
      }
      parentTurns++
      if (parentTurns === 1) {
        writerId = s.tasks.subagentSpawn({
          taskId: parentId,
          key: 'writer',
          name: 'Writer',
          prompt: 'Write',
          provider: 'codex',
        }).id
        await s.tasks.subagentWait(parentId, writerId)
      } else {
        const planner = s.tasks.subagentSpawn({
          taskId: parentId,
          key: 'planner',
          name: 'Planner',
          prompt: 'Explore',
          provider: 'codex',
          permission: 'full-access',
        })
        results.planner = resolveTaskAgent(s.store.task(planner.id), s.store.get().agents)
        results.send = await s.tasks.subagentSend(parentId, writerId, 'again', 'Write more').then(
          () => 'sent',
          (error: unknown) => error,
        )
        await s.tasks.subagentWait(parentId, planner.id)
      }
      run.onText('Parent done')
    },
  })
  parentId = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  }).id
  await (
    await s.tasks.start(parentId)
  ).done
  expect(resolveTaskAgent(s.store.task(writerId), s.store.get().agents)?.permission).toBe(
    'full-access',
  )
  await runClientEffect(
    s.tasks.sendEffect(
      parentId,
      'plan',
      'Plan with help',
      [],
      false,
      true,
      undefined,
      undefined,
      true,
    ),
  )
  await waitForTask(() => expect(parentTurns).toBe(2))
  await waitForTask(() => expect(s.store.taskSummary(parentId).status).not.toBe('running'))
  expect(results.planner).toMatchObject({ permission: 'read-only' })
  expect(results.send).toMatchObject({
    status: 403,
    message: expect.stringContaining('planning read-only'),
  })
})

const designQuestion = decode(questionPromptSchema, {
  title: 'Design',
  questions: [{ id: 'design', header: 'Design', question: 'Attach the design' }],
})

it('continues an unapproved plan through question answers until a newer prompt restores access', async () => {
  const s = await setup()
  const file = { id: randomUUID(), name: 'design.txt', mime: 'text/plain', size: 3 }
  vi.spyOn(s.attachments, 'metadata').mockImplementation((_task, ids) => ids.map(() => file))
  vi.spyOn(s.attachments, 'materialize').mockResolvedValue({
    ...file,
    path: '/private/design.txt',
    data: 'YWJj',
  })
  const runs: AgentRun[] = []
  let ask: string | undefined
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      const taskId = run.taskId!
      if (ask)
        s.tasks.askQuestion(taskId, s.store.taskSummary(taskId).activeRunId!, designQuestion, ask)
      ask = undefined
      run.onText('1. Plan')
    },
  })
  const task = s.tasks.create({
    title: 'Answers',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const idle = () => waitForTask(() => expect(s.store.taskSummary(task.id).status).toBe('review'))
  const send = (id: string, text: string, plan = false) =>
    runClientEffect(
      s.tasks.sendEffect(task.id, id, text, [], false, true, undefined, undefined, plan),
    )
  const answer = (id: string) =>
    s.store.task(task.id).messages.find((message) => message.id === `answer:${id}`)

  ask = 'q-plan'
  await send('plan', 'Plan the design', true)
  await idle()
  // A file-only answer to the plan turn's form is still part of the unapproved plan.
  await s.questions.respondWithAttachments('q-plan', {}, { design: [file.id] })
  await waitForTask(() => expect(runs).toHaveLength(2))
  await idle()
  expect(answer('q-plan')).toMatchObject({ plan: true, attachments: [file] })
  expect(runs[1].agent.permission).toBe('read-only')
  expect(runs[1].prompt).toContain(PLAN_MODE_INSTRUCTION)
  expect(planAwaitingApproval(s.store.task(task.id))).toBe(true)
  // Replaying the response is acknowledged without another message or turn.
  await s.questions.respondWithAttachments('q-plan', {}, { design: [file.id] })
  expect(s.store.task(task.id).messages.filter((m) => m.id === 'answer:q-plan')).toHaveLength(1)
  expect(runs).toHaveLength(2)
  await send('implement', 'The plan looks good. Implement it now.')
  await waitForTask(() => expect(runs).toHaveLength(3))
  await idle()
  expect(runs[2].agent.permission).toBe('full-access')

  // A newer explicit prompt decides access; a late answer to the old plan form does not narrow it.
  ask = 'q-late'
  await send('plan-2', 'Plan again', true)
  await waitForTask(() => expect(runs).toHaveLength(4))
  await idle()
  await send('override', 'Skip the plan and do it')
  await waitForTask(() => expect(runs).toHaveLength(5))
  await idle()
  s.questions.respond('q-late', { design: ['Use the old layout'] })
  await waitForTask(() => expect(runs).toHaveLength(6))
  await idle()
  expect(answer('q-late')?.plan).toBeUndefined()
  expect(runs.slice(3).map((run) => run.agent.permission)).toEqual([
    'read-only',
    'full-access',
    'full-access',
  ])

  // Forms from normal turns never become plan input.
  ask = 'q-normal'
  await send('normal', 'Work normally')
  await waitForTask(() => expect(runs).toHaveLength(7))
  await idle()
  s.questions.respond('q-normal', { design: ['Plain'] })
  await waitForTask(() => expect(runs).toHaveLength(8))
  await idle()
  expect(answer('q-normal')?.plan).toBeUndefined()
  expect(runs[7].agent.permission).toBe('full-access')

  // An older normal form answered during a newer unapproved plan cannot end that plan.
  ask = 'q-older'
  await send('normal-2', 'Work normally again')
  await waitForTask(() => expect(runs).toHaveLength(9))
  await idle()
  await send('plan-3', 'Plan before changing more', true)
  await waitForTask(() => expect(runs).toHaveLength(10))
  await idle()
  s.questions.respond('q-older', { design: ['Older answer'] })
  await waitForTask(() => expect(runs).toHaveLength(11))
  await idle()
  expect(answer('q-older')?.plan).toBe(true)
  expect(runs.slice(8).map((run) => run.agent.permission)).toEqual([
    'full-access',
    'read-only',
    'read-only',
  ])
})

it('persists inherited plan answers with their receipt and files across restart', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const file = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'design.txt',
      mime: 'text/plain',
      size: 3,
    }
    store.update((workspace) => ({
      ...workspace,
      agents: [
        {
          id: 'agent',
          name: 'Test',
          provider: 'codex',
          model: '',
          instructions: '',
          permission: 'full-access',
          endpoint: '',
        },
      ],
      tasks: [
        {
          id: 'task',
          title: 'Task',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'review',
          execution: 'main',
          createdAt: '',
          messages: [{ id: 'plan', role: 'user', text: 'Plan', plan: true }],
          files: [],
          draft: 'Unsent',
          example: false,
          queuePaused: true,
        },
      ],
    }))
    const receipt = { id: 'question', fingerprint: 'answers', attachments: [file] }
    const add = (queue: TaskQueue, plan?: boolean) =>
      queue.add('task', 'answer:question', 'Design', [file], receipt, false, false, undefined, {
        plan,
      })
    expect(add(new TaskQueue(store), true)).toBe(true)
    const restarted = new WorkspaceStore(db)
    expect(restarted.taskSummary('task')).toMatchObject({
      draft: 'Unsent',
      queue: [{ id: 'answer:question', plan: true, attachments: [file] }],
    })
    expect(add(new TaskQueue(restarted), true)).toBe(false)
    expect(() => add(new TaskQueue(restarted))).toThrow('different')
  } finally {
    db.close()
  }
})
