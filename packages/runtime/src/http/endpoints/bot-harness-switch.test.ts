import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botResultSchema, decode, defaultTaskHarness, lockedTaskProvider } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots.js'
import { waitForRuntime } from '../../testing/integration.js'

it.each(['new', 'used', 'archived'] as const)(
  'switches an OpenCode Bot with conversation state %s and retains its identity and saved context',
  async (conversation) => {
    const f = await setupBotRuntime()
    const created = decode(
      botResultSchema,
      await (
        await f.create({ ...f.draft(), harness: defaultTaskHarness('opencode') })
      ).response.json(),
    )
    const id = created.id
    const send = async (text: string) => {
      expect(
        (await f.request('/api/tasks/message', { id, messageId: randomUUID(), text })).status,
      ).toBe(200)
      await waitForRuntime(() =>
        expect(f.runtime.services.store.taskSummary(id).status).toBe('review'),
      )
    }
    if (conversation !== 'new') await send('Keep the original conversation')
    const archive = async () => {
      const old = f.runtime.services.store.task(id)
      expect(
        (
          await f.request('/api/bots/archive-conversation', {
            id,
            expectedRevision: old.bot!.revision,
            expectedLastMessageId: old.messages.at(-1)!.id,
          })
        ).status,
      ).toBe(200)
      // Existing archived conversations retain their old provider and checkout locks.
      expect(f.runtime.services.store.task(id)).toMatchObject({
        status: 'draft',
        providerLock: 'opencode',
      })
      await f.restart()
    }
    if (conversation === 'archived') await archive()
    const s = f.runtime.services
    s.store.updateTask(id, (task) => ({ ...task, draft: 'Unsent follow-up' }))
    const before = s.store.task(id)
    const runCount = f.inputs.length
    const input = {
      id,
      requestId: randomUUID(),
      harness: defaultTaskHarness('claude'),
      stop: false,
    }
    const response = await f.request('/api/tasks/continue-harness', input)
    expect(await response.text()).toBe('{"ok":true}')
    expect(response.status).toBe(200)
    const changed = s.store.task(id)
    expect(changed.bot).toEqual(before.bot)
    expect(changed.draft).toBe(before.draft)
    expect(changed.messages).toEqual(before.messages)
    expect(changed.turns).toEqual(before.turns)
    expect(changed.linkedCheckouts).toEqual(before.linkedCheckouts)
    expect(changed.sessionId).toBeUndefined()
    expect(lockedTaskProvider(changed, s.store.get().agents)).toBe('claude')
    expect((await f.request('/api/tasks/continue-harness', input)).status).toBe(200)
    expect(f.inputs).toHaveLength(runCount)
    await send('Continue with the new harness')
    const next = f.inputs.at(-1)!
    expect(next.agent.provider).toBe('claude')
    expect(next.sessionId).toBeUndefined()
    expect(next.prompt.includes('Keep the original conversation')).toBe(conversation === 'used')
    const saved = s.store.get().tasks.find((task) => task.botConversation?.botId === id)
    const history = saved && s.store.task(saved.id)
    expect(
      history ? { text: history.messages[0]?.text, provider: history.turns?.[0]?.provider } : null,
    ).toEqual(
      conversation === 'archived'
        ? { text: 'Keep the original conversation', provider: 'opencode' }
        : null,
    )
  },
)

it('keeps active native and draft delegated children guarded when the Bot itself is a draft', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  const id = created.id
  const input = { id, requestId: randomUUID(), harness: defaultTaskHarness('claude'), stop: false }
  s.store.updateTask(id, (task) => ({
    ...task,
    subagents: [
      {
        id: 'native',
        provider: 'opencode',
        name: 'Working child',
        status: 'working',
        sessionLive: true,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  }))
  const active = await f.request('/api/tasks/continue-harness', input)
  expect(active.status).toBe(409)
  expect(await active.text()).toContain('Stop active agents')
  s.store.updateTask(id, (task) => ({ ...task, subagents: undefined }))
  const child = {
    ...f.draft(),
    delegation: { parentTaskId: id, parentRunId: 'previous-run', key: 'pending-child' },
  }
  s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, child] }))
  const pending = await f.request('/api/tasks/continue-harness', {
    ...input,
    requestId: randomUUID(),
  })
  expect(pending.status).toBe(409)
  expect(await pending.text()).toContain('Stop all child agents')
  expect(s.store.task(id).harness?.provider).toBe('codex')
  expect(f.inputs).toHaveLength(0)
})
