import { expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botResultSchema, decode, type Automation, type AutomationData } from '@dovo/protocol'
import { waitForRuntime } from '../../testing/integration'
import { setupBotRuntime, type BotRunInput } from '../../testing/bots'
import { Jobs } from '../../jobs/jobs'

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

it('finishes each routine on its own turn while people and other routines use the Bot', async () => {
  const b = await bot()
  b.g.hold('USER-ONE')
  b.g.hold('USER-TWO')
  await b.send('USER-ONE first person message')
  await waitForRuntime(() => expect(b.g.started.has('USER-ONE')).toBe(true))
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [
      routine('routine-a', b.id, 'ROUTINE-A check releases'),
      routine('routine-b', b.id, 'ROUTINE-B FAIL check builds'),
    ],
  }))
  const a = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(step(b, a)?.messageId).toBeDefined())
  const later = b.s().jobs.start('routine-b')
  await waitForRuntime(() => expect(step(b, later)?.messageId).toBeDefined())
  await b.send('USER-TWO second person message')
  // Both routines wait in the queue behind the person's running turn.
  expect(b.s().jobs.detail(a).status).toBe('running')
  expect(b.s().store.taskSummary(b.id).queue).toHaveLength(3)

  b.g.release('USER-ONE')
  // Routine A succeeds on its own turn; routine B fails on its own turn. Neither waits for
  // or adopts the person's later turn, which is still running.
  await waitForRuntime(() => expect(b.s().jobs.detail(a).status).toBe('completed'))
  await waitForRuntime(() => expect(b.s().jobs.detail(later).status).toBe('failed'))
  expect(b.s().jobs.detail(later).error).toBe('Routine provider failed')
  const history = b.s().store.task(b.id)
  const own = history.messages.find((message) => message.id === step(b, a)?.messageId)
  expect(own?.text).toBe('ROUTINE-A check releases')
  expect(history.turns?.find((turn) => turn.id === own?.turnId)?.status).toBe('completed')

  // A person continues after the failed routine turn; that success never changes routine B.
  await b.send('Continue please')
  await waitForRuntime(() => expect(b.g.started.has('USER-TWO')).toBe(true))
  b.g.release('USER-TWO')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).status).toBe('review'))
  expect(b.s().jobs.detail(later).status).toBe('failed')
  // Retry sends routine B again under a new message id, once.
  b.s().jobs.retry(later)
  await waitForRuntime(() => expect(b.s().jobs.detail(later).status).toBe('failed'))
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((message) => message.text === 'ROUTINE-B FAIL check builds'),
  ).toHaveLength(2)
})

it('Stop withdraws only its own queued routine message and never stops a person’s turn', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  await b.send('PERSON working')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A queued')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() =>
    expect(
      b
        .s()
        .store.taskSummary(b.id)
        .queue?.map((item) => item.id),
    ).toEqual([step(b, run)?.messageId]),
  )
  await b.s().jobs.cancel(run)
  expect(b.s().store.taskSummary(b.id).queue ?? []).toHaveLength(0)
  // The person's turn is still running.
  expect(b.s().store.taskSummary(b.id).status).toBe('running')
  b.g.release('PERSON')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).status).toBe('review'))
  expect(
    b
      .s()
      .store.task(b.id)
      .turns?.every((turn) => turn.status === 'completed'),
  ).toBe(true)
})

it('Stop cancels the routine’s own running turn', async () => {
  const b = await bot()
  b.g.hold('ROUTINE-A')
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A long')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.g.started.has('ROUTINE-A')).toBe(true))
  await b.s().jobs.cancel(run)
  await waitForRuntime(() => expect(b.s().store.task(b.id).turns?.at(-1)?.status).toBe('cancelled'))
  expect(b.s().jobs.detail(run).status).toBe('cancelled')
})

it('pausing the Bot withdraws a held routine message and fails the step', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  await b.send('PERSON working')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A held')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).queue).toHaveLength(1))
  await b.f.request('/api/bots/lifecycle', { id: b.id, action: 'pause' })
  await waitForRuntime(() => expect(b.s().jobs.detail(run).status).toBe('failed'))
  expect(b.s().store.taskSummary(b.id).queue ?? []).toHaveLength(0)
  // The person's current turn may finish while paused.
  b.g.release('PERSON')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).status).toBe('review'))
})

it('adopts an earlier attempt after a restart instead of sending the routine twice', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  await b.send('PERSON working')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A after restart')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).queue).toHaveLength(1))
  const first = step(b, run)?.messageId
  // The runtime process ends with the routine message delivered but its turn not started:
  // no shutdown cleanup runs, as after a crash or a lost acknowledgement.
  vi.spyOn(
    Jobs.prototype as unknown as { stopTask: () => Promise<void> },
    'stopTask',
  ).mockResolvedValue()
  await b.f.restart()
  vi.mocked(Jobs.prototype as unknown as { stopTask: () => Promise<void> }).stopTask.mockRestore()
  const g = gates()
  b.f.runtime.run.mockImplementation((input) => g.run(input))
  expect(b.s().jobs.detail(run).status).toBe('failed')
  expect(
    b
      .s()
      .store.taskSummary(b.id)
      .queue?.map((item) => item.id),
  ).toEqual([first])
  // The person resumes the held queue; Retry adopts the same message.
  await b.f.request('/api/tasks/queue', { id: b.id, action: 'resume' })
  b.s().jobs.retry(run)
  await waitForRuntime(() => expect(b.s().jobs.detail(run).status).toBe('completed'))
  expect(step(b, run)?.messageId).toBe(first)
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((message) => message.text === 'ROUTINE-A after restart'),
  ).toHaveLength(1)
})

it('withdraws its queued routine message on a clean shutdown; Retry sends it once', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  await b.send('PERSON working')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A clean shutdown')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).queue).toHaveLength(1))
  await b.f.restart()
  b.f.runtime.run.mockImplementation((input) => gates().run(input))
  expect(b.s().jobs.detail(run)).toMatchObject({ status: 'failed', interrupted: true })
  expect(b.s().store.taskSummary(b.id).queue ?? []).toHaveLength(0)
  await b.f.request('/api/tasks/queue', { id: b.id, action: 'resume' })
  b.s().jobs.retry(run)
  await waitForRuntime(() => expect(b.s().jobs.detail(run).status).toBe('completed'))
  expect(
    b
      .s()
      .store.task(b.id)
      .messages.filter((message) => message.text === 'ROUTINE-A clean shutdown'),
  ).toHaveLength(1)
})

it('withdraws its message when a person paused the Bot queue, leaving other queued input', async () => {
  const b = await bot()
  b.g.hold('PERSON')
  await b.send('PERSON working')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A while paused')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).queue).toHaveLength(1))
  const later = randomUUID()
  await b.f.request('/api/tasks/message', { id: b.id, messageId: later, text: 'Person later' })
  // The person pauses the queue (not the Bot), and the running turn ends.
  await b.f.request('/api/tasks/queue', { id: b.id, action: 'pause' })
  expect(b.s().store.taskSummary(b.id).queuePaused).toBe(true)
  b.g.release('PERSON')
  await waitForRuntime(() => expect(b.s().jobs.detail(run).status).toBe('failed'))
  expect(
    b
      .s()
      .store.taskSummary(b.id)
      .queue?.map((item) => item.id),
  ).toEqual([later])
  // Resume alone runs only the person's message.
  await b.f.request('/api/tasks/queue', { id: b.id, action: 'resume' })
  await waitForRuntime(() => expect(b.s().store.taskSummary(b.id).status).toBe('review'))
  const texts = () =>
    b
      .s()
      .store.task(b.id)
      .messages.map((message) => message.text)
  expect(texts()).not.toContain('ROUTINE-A while paused')
  // Retry sends the routine once.
  b.s().jobs.retry(run)
  await waitForRuntime(() => expect(b.s().jobs.detail(run).status).toBe('completed'))
  expect(texts().filter((text) => text === 'ROUTINE-A while paused')).toHaveLength(1)
})

it('lets the next routine run start while unrelated Bot work continues', async () => {
  const b = await bot()
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A daily')],
  }))
  const first = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.s().jobs.detail(first).status).toBe('completed'))
  b.g.hold('PERSON')
  await b.send('PERSON long task')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  // The finished run no longer owns the Bot thread.
  const second = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(step(b, second)?.messageId).toBeDefined())
  expect(b.s().jobs.ownsTask(b.id)).toBe(false)
  b.g.release('PERSON')
  await waitForRuntime(() => expect(b.s().jobs.detail(second).status).toBe('completed'))
})

it('leaves an interrupted person turn to normal restart recovery', async () => {
  const b = await bot()
  b.s().store.update((workspace) => ({
    ...workspace,
    automations: [routine('routine-a', b.id, 'ROUTINE-A earlier')],
  }))
  const run = b.s().jobs.start('routine-a')
  await waitForRuntime(() => expect(b.s().jobs.detail(run).status).toBe('completed'))
  b.g.hold('PERSON')
  await b.send('PERSON interrupted')
  await waitForRuntime(() => expect(b.g.started.has('PERSON')).toBe(true))
  await b.f.restart()
  expect(b.s().store.taskSummary(b.id).restartRecovery?.kind).toBe('turn')
  expect(b.s().jobs.ownsTask(b.id)).toBe(false)
})
