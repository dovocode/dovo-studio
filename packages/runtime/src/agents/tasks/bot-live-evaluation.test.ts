import { expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botResultSchema, decode, taskHarnessSchema, type Automation } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots.js'
import { turnTokenCounter } from './context-usage.js'
import { estimatedTurnCost } from './estimated-cost.js'

/** Explicit opt-in. Real adapters and credentials, isolated runtime database and Bot directories.
 * Usage caps act on provider reports and can overrun by an in-flight request. */
it.runIf(process.env.DOVO_LIVE_BOT_EVAL === '1')(
  'evaluates delegation, consent, private memory, schedule catch-up and backup with a live provider',
  async () => {
    const harness = decode(taskHarnessSchema, JSON.parse(process.env.DOVO_BOT_EVAL_HARNESS ?? '{}'))
    expect(harness.model.trim()).not.toBe('')
    const f = await setupBotRuntime()
    const s = f.runtime.services
    vi.restoreAllMocks()
    const get = s.agents.get.bind(s.agents)
    let calls = 0,
      tokens = 0,
      cost = 0
    const budget = new AbortController()
    const deadline = setTimeout(
      () => budget.abort(new Error('Live evaluation time budget reached')),
      240_000,
    )
    const maximum = { calls: 12, tokens: 20_000, usd: 1 }
    vi.spyOn(s.agents, 'get').mockImplementation(async (...args) => {
      const adapter = await get(...args)
      return {
        ...adapter,
        run: async (input) => {
          if (++calls > maximum.calls) throw Error('Live evaluation call budget reached')
          if (input.agent.model === 'eval-unavailable-primary')
            throw Error('503 service unavailable')
          const counter = turnTokenCounter(input.agent.provider, () => input.sessionId)
          let previousTokens = 0,
            previousCost = 0
          const timer = setTimeout(
            () => budget.abort(new Error('Live evaluation turn timed out')),
            60_000,
          )
          try {
            await adapter.run({
              ...input,
              signal: AbortSignal.any([input.signal, budget.signal]),
              onEvent: (name, payload) => {
                input.onEvent?.(name, payload)
                counter.accept(name, payload)
                const currentTokens = counter.total() ?? 0
                const currentCost =
                  estimatedTurnCost(
                    input.agent.provider,
                    counter.model() ?? input.agent.model,
                    counter.usage(),
                  ) ?? 0
                tokens += Math.max(0, currentTokens - previousTokens)
                cost += Math.max(0, currentCost - previousCost)
                previousTokens = currentTokens
                previousCost = currentCost
                if (tokens >= maximum.tokens || cost >= maximum.usd)
                  budget.abort(new Error('Live evaluation usage budget reached'))
              },
              approve: async () => 'deny',
            })
          } finally {
            clearTimeout(timer)
          }
        },
      }
    })
    const create = async (model = harness.model) => {
      const result = await f.create({
        ...f.draft(),
        harness: { ...harness, model, permission: 'read-only' },
      })
      expect(result.response.status).toBe(200)
      return decode(botResultSchema, await result.response.json()).id
    }
    const complete = (id: string) =>
      vi.waitFor(
        () => {
          const task = s.store.task(id)
          expect(task.status).toBe('review')
          expect(task.activeRunId).toBeUndefined()
          return task
        },
        { timeout: 70_000, interval: 100 },
      )
    try {
      const id = await create()
      const foreign = await create()
      const privateMarker = `private-eval-${randomUUID()}`
      s.memory.write({ scope: 'bot', botId: foreign, key: 'private-test', content: privateMarker })
      await s.tasks.send(
        id,
        randomUUID(),
        'Use Dovo subagent_spawn to ask one read-only child to calculate 19 + 23. Keep this coordinator available. Return its result when ready. Do not use native children.',
      )
      await vi.waitFor(
        () => expect(s.store.get().tasks.some((t) => t.delegation?.parentTaskId === id)).toBe(true),
        { timeout: 60_000 },
      )
      await complete(id)
      await vi.waitFor(
        () => {
          const children = s.store
            .get()
            .tasks.filter((task) => task.delegation?.parentTaskId === id)
          expect(
            children.some((child) =>
              s.store
                .task(child.id)
                .messages.some(
                  (message) => message.role === 'assistant' && message.text.includes('42'),
                ),
            ),
          ).toBe(true)
        },
        { timeout: 60_000 },
      )
      const messageId = randomUUID()
      const prompt =
        'Use response_prepare once with key eval-review and a prompt action that says "Continue after review". Do not dispatch it. This is preparation only.'
      await s.tasks.send(id, messageId, prompt)
      await complete(id)
      await s.tasks.send(id, messageId, prompt)
      const prepared =
        s.store.task(id).threadActions?.filter((action) => action.key === 'eval-review') ?? []
      expect(prepared).toHaveLength(1)
      expect(prepared[0].state).toBe('prepared')
      await s.tasks.send(
        id,
        randomUUID(),
        "Check your own Bot memory. Reply in Dutch. State whether you can see another Bot's private notes. Do not guess any private value.",
      )
      const recall = await complete(id)
      expect(
        recall.messages.filter((message) => message.role === 'assistant').at(-1)?.text,
      ).toMatch(/\b(ik|geen|mijn|andere|notities|nee)\b/i)
      expect(
        recall.messages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.text)
          .join('\n'),
      ).not.toContain(privateMarker)
      const trigger = {
        kind: 'trigger' as const,
        label: 'Once',
        trigger: 'once' as const,
        schedule: '',
        timezone: 'UTC',
        runAt: new Date(Date.now() - 60_000).toISOString(),
        objective: '',
        repositoryId: '',
        agentId: '',
      }
      const flow: Automation = {
        id: randomUUID(),
        name: 'Evaluation catch-up',
        enabled: true,
        nodes: [
          { id: 'trigger', type: 'automation', position: { x: 0, y: 0 }, data: trigger },
          {
            id: 'task',
            type: 'automation',
            position: { x: 100, y: 0 },
            data: {
              ...trigger,
              kind: 'task',
              botId: id,
              objective: 'State that this delayed evaluation ran. Do not create other work.',
            },
          },
        ],
        edges: [{ id: 'next', source: 'trigger', target: 'task' }],
      }
      s.store.update((w) => ({ ...w, automations: [flow] }))
      s.jobs.tick()
      s.jobs.tick()
      await vi.waitFor(
        () =>
          expect(s.jobs.list().find((run) => run.automationId === flow.id)?.status).toBe(
            'completed',
          ),
        { timeout: 70_000 },
      )
      expect(s.jobs.list().filter((run) => run.automationId === flow.id)).toHaveLength(1)
      const backup = await create('eval-unavailable-primary')
      s.store.update((w) => ({
        ...w,
        agents: [
          ...w.agents,
          { ...harness, permission: 'read-only', id: 'eval-backup', name: 'Evaluation backup' },
        ],
      }))
      const bot = s.store.task(backup).bot!
      expect(
        (
          await f.request('/api/bots/update', {
            id: backup,
            expectedRevision: bot.revision,
            backupAgentId: 'eval-backup',
          })
        ).status,
      ).toBe(200)
      await s.tasks.send(backup, randomUUID(), 'Reply with BACKUP-READY. Do not use tools.')
      const recovered = await complete(backup)
      expect(recovered.harness?.model).toBe(harness.model)
      expect(
        recovered.messages.some((m) => m.role === 'assistant' && m.text.includes('BACKUP-READY')),
      ).toBe(true)
      expect(budget.signal.aborted).toBe(false)
    } finally {
      clearTimeout(deadline)
      budget.abort()
    }
  },
  300_000,
)
