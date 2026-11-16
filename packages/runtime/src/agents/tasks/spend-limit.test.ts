import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botResultSchema, decode } from '@dovo/protocol'
import { setupBotRuntime, botTestToken, type BotRunInput } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

type Fixture = Awaited<ReturnType<typeof setupBotRuntime>>
const model = 'spend-limit-test-model'

/** Reports Codex token usage for a model priced at $1 per million tokens. */
function charge(input: BotRunInput, tokens: number) {
  const usage = { totalTokens: tokens, inputTokens: tokens, outputTokens: 0, cachedInputTokens: 0 }
  input.onEvent?.('model/rerouted', { toModel: model })
  input.onEvent?.('thread/tokenUsage/updated', {
    threadId: 'provider-session',
    tokenUsage: { total: usage, last: usage },
  })
}

async function setup(limitUsd: number) {
  const f = await setupBotRuntime()
  const bot = decode(botResultSchema, await (await f.create()).response.json()).id
  f.runtime.services.store.usagePricing.setOverride(model, {
    input: 1,
    output: 1,
    cacheRead: 1,
    cacheWrite: 1,
  })
  const saved = await f.request('/api/runtime/preferences/save', {
    unattendedSpendLimitUsd: limitUsd,
  })
  expect(saved.status).toBe(200)
  return { f, bot }
}

const turns = (f: Fixture, id: string) => f.runtime.services.store.task(id).turns?.length ?? 0

async function ownerMessage(f: Fixture, id: string, text: string) {
  const messageId = randomUUID()
  const response = await f.request('/api/tasks/message', { id, messageId, text })
  expect(response.status).toBe(200)
  return messageId
}

/** Input that arrives without the owner, like a watch notification or a scheduled message. */
async function unattended(f: Fixture, id: string, text: string) {
  const messageId = randomUUID()
  await f.runtime.services.tasks.send(id, messageId, text, [], { kind: 'system', label: 'Watch' })
  return messageId
}

async function idleAfter(f: Fixture, id: string, count: number) {
  await waitForRuntime(() => {
    expect(turns(f, id)).toBe(count)
    expect(f.runtime.services.store.taskSummary(id).status).toBe('review')
  })
}

it('holds unattended Bot work at the limit until Continue, also across a restart', async () => {
  const { f, bot } = await setup(1)
  const script = () =>
    f.runtime.run.mockImplementation(async (input) => {
      input.onSession('provider-session')
      charge(input, 600_000)
      input.onText('Done')
    })
  script()
  expect(f.runtime.services.store.taskSummary(bot).spendPause).toBeUndefined()
  await ownerMessage(f, bot, 'Watch the release')
  await idleAfter(f, bot, 1)
  // $0.60 since the owner's message is below the $1 limit: unattended work still starts.
  await unattended(f, bot, 'The release page changed')
  await idleAfter(f, bot, 2)
  const held = await unattended(f, bot, 'The release page changed again')
  await waitForRuntime(() =>
    expect(f.runtime.services.store.taskSummary(bot).spendPause).toBeDefined(),
  )
  const pause = f.runtime.services.store.taskSummary(bot).spendPause!
  expect(pause.spentUsd).toBeCloseTo(1.2)
  expect(pause).toMatchObject({ unpricedTurns: 0, limitUsd: 1 })
  expect(f.runtime.services.store.taskSummary(bot).queue?.map((m) => m.id)).toEqual([held])
  expect(turns(f, bot)).toBe(2)

  await f.restart()
  script()
  const s = f.runtime.services
  await s.tasks.runScheduled()
  expect(s.store.taskSummary(bot).spendPause?.spentUsd).toBeCloseTo(1.2)
  expect(s.store.taskSummary(bot).queue?.map((m) => m.id)).toEqual([held])
  expect(turns(f, bot)).toBe(2)

  const agentContinue = await fetch(
    `http://127.0.0.1:${f.runtime.port}/api/tasks/spend-limit/continue`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botTestToken}`,
        'Content-Type': 'application/json',
        'x-dovo-agent-access': '1',
      },
      body: JSON.stringify({ id: bot }),
    },
  )
  expect(agentContinue.status).toBe(403)
  expect(s.store.taskSummary(bot).spendPause).toBeDefined()

  // A restart holds the queue too. Continue is consent for that held input.
  expect(s.store.taskSummary(bot).restartRecovery?.kind).toBe('queue')
  expect((await f.request('/api/tasks/spend-limit/continue', { id: bot })).status).toBe(200)
  await idleAfter(f, bot, 3)
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()
  expect(s.store.taskSummary(bot).queue ?? []).toEqual([])
})

it('resets on an owner message, holds after unpriced turns and releases when the limit is off', async () => {
  const { f, bot } = await setup(5)
  const s = f.runtime.services
  // No usage report: the turn has no price, so its cost is unknown.
  await ownerMessage(f, bot, 'Hello')
  await idleAfter(f, bot, 1)
  const held = await unattended(f, bot, 'Scheduled check')
  await waitForRuntime(() =>
    expect(s.store.taskSummary(bot).spendPause).toMatchObject({ spentUsd: 0, unpricedTurns: 1 }),
  )
  expect(turns(f, bot)).toBe(1)

  // The owner's message resets the counter: held work starts first, then the message.
  const reply = await ownerMessage(f, bot, 'Carry on')
  await idleAfter(f, bot, 3)
  const messages = s.store.task(bot).messages.map((message) => message.id)
  expect(messages.indexOf(held)).toBeLessThan(messages.indexOf(reply))
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()

  await unattended(f, bot, 'Another check')
  await waitForRuntime(() =>
    expect(s.store.taskSummary(bot).spendPause).toMatchObject({ unpricedTurns: 2 }),
  )
  // An agent cannot raise or remove its own limit.
  const agentSave = await fetch(`http://127.0.0.1:${f.runtime.port}/api/runtime/preferences/save`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botTestToken}`,
      'Content-Type': 'application/json',
      'x-dovo-agent-access': '1',
    },
    body: JSON.stringify({ unattendedSpendLimitUsd: null }),
  })
  expect(agentSave.status).toBe(403)
  expect(
    (await f.request('/api/runtime/preferences/save', { unattendedSpendLimitUsd: null })).status,
  ).toBe(200)
  await s.tasks.runScheduled()
  await idleAfter(f, bot, 4)
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()
})

it('counts child agents in the Bot family and holds the Bot until Continue', async () => {
  const { f, bot } = await setup(1)
  const s = f.runtime.services
  let child = ''
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession('provider-session')
    if (input.taskId === bot && !child) {
      child = s.tasks.subagentSpawn({
        taskId: bot,
        key: 'work',
        name: 'Worker',
        prompt: 'Do the longer work',
        provider: 'codex',
      }).id
      charge(input, 200_000)
      input.onText('Worker started.')
    } else if (input.taskId === child) {
      charge(input, 1_000_000)
      input.onText('Child result')
    } else {
      charge(input, 100_000)
      input.onText('Read the child result')
    }
  })
  await ownerMessage(f, bot, 'Do the longer work')
  await waitForRuntime(() => {
    expect(child).not.toBe('')
    expect(s.store.taskSummary(child).status).toBe('review')
    expect(s.store.taskSummary(bot).spendPause).toBeDefined()
  })
  expect(s.store.taskSummary(bot).spendPause?.spentUsd).toBeCloseTo(1.2)
  expect(turns(f, bot)).toBe(1)
  expect(s.store.taskSummary(child).spendPause).toBeUndefined()

  expect((await f.request('/api/tasks/spend-limit/continue', { id: child })).status).toBe(200)
  await idleAfter(f, bot, 2)
  expect(s.store.task(bot).messages.some((m) => m.text === 'Read the child result')).toBe(true)
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()
})

it('checks the limit before each turn that a running Bot takes from its queue', async () => {
  const { f, bot } = await setup(1)
  const s = f.runtime.services
  const arrived: string[] = []
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession('provider-session')
    charge(input, 600_000)
    // A watch notification arrives while each of the first turns runs.
    if (arrived.length < 3) arrived.push(await unattended(f, bot, `Change ${arrived.length + 1}`))
    input.onText('Done')
  })
  await ownerMessage(f, bot, 'Watch the release')
  await waitForRuntime(() => expect(s.store.taskSummary(bot).spendPause).toBeDefined())
  await idleAfter(f, bot, 2)
  expect(s.store.taskSummary(bot).spendPause?.spentUsd).toBeCloseTo(1.2)
  expect(s.store.taskSummary(bot).queue?.map((m) => m.id)).toEqual([arrived[1]])

  // Continue starts the held input. The notification that arrives during it follows below the
  // limit again.
  expect((await f.request('/api/tasks/spend-limit/continue', { id: bot })).status).toBe(200)
  await idleAfter(f, bot, 4)
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()
  expect(s.store.taskSummary(bot).queue ?? []).toEqual([])
})

it('starts an owner message that waits behind unattended work over the limit', async () => {
  const { f, bot } = await setup(1)
  const s = f.runtime.services
  let turn = 0
  let reply = ''
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession('provider-session')
    turn++
    if (turn === 1) {
      await unattended(f, bot, 'The release page changed')
      reply = await ownerMessage(f, bot, 'Also check the notes')
    }
    // The unattended turn starts after the owner's reset and reaches the limit alone.
    charge(input, turn === 2 ? 1_500_000 : 100_000)
    input.onText('Done')
  })
  await ownerMessage(f, bot, 'Watch the release')
  await idleAfter(f, bot, 3)
  expect(s.store.task(bot).messages.some((message) => message.id === reply)).toBe(true)
  expect(s.store.taskSummary(bot).queue ?? []).toEqual([])
})

/** A request with agent access, as an agent's Dovo tools make it. */
const agentRequest = (f: Fixture, path: string, input: unknown) =>
  fetch(`http://127.0.0.1:${f.runtime.port}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botTestToken}`,
      'Content-Type': 'application/json',
      'x-dovo-agent-access': '1',
    },
    body: JSON.stringify(input),
  })

it('runs Retry from the owner at the limit and holds Retry from an agent', async () => {
  const { f, bot } = await setup(1)
  const s = f.runtime.services
  f.runtime.run.mockImplementationOnce(async (input) => {
    input.onSession('provider-session')
    charge(input, 1_500_000)
    throw new Error('Provider failed')
  })
  await ownerMessage(f, bot, 'Prepare the release notes')
  await waitForRuntime(() => expect(s.store.taskSummary(bot).status).toBe('failed'))
  const failedTurns = turns(f, bot)

  // An agent's Retry is unattended work: it waits at the limit.
  expect((await agentRequest(f, '/api/tasks/retry-failed', { id: bot })).status).toBe(200)
  expect(s.store.taskSummary(bot).spendPause).toBeDefined()
  expect(s.store.taskSummary(bot).status).toBe('failed')
  expect(turns(f, bot)).toBe(failedTurns)

  // The owner's Retry is consent, like a message: it resets the count and runs now.
  expect((await f.request('/api/tasks/retry-failed', { id: bot })).status).toBe(200)
  await idleAfter(f, bot, failedTurns + 1)
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()
})

it('runs held queued work when the owner selects Run', async () => {
  const { f, bot } = await setup(1)
  const s = f.runtime.services
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession('provider-session')
    charge(input, 1_500_000)
    input.onText('Done')
  })
  await ownerMessage(f, bot, 'Watch the release')
  await idleAfter(f, bot, 1)
  const held = await unattended(f, bot, 'The release page changed')
  await waitForRuntime(() => expect(s.store.taskSummary(bot).spendPause).toBeDefined())
  expect((await agentRequest(f, '/api/tasks/run', { id: bot })).status).toBe(200)
  expect(turns(f, bot)).toBe(1)

  expect((await f.request('/api/tasks/run', { id: bot })).status).toBe(200)
  await idleAfter(f, bot, 2)
  expect(s.store.task(bot).messages.some((message) => message.id === held)).toBe(true)
  expect(s.store.taskSummary(bot).spendPause).toBeUndefined()
})
