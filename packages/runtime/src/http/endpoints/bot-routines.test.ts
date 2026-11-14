import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { botResultSchema, decode, type Automation, type AutomationData } from '@dovo/protocol'
import { waitForRuntime } from '../../testing/integration'
import { setupBotRuntime, type BotRunInput } from '../../testing/bots'

function routine(id: string, botId: string, objective: string): Automation {
  const base: AutomationData = {
    kind: 'trigger',
    label: id,
    trigger: 'manual',
    schedule: '',
    timezone: 'UTC',
    objective,
    agentId: '',
    repositoryId: '',
  }
  return {
    id,
    name: id,
    nodes: [
      { id: 'trigger', type: 'automation', position: { x: 0, y: 0 }, data: base },
      {
        id: 'task',
        type: 'automation',
        position: { x: 100, y: 0 },
        // Dormant normal-step settings stay saved and are ignored for Bot steps.
        data: {
          ...base,
          kind: 'task',
          botId,
          linkedCheckouts: [
            { id: 'docs', repositoryId: 'other', access: 'read-only', execution: 'main' },
          ],
        },
      },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'task' }],
  }
}

/** Turns whose prompt contains a marker wait until the test releases that marker. */
function gates() {
  const open = new Map<string, () => void>()
  const waiting = new Map<string, Promise<void>>()
  const started = new Set<string>()
  return {
    hold(marker: string) {
      waiting.set(marker, new Promise<void>((resolve) => open.set(marker, resolve)))
    },
    release(marker: string) {
      open.get(marker)?.()
    },
    started,
    async run(input: BotRunInput) {
      input.onSession('provider-session')
      for (const [marker, gate] of waiting)
        if (input.prompt.includes(marker)) {
          started.add(marker)
          await Promise.race([
            gate,
            new Promise<void>((_, reject) => {
              const stop = () => reject(new Error('Stopped'))
              if (input.signal.aborted) stop()
              input.signal.addEventListener('abort', stop, { once: true })
            }),
          ])
        }
      // A failed turn's input is offered again with the next person's message.
      if (input.prompt.includes('FAIL') && !input.prompt.includes('USER-TWO'))
        throw new Error('Routine provider failed')
      input.onText(`Reply to ${input.prompt.slice(-40)}`)
    },
  }
}

async function bot() {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const g = gates()
  f.runtime.run.mockImplementation((input) => g.run(input))
  const send = (text: string) =>
    f.request('/api/tasks/message', { id: created.id, messageId: randomUUID(), text })
  return { f, id: created.id, g, send, s: () => f.runtime.services }
}

const step = (f: Awaited<ReturnType<typeof bot>>, run: string) =>
  f
    .s()
    .jobs.detail(run)
    .steps?.find((item) => item.nodeId === 'task')

async function configure(
  b: Awaited<ReturnType<typeof bot>>,
  objective = 'ROUTINE-A check releases',
) {
  b.s().store.update((w) => ({ ...w, automations: [routine('routine-a', b.id, objective)] }))
}
const terminal = async (b: Awaited<ReturnType<typeof bot>>, id: string, status = 'completed') =>
  waitForRuntime(() => expect(b.s().jobs.detail(id).status).toBe(status))

it('queues scheduled roots per computer while direct conversation stays available', async () => {
  const b = await bot()
  b.s().preferences.save({ maxConcurrentWorkers: 2 })
  b.g.hold('FIRST-WORK')
  b.s().store.update((w) => ({
    ...w,
    automations: [routine('first', b.id, 'FIRST-WORK'), routine('second', b.id, 'SECOND-WORK')],
  }))
  const first = b.s().jobs.start('first')
  await waitForRuntime(() => expect(b.g.started.has('FIRST-WORK')).toBe(true))
  const second = b.s().jobs.start('second')
  await waitForRuntime(() => {
    const workerId = b.s().jobs.detail(second).taskIds[0]
    expect(workerId).toBeTruthy()
    expect(b.s().store.taskSummary(workerId).activity).toContain('Waiting for capacity')
  })
  expect(b.f.inputs.filter((input) => input.prompt.includes('SECOND-WORK'))).toHaveLength(0)
  await b.send('Direct question while workers wait')
  await waitForRuntime(() => expect(b.s().store.task(b.id).status).toBe('review'))
  b.g.release('FIRST-WORK')
  await terminal(b, first)
  await terminal(b, second)
  expect(b.f.inputs.filter((input) => input.prompt.includes('SECOND-WORK'))).toHaveLength(1)
})

it('keeps identical successful findings in run history without repeating a notification', async () => {
  const b = await bot()
  await configure(b, 'Check one stable matter')
  b.f.runtime.run.mockImplementation(async (input) => input.onText('The release is unchanged.'))
  const first = b.s().jobs.start('routine-a')
  await terminal(b, first)
  const second = b.s().jobs.start('routine-a')
  await terminal(b, second)
  expect(b.s().jobs.list()).toHaveLength(2)
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((message) => message.source?.kind === 'automation'),
  ).toHaveLength(1)
  b.f.runtime.run.mockImplementation(async (input) => input.onText('A new release is available.'))
  const third = b.s().jobs.start('routine-a')
  await terminal(b, third)
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((message) => message.source?.kind === 'automation'),
  ).toHaveLength(2)
})

it('runs isolated Bot workers alongside the person and reports once without consuming drafts', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  b.g.hold('ROUTINE-A')
  await b.send('PERSON working')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  b.s().store.updateTask(b.id, (t) => ({ ...t, draft: 'Human draft' }))
  await configure(b)
  const request = randomUUID()
  const run = b.s().jobs.startManual('routine-a', request)
  expect(b.s().jobs.startManual('routine-a', request)).toBe(run)
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  const worker = step(b, run)?.taskId
  expect(worker).toBeTruthy()
  expect(worker).not.toBe(b.id)
  const input = b.f.inputs.find((i) => i.taskId === worker)!
  expect(input.agent.instructions).toContain('isolated worker')
  expect(input.sessionId).toBeUndefined()
  expect(input.linkedDirectories ?? []).toHaveLength(0)
  expect(b.s().store.taskSummary(worker!).bot).toBeUndefined()
  expect(b.s().store.taskSummary(b.id).queue ?? []).toHaveLength(0)
  b.g.release('ROUTINE-A')
  await terminal(b, run)
  const reports = b
    .s()
    .store.task(b.id)
    .messages.filter((m) => m.source?.kind === 'automation')
  expect(reports).toHaveLength(1)
  expect(reports[0].text).toContain('Status: completed')
  expect(reports[0].text).toContain(worker)
  expect(b.s().store.taskSummary(b.id)).toMatchObject({ status: 'running', draft: 'Human draft' })
  b.g.release('PERSON')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).status).toBe('review'))
})

it('Stop cancels only its worker, leaving the person and queued input intact', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  b.g.hold('ROUTINE-A')
  await b.send('PERSON working')
  await configure(b)
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  await b.send('Person later')
  await b.s().jobs.cancel(run)
  await terminal(b, run, 'cancelled')
  await waitForRuntime(() =>
    expect(b.s().store.taskSummary(step(b, run)!.taskId!).status).toBe('cancelled'),
  )
  expect(b.s().store.taskSummary(b.id).status).toBe('running')
  expect(
    b
      .s()
      .store.taskSummary(b.id)
      .queue?.map((m) => m.text),
  ).toEqual(['Person later'])
  b.g.release('PERSON')
})

it('a paused Bot rejects new jobs and keeps an already running worker separate', async () => {
  const b = await bot()
  b.g.hold('ROUTINE-A')
  await configure(b)
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  await b.f.request('/api/bots/lifecycle', { id: b.id, action: 'pause' })
  expect(b.s().jobs.detail(run).status).toBe('running')
  b.g.release('ROUTINE-A')
  await terminal(b, run)
  const next = b.s().jobs.start('routine-a')
  await terminal(b, next, 'failed')
  expect(b.s().jobs.detail(next).taskIds).toHaveLength(0)
})

it('failed workers can retry without invoking the Bot or duplicating reports', async () => {
  const b = await bot()
  await configure(b, 'ROUTINE-A FAIL')
  const run = b.s().jobs.start('routine-a')
  await terminal(b, run, 'failed')
  const worker = step(b, run)?.taskId
  await waitForRuntime(() => expect(() => b.s().jobs.retry(run)).not.toThrow())
  await terminal(b, run, 'failed')
  expect(step(b, run)?.taskId).toBe(worker)
  expect(b.f.inputs.every((i) => i.taskId !== b.id)).toBe(true)
  const reports = b
    .s()
    .store.task(b.id)
    .messages.filter((m) => m.source?.kind === 'automation')
  expect(reports).toHaveLength(2)
  expect(new Set(reports.map((m) => m.id)).size).toBe(2)
})

it('restores worker ownership on restart and leaves the person to normal recovery', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  b.g.hold('ROUTINE-A')
  await b.send('PERSON interrupted')
  await configure(b)
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  const worker = step(b, run)?.taskId
  await b.f.restart()
  b.f.runtime.run.mockImplementation((i) => gates().run(i))
  expect(b.s().jobs.detail(run)).toMatchObject({ status: 'failed', interrupted: true })
  expect(b.s().jobs.ownsTask(b.id)).toBe(false)
  expect(b.s().jobs.ownsTask(worker!)).toBe(true)
  expect(b.s().store.taskSummary(b.id).restartRecovery?.kind).toBe('turn')
  b.s().jobs.retry(run)
  await terminal(b, run)
  expect(step(b, run)?.taskId).toBe(worker)
})

it('stops a running worker when Bot access narrows', async () => {
  const b = await bot()
  b.g.hold('ROUTINE-A')
  await configure(b)
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  b.s().store.updateTask(b.id, (t) => ({
    ...t,
    harness: t.harness && { ...t.harness, permission: 'read-only' },
  }))
  await terminal(b, run, 'failed')
  await waitForRuntime(() =>
    expect(b.s().store.taskSummary(step(b, run)!.taskId!).status).toBe('cancelled'),
  )
  expect(b.s().jobs.detail(run).error).toContain('access changed')
})

it('persists the next schedule across downtime, catches up once and skips unchanged sources', async () => {
  const { createServer } = await import('node:http')
  const b = await bot()
  const server = createServer((_req, res) => res.end('Release 1'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No source address')
  try {
    const flow = routine('routine-a', b.id, 'Read the monitored release')
    flow.enabled = true
    flow.monitor = { url: `http://127.0.0.1:${address.port}/release` }
    flow.nodes[0].data = { ...flow.nodes[0].data, trigger: 'schedule', schedule: '* * * * *' }
    b.s().store.update((w) => ({ ...w, automations: [flow] }))
    const now = Date.now() + 60_000
    b.s().jobs.tick(now)
    const saved = b
      .s()
      .db.prepare('SELECT value FROM documents WHERE id=?')
      .pluck()
      .get('automation-next:routine-a')
    expect(typeof saved).toBe('string')
    await b.f.restart()
    b.f.runtime.run.mockImplementation((i) => gates().run(i))
    b.s().jobs.tick(now + 3600_000)
    await waitForRuntime(() => expect(b.s().jobs.list()[0]?.status).toBe('completed'))
    expect(b.s().jobs.list()).toHaveLength(1)
    expect(b.f.inputs).toHaveLength(1)
    b.s().jobs.tick(now + 3660_000)
    await waitForRuntime(() => expect(b.s().jobs.list()[0]?.outcome).toBe('unchanged'))
    expect(b.s().jobs.list()[0]?.status).toBe('completed')
    expect(b.f.inputs).toHaveLength(1)
    const cursor = b
      .s()
      .db.prepare('SELECT value FROM documents WHERE id=?')
      .pluck()
      .get('automation-next:routine-a')
    const request = randomUUID()
    const manual = b.s().jobs.startManual(flow.id, request)
    expect(b.s().jobs.startManual(flow.id, request)).toBe(manual)
    await terminal(b, manual)
    expect(b.f.inputs).toHaveLength(2)
    expect(
      b
        .s()
        .db.prepare('SELECT value FROM documents WHERE id=?')
        .pluck()
        .get('automation-next:routine-a'),
    ).toBe(cursor)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})

it('stops a budget-limited worker and retains its partial transcript and the Bot chat', async () => {
  const b = await bot()
  b.g.hold('ROUTINE-A')
  await configure(b)
  b.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((f) => ({ ...f, policy: { minutes: 1 } })),
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  const worker = step(b, run)!.taskId!
  b.s().store.updateTaskHistory(worker, (t) => ({
    ...t,
    messages: [
      ...t.messages,
      {
        id: randomUUID(),
        role: 'assistant',
        text: 'Partial work',
        createdAt: new Date().toISOString(),
      },
    ],
  }))
  b.s().jobs.enforceBudgets(Date.now() + 61_000)
  await terminal(b, run, 'failed')
  expect(b.s().jobs.detail(run).error).toContain('time budget')
  await waitForRuntime(() => expect(b.s().store.taskSummary(worker).status).toBe('cancelled'))
  expect(
    b
      .s()
      .store.task(worker)
      .messages.some((m) => m.text === 'Partial work'),
  ).toBe(true)
  expect(b.s().store.taskSummary(b.id).status).toBe('draft')
})

it('defers successful Bot reports through restart during quiet hours and delivers once afterward', async () => {
  const b = await bot()
  await configure(b)
  const now = Date.now(),
    hour = new Date(now).getUTCHours()
  const start = String(hour).padStart(2, '0') + ':00',
    end = String((hour + 1) % 24).padStart(2, '0') + ':00'
  b.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((f) => ({
      ...f,
      policy: { quietHours: { start, end, timezone: 'UTC' } },
    })),
  }))
  const run = b.s().jobs.start('routine-a')
  await terminal(b, run)
  await waitForRuntime(() => expect(b.s().jobs.detail(run).reportDeferred).toBe(true))
  expect(b.s().store.task(b.id).messages).toHaveLength(0)
  await b.f.restart()
  b.s().jobs.tick(now + 2 * 3600_000)
  b.s().jobs.tick(now + 2 * 3600_000)
  expect(b.s().jobs.detail(run).reportDeferred).toBe(false)
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((m) => m.source?.kind === 'automation'),
  ).toHaveLength(1)
})

it('recovers a legacy routine already queued in the Bot without converting or duplicating it', async () => {
  const { botStepMessageId } = await import('../../jobs/jobs')
  const b = await bot()
  b.g.hold('PERSON')
  await b.send('PERSON interrupted')
  await configure(b, 'LEGACY routine')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  const id = randomUUID(),
    messageId = botStepMessageId(id, 'task', 1),
    now = new Date().toISOString()
  await b.f.request('/api/tasks/message', { id: b.id, messageId, text: 'LEGACY routine' })
  const flow = b.s().store.get().automations[0]
  b.s()
    .db.prepare('INSERT INTO job_runs VALUES (?,?)')
    .run(
      id,
      JSON.stringify({
        id,
        automationId: flow.id,
        flow,
        status: 'running',
        taskIds: [b.id],
        completedNodes: ['trigger'],
        currentNodeId: 'task',
        createdAt: now,
        updatedAt: now,
        attempt: 1,
        steps: [
          { nodeId: 'trigger', label: 'Trigger', kind: 'trigger', status: 'completed', attempt: 1 },
          {
            nodeId: 'task',
            label: 'Routine',
            kind: 'task',
            status: 'running',
            attempt: 1,
            taskId: b.id,
            messageId,
          },
        ],
      }),
    )
  await b.f.restart()
  b.f.runtime.run.mockImplementation((i) => gates().run(i))
  expect(b.s().jobs.detail(id).status).toBe('failed')
  await b.f.request('/api/tasks/queue', { id: b.id, action: 'resume' })
  b.s().jobs.retry(id)
  await terminal(b, id)
  expect(step(b, id)?.taskId).toBe(b.id)
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((m) => m.text === 'LEGACY routine'),
  ).toHaveLength(1)
  expect(b.s().jobs.detail(id).taskIds).toEqual([b.id])
})

it('keeps an unconsumed due time after a temporary acceptance failure', async () => {
  const { vi } = await import('vite-plus/test')
  const b = await bot()
  await configure(b)
  b.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((flow) => ({
      ...flow,
      enabled: true,
      nodes: flow.nodes.map((node) =>
        node.data.kind === 'trigger'
          ? { ...node, data: { ...node.data, trigger: 'schedule' as const, schedule: '* * * * *' } }
          : node,
      ),
    })),
  }))
  const now = Date.now() + 60000
  b.s().jobs.tick(now)
  const cursor = b
    .s()
    .db.prepare('SELECT value FROM documents WHERE id=?')
    .pluck()
    .get('automation-next:routine-a')
  vi.spyOn(b.s().jobs, 'start').mockImplementationOnce(() => {
    throw new Error('Temporary storage failure')
  })
  b.s().jobs.tick(now + 60000)
  expect(b.s().jobs.list()).toHaveLength(0)
  expect(b.s().jobs.scheduleDiagnostics()[0]?.error).toContain('Temporary storage failure')
  expect(
    b
      .s()
      .db.prepare('SELECT value FROM documents WHERE id=?')
      .pluck()
      .get('automation-next:routine-a'),
  ).toBe(cursor)
  b.s().jobs.tick(now + 61000)
  await waitForRuntime(() => expect(b.s().jobs.list()[0]?.status).toBe('completed'))
  expect(b.s().jobs.list()).toHaveLength(1)
  expect(b.s().jobs.scheduleDiagnostics()).toHaveLength(0)
})

it.each(['tokens', 'costUsd'] as const)(
  'stops a worker at its reported %s budget',
  async (kind) => {
    const b = await bot()
    b.g.hold('ROUTINE-A')
    await configure(b)
    b.s().store.update((w) => ({
      ...w,
      automations: w.automations.map((flow) => ({ ...flow, policy: { [kind]: 1 } })),
    }))
    const run = b.s().jobs.start('routine-a')
    await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
    const worker = step(b, run)!.taskId!
    b.s().store.updateTaskHistory(worker, (t) => ({
      ...t,
      turns: t.turns?.map((turn) => ({ ...turn, tokens: 2, estimatedCostUsd: 2 })),
    }))
    b.s().jobs.enforceBudgets()
    await terminal(b, run, 'failed')
    expect(b.s().jobs.detail(run).error).toContain(
      kind === 'tokens' ? 'token budget' : 'estimated cost budget',
    )
    await waitForRuntime(() => expect(b.s().store.taskSummary(worker).status).toBe('cancelled'))
  },
)

it('groups identical findings across routines only with an explicit shared matter', async () => {
  const b = await bot()
  b.s().store.update((w) => ({
    ...w,
    automations: [
      { ...routine('one', b.id, 'Check release'), policy: { matter: 'release' } },
      { ...routine('two', b.id, 'Check release'), policy: { matter: 'release' } },
    ],
  }))
  b.f.runtime.run.mockImplementation(async (input) => input.onText('Release 1 is ready.'))
  await terminal(b, b.s().jobs.start('one'))
  await terminal(b, b.s().jobs.start('two'))
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((m) => m.source?.kind === 'automation'),
  ).toHaveLength(1)
  b.f.runtime.run.mockImplementation(async (input) => input.onText('Release 2 is ready.'))
  await terminal(b, b.s().jobs.start('two'))
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((m) => m.source?.kind === 'automation'),
  ).toHaveLength(2)
})

it('audits only a selected run, pages events and loads redacted output on request', async () => {
  const b = await bot()
  await configure(b)
  b.f.runtime.run.mockImplementation(async (input) => input.onText('Done'))
  const run = b.s().jobs.start('routine-a')
  await terminal(b, run)
  const worker = step(b, run)?.taskId
  if (!worker) throw Error('Missing worker')
  b.s().activity.add('tool', b.id, 'Private coordinator event', { output: 'PRIVATE-BOT' })
  b.s().activity.add('tool', 'foreign', 'Foreign event', { output: 'PRIVATE-OTHER' })
  for (let i = 0; i < 105; i++)
    b.s().activity.add('tool', worker, `Command ${i}`, {
      password: 'DO-NOT-EXPORT',
      exitCode: 0,
      output: 'done',
    })
  b.s()
    .db.prepare('UPDATE activity SET time=? WHERE scope=?')
    .run(b.s().jobs.detail(run).createdAt, worker)
  b.s().activity.add('tool', worker, 'Later unrelated work', { output: 'POST-RUN-PRIVATE' })
  const summary = await b.f.request('/api/jobs/audit', { id: run })
  expect(summary.status).toBe(200)
  const page = await summary.json()
  expect(page.threads.map((t: { id: string }) => t.id)).toEqual([worker])
  expect(page.events).toHaveLength(100)
  expect(page.nextOffset).toBe(100)
  expect(page.events.every((event: { payload?: string }) => event.payload === undefined)).toBe(true)
  const output = await (
    await b.f.request('/api/jobs/audit', { id: run, offset: 100, output: true })
  ).json()
  expect(output.events.length).toBeGreaterThan(0)
  expect(JSON.stringify(output)).toContain('exitCode')
  expect(JSON.stringify(output)).not.toMatch(
    /PRIVATE-BOT|PRIVATE-OTHER|DO-NOT-EXPORT|POST-RUN-PRIVATE/,
  )
  expect((await b.f.request('/api/jobs/audit', { id: 'missing' })).status).toBe(404)
  expect((await b.f.request('/api/jobs/audit', { id: run, offset: -1 })).status).toBe(400)
})

it('retries the saved source batch after failure instead of losing it to a newer version', async () => {
  let source = '{"version":1,"events":["first"]}'
  const server = createServer((_request, response) => response.end(source))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('No source address')
    const b = await bot()
    b.s().store.update((w) => ({
      ...w,
      automations: [
        {
          ...routine('batch', b.id, 'Process saved events'),
          monitor: { url: `http://127.0.0.1:${address.port}` },
        },
      ],
    }))
    b.f.runtime.run.mockRejectedValueOnce(new Error('Provider unavailable'))
    const run = b.s().jobs.start('batch')
    await terminal(b, run, 'failed')
    source = '{"version":2,"events":["second"]}'
    b.f.runtime.run.mockImplementation(async (input) => input.onText('Processed'))
    b.s().jobs.retry(run)
    await terminal(b, run)
    expect(b.f.inputs.at(-1)?.prompt).toContain('"first"')
    expect(b.f.inputs.at(-1)?.prompt).not.toContain('"second"')
    const newer = b.s().jobs.start('batch', 'schedule:next-batch')
    await terminal(b, newer)
    expect(b.f.inputs.at(-1)?.prompt).toContain('"second"')
    expect(b.f.inputs.at(-1)?.prompt).toContain('Previous successful source')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('cancels a queued scheduled worker without starting its provider', async () => {
  const b = await bot()
  b.s().preferences.save({ maxConcurrentWorkers: 2 })
  b.g.hold('FIRST-WORK')
  b.s().store.update((w) => ({
    ...w,
    automations: [routine('first', b.id, 'FIRST-WORK'), routine('second', b.id, 'SECOND-WORK')],
  }))
  const first = b.s().jobs.start('first')
  await waitForRuntime(() => expect(b.g.started.has('FIRST-WORK')).toBe(true))
  const second = b.s().jobs.start('second')
  await waitForRuntime(() => {
    const worker = step(b, second)?.taskId
    expect(worker && b.s().store.taskSummary(worker).activity).toContain('Waiting for capacity')
  })
  await b.s().jobs.cancel(second)
  b.g.release('FIRST-WORK')
  await terminal(b, first)
  expect(b.s().jobs.detail(second).status).toBe('cancelled')
  expect(b.f.inputs.some((input) => input.prompt.includes('SECOND-WORK'))).toBe(false)
})

it('reports recovery after a failed check even when the successful answer is unchanged', async () => {
  const b = await bot()
  await configure(b)
  b.f.runtime.run.mockImplementation(async (input) => input.onText('Service healthy'))
  await terminal(b, b.s().jobs.start('routine-a'))
  b.f.runtime.run.mockRejectedValueOnce(new Error('Connection failed'))
  await terminal(b, b.s().jobs.start('routine-a'), 'failed')
  b.f.runtime.run.mockImplementation(async (input) => input.onText('Service healthy'))
  await terminal(b, b.s().jobs.start('routine-a'))
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((message) => message.source?.kind === 'automation'),
  ).toHaveLength(3)
})
