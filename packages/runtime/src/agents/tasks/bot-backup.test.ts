import { expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness, botResultSchema, decode, resolveTaskAgent } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

async function setupBackup() {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  s.store.update((w) => ({
    ...w,
    agents: [
      ...w.agents,
      {
        ...defaultTaskHarness('claude'),
        id: 'backup',
        name: 'Backup',
        model: 'backup-model',
        permission: 'full-access',
      },
    ],
  }))
  const saved = await f.request('/api/bots/update', {
    id: created.id,
    expectedRevision: created.bot.revision,
    backupAgentId: 'backup',
  })
  expect(saved.status).toBe(200)
  return { f, s, id: created.id }
}
it('hands an unaccepted Bot request to its configured backup once and preserves access and history', async () => {
  const { f, s, id } = await setupBackup()
  f.runtime.run.mockImplementation(async (input) => {
    if (input.agent.provider === 'codex') throw Error('503 Provider unavailable')
    input.onText('Backup finished')
  })
  await s.tasks.send(id, 'original-input', 'Keep this request')
  await waitForRuntime(() => expect(s.store.task(id).status).toBe('review'))
  expect(f.inputs.map((i) => i.agent.provider)).toEqual(['codex', 'claude'])
  const task = s.store.task(id)
  expect(task.turns?.map((t) => t.status)).toEqual(['failed', 'completed'])
  expect(task.messages.filter((m) => m.id === 'original-input')).toHaveLength(1)
  expect(f.inputs[1].prompt).toContain('Keep this request')
  expect(resolveTaskAgent(task, s.store.get().agents)?.permission).toBe(
    defaultTaskHarness('codex').permission,
  )
  expect(task.bot?.backupAgentId).toBe('backup')
  await f.restart()
  expect(f.runtime.services.store.task(id).bot?.backupAgentId).toBe('backup')
  expect(f.runtime.run).not.toHaveBeenCalled()
})
it.each(['accepted', 'text', 'tool', 'unrelated', 'backup-fails'] as const)(
  'does not replay accepted work or loop: %s',
  async (mode) => {
    const { f, s, id } = await setupBackup()
    f.runtime.run.mockImplementation(async (input) => {
      if (mode === 'accepted') input.onPromptAccepted?.()
      if (mode === 'text') input.onText('Partial output')
      if (mode === 'tool')
        input.onEvent?.('item/started', {
          type: 'item/started',
          item: {
            id: 'cmd',
            type: 'commandExecution',
            command: 'touch example',
            status: 'inProgress',
          },
        })
      throw Error(
        mode === 'unrelated' ? 'Invalid project configuration' : '503 Provider unavailable',
      )
    })
    await s.tasks.send(id, 'input', 'Do work')
    await waitForRuntime(() => {
      const t = s.store.task(id)
      expect(t.activeRunId).toBeUndefined()
      expect(t.status).toBe('failed')
      expect(t.turns).toHaveLength(mode === 'backup-fails' ? 2 : 1)
    })
    expect(f.inputs).toHaveLength(mode === 'backup-fails' ? 2 : 1)
    expect(s.store.task(id).queuePaused).toBe(true)
  },
)
it('keeps backup settings across unrelated Bot edits and rejects missing configurations', async () => {
  const { f, s, id } = await setupBackup()
  const bot = s.store.task(id).bot!
  expect(
    (await f.request('/api/bots/update', { id, expectedRevision: bot.revision, role: 'New role' }))
      .status,
  ).toBe(200)
  expect(s.store.task(id).bot?.backupAgentId).toBe('backup')
  const revision = s.store.task(id).bot!.revision
  expect(
    (
      await f.request('/api/bots/update', {
        id,
        expectedRevision: revision,
        backupAgentId: 'missing',
      })
    ).status,
  ).toBe(400)
  expect(
    (await f.request('/api/bots/update', { id, expectedRevision: revision, backupAgentId: null }))
      .status,
  ).toBe(200)
  expect(s.store.task(id).bot?.backupAgentId).toBeUndefined()
})

it.each(['queued', 'paused', 'settings-changed'] as const)(
  'preserves new input and settings during a provider failure: %s',
  async (mode) => {
    const { f, s, id } = await setupBackup()
    let providerReleased!: () => void
    const released = new Promise<void>((resolve) => {
      providerReleased = resolve
    })
    let applyEdit!: () => void
    const edit = new Promise<void>((resolve) => {
      applyEdit = resolve
    })
    if (mode === 'settings-changed') {
      const release = s.tasks.releaseProviderForHandoff.bind(s.tasks)
      vi.spyOn(s.tasks, 'releaseProviderForHandoff').mockImplementation(async (taskId) => {
        await release(taskId)
        providerReleased()
        await edit
        s.store.updateTask(taskId, (t) => ({
          ...t,
          bot: t.bot && {
            ...t.bot,
            revision: '22222222-2222-4222-8222-222222222222',
            responsibilities: 'New human instructions',
          },
        }))
      })
    }
    f.runtime.run.mockImplementation(async () => {
      if (mode === 'queued') s.tasks.queue.add(id, 'later', 'Keep this later request')
      if (mode === 'paused')
        s.store.updateTask(id, (t) => ({ ...t, bot: t.bot && { ...t.bot, state: 'paused' } }))
      throw Error('503 Provider unavailable')
    })
    s.tasks.queue.add(id, 'original', 'Original request')
    const { done } = await s.tasks.start(id)
    if (mode === 'settings-changed') {
      await released
      applyEdit()
    }
    // Failed status is visible before the backup finalizer checks concurrent human edits.
    await expect(done).rejects.toThrow('503 Provider unavailable')
    expect(s.store.task(id).activeRunId).toBeUndefined()
    expect(s.store.task(id).status).toBe('failed')
    expect(f.inputs).toHaveLength(1)
    expect(resolveTaskAgent(s.store.task(id), s.store.get().agents)?.provider).toBe('codex')
    expect(s.store.task(id).queue?.map((m) => m.text) ?? []).toEqual(
      mode === 'queued' ? ['Keep this later request'] : [],
    )
    expect(s.store.task(id).bot?.responsibilities).toBe(
      mode === 'settings-changed' ? 'New human instructions' : 'Watch releases.',
    )
  },
)

it('can use a separate configured account for the same provider and model without looping', async () => {
  const { f, s, id } = await setupBackup()
  const primary = defaultTaskHarness('codex')
  s.store.update((w) => ({
    ...w,
    agents: w.agents.map((agent) =>
      agent.id === 'backup' ? { ...agent, ...primary, configDirectory: '/backup-account' } : agent,
    ),
  }))
  f.runtime.run.mockImplementation(async (input) => {
    if (!input.agent.configDirectory) throw Error('429 quota exhausted')
    input.onText('Backup account finished')
  })
  await s.tasks.send(id, 'account-input', 'Continue with the configured account')
  await waitForRuntime(() => expect(s.store.task(id).status).toBe('review'))
  expect(f.inputs.map((i) => i.agent.provider)).toEqual(['codex', 'codex'])
  expect(f.inputs[1].agent.configDirectory).toBe('/backup-account')
})
