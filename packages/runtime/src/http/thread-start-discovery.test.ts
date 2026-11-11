import { expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { defaultTaskHarness } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import { fixture } from '../testing/fixture.js'

vi.setConfig(runtimeIntegration)

it.each(['complete', 'fail', 'cancel'] as const)(
  'acknowledges and owns a held model selection through %s',
  async (outcome) => {
    const token = 'model-selection-owner-token-at-least-32-characters'
    const f = await fixture()
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const s = runtime.services
      s.store.update(() => ({
        ...f.workspace,
        repositories: f.workspace.repositories.map((repo) => ({ ...repo, kind: 'folder' })),
      }))
      const harness = { ...defaultTaskHarness('codex'), model: 'fast' }
      s.defaults.save({ ...s.defaults.get(), configured: true, harness })
      s.preferences.save({ ...s.preferences.get(), enableSmartModelSelection: true })
      s.titles.save({ harness, model: 'utility' })
      let selecting = false
      let utilitySignal: AbortSignal | undefined
      const run = vi.fn<AgentAdapter['run']>(async (input) => {
        if (input.agent.model === 'utility') {
          selecting = true
          utilitySignal = input.signal
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(input.signal.reason)
            if (input.signal.aborted) abort()
            else input.signal.addEventListener('abort', abort, { once: true })
            void held.then(() => {
              input.signal.removeEventListener('abort', abort)
              resolve()
            })
          })
          if (outcome === 'fail') throw new Error('Model selection failed')
          input.onText(JSON.stringify({ id: '0', reason: 'Fast model' }))
        } else input.onText('Done')
      })
      vi.spyOn(s.agents, 'get').mockResolvedValue({
        probe: async (agent) => ({ provider: agent.provider, available: true, detail: '' }),
        models: async () => ({ models: [{ id: 'fast', name: 'Fast' }], reasoning: [] }),
        run,
      })
      vi.spyOn(s.titles, 'generateEffect').mockReturnValue(Effect.succeed({ title: 'Generated' }))
      const task = s.tasks.create({
        title: 'Draft',
        repositoryId: 'repo',
        agentId: '',
        objective: '',
      })
      s.store.updateTask(task.id, (task) => ({ ...task, modelSelection: 'auto' }))
      const post = (path: string, input: unknown) =>
        fetch(`http://127.0.0.1:${runtime.port}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      const input = {
        id: task.id,
        messageId: 'first',
        text: 'Work',
        initialTitle: { before: 'Draft', after: 'Work' },
      }
      const sending = post('/api/tasks/message', input)
      await waitForRuntime(() => expect(selecting).toBe(true))
      expect((await sending).status).toBe(200)
      expect(s.store.taskSummary(task.id)).toMatchObject({
        status: 'running',
        runPhase: 'preparing',
        modelSelection: 'auto',
      })
      expect(s.store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual(['first'])
      // A lost HTTP response must not create a second selector or a second message.
      expect((await post('/api/tasks/message', input)).status).toBe(200)
      expect(run).toHaveBeenCalledTimes(1)
      let cancellationStatus: number | undefined
      if (outcome === 'cancel') {
        cancellationStatus = (
          await post('/api/tasks/cancel', {
            id: task.id,
            runId: s.store.taskSummary(task.id).activeRunId,
          })
        ).status
      } else {
        // An independent rename during selection must survive the model update.
        s.store.updateTask(task.id, (current) => ({
          ...current,
          title: 'Keep my title',
          draft: 'My next prompt',
        }))
      }
      release()
      expect(cancellationStatus).toBe(outcome === 'cancel' ? 200 : undefined)
      expect(utilitySignal?.aborted).toBe(outcome === 'cancel')
      await waitForRuntime(() => expect(s.tasks.hasWorkingFamily(task.id)).toBe(false))
      const settled = s.store.taskSummary(task.id)
      expect(settled.status).toBe(
        outcome === 'complete' ? 'review' : outcome === 'fail' ? 'failed' : 'cancelled',
      )
      expect(run).toHaveBeenCalledTimes(outcome === 'complete' ? 2 : 1)
      expect(settled.queue?.[0]?.id).toBe(outcome === 'complete' ? undefined : 'first')
      expect(settled.modelSelection).toBe(outcome === 'complete' ? undefined : 'auto')
      expect(settled.title).toBe(outcome === 'cancel' ? 'Work' : 'Keep my title')
      expect(settled.draft).toBe(outcome === 'cancel' ? '' : 'My next prompt')
    } finally {
      release()
      await runtime.close()
      await f.cleanup()
      vi.restoreAllMocks()
    }
  },
)

it('reuses live picker discovery during first sends, refreshes explicitly, and isolates accounts', async () => {
  const token = 'thread-discovery-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    const harness = { ...defaultTaskHarness('codex'), model: 'fast' }
    s.defaults.save({ ...s.defaults.get(), configured: true, harness })
    s.preferences.save({ ...s.preferences.get(), enableSmartModelSelection: true })
    s.titles.save({ harness, model: 'utility' })
    const probe = vi.fn<AgentAdapter['probe']>(async (agent) => ({
      provider: agent.provider,
      available: agent.provider === 'codex',
      detail: '',
    }))
    const models = vi.fn<NonNullable<AgentAdapter['models']>>(async () => ({
      models: [
        { id: 'fast', name: 'Fast' },
        { id: 'strong', name: 'Strong' },
      ],
      reasoning: [],
    }))
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onText(JSON.stringify({ id: '0', reason: 'Fast model is sufficient' }))
    })
    vi.spyOn(s.agents, 'get').mockImplementation(async () => ({ probe, models, run }))
    const post = (path: string, input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const select = async () => {
      const task = s.tasks.create({
        title: 'Draft',
        repositoryId: 'dovo:scratch',
        agentId: '',
        objective: '',
      })
      s.store.updateTask(task.id, (task) => ({ ...task, modelSelection: 'auto' }))
      const response = await post('/api/tasks/message', {
        id: task.id,
        messageId: task.id,
        text: 'Explain this',
        queueOnly: true,
      })
      expect(response.status).toBe(200)
      expect(s.store.taskSummary(task.id).modelSelection).toBeUndefined()
      expect(s.store.taskSummary(task.id).queue?.[0]?.id).toBe(task.id)
    }
    // The same requests used by desktop and mobile pickers populate the live runtime cache.
    expect((await post('/api/agents/availability', {})).status).toBe(200)
    expect((await post('/api/agents/models', harness)).status).toBe(200)
    const probesBefore = probe.mock.calls.length
    expect(models).toHaveBeenCalledTimes(1)
    await select()
    expect(probe).toHaveBeenCalledTimes(probesBefore)
    expect(models).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)

    // Refresh replaces the same live cache rather than leaving selection on an older copy.
    expect((await post('/api/agents/models', { ...harness, refresh: true })).status).toBe(200)
    await select()
    expect(models).toHaveBeenCalledTimes(2)

    // Effective account changes require discovery even when the provider/model are the same.
    s.defaults.save({ ...s.defaults.get(), harness: { ...harness, env: { ACCOUNT: 'other' } } })
    await select()
    expect(probe).toHaveBeenCalledTimes(probesBefore + 1)
    expect(models).toHaveBeenCalledTimes(3)
    expect(models.mock.calls.at(-1)?.[0].env).toEqual({ ACCOUNT: 'other' })
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
  }
})

it.each(['complete', 'fail', 'cancel'] as const)(
  'acknowledges Send while checkout preparation is held and preserves its %s outcome',
  async (outcome) => {
    const token = 'thread-admission-owner-token-at-least-32-characters'
    const f = await fixture()
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const s = runtime.services
      s.store.update(() => ({
        ...f.workspace,
        repositories: f.workspace.repositories.map((repo) => ({ ...repo, kind: 'folder' })),
      }))
      const run = vi.fn<AgentAdapter['run']>(async (input) => {
        input.onText('Done')
      })
      vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
      const directory = s.checkouts.directory.bind(s.checkouts)
      const task = s.tasks.create({
        title: 'Slow checkout',
        repositoryId: 'repo',
        agentId: '',
        objective: '',
        harness: defaultTaskHarness('codex'),
      })
      let preparing = false
      vi.spyOn(s.checkouts, 'directory').mockImplementation(async (id, signal) => {
        if (id === task.id) {
          preparing = true
          await held
          signal?.throwIfAborted()
          if (outcome === 'fail') throw new Error('Checkout preparation failed')
        }
        return directory(id, signal)
      })
      const post = (path: string, input: unknown) =>
        fetch(`http://127.0.0.1:${runtime.port}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      const sending = post('/api/tasks/message', { id: task.id, messageId: 'first', text: 'Work' })
      await waitForRuntime(() => expect(preparing).toBe(true))
      // No timer releases this checkout. A foreground wait would deadlock this assertion.
      expect((await sending).status).toBe(200)
      expect(s.store.taskSummary(task.id)).toMatchObject({
        status: 'running',
        runPhase: 'preparing',
      })
      expect(run).not.toHaveBeenCalled()
      let cancellationStatus: number | undefined
      if (outcome === 'cancel') {
        const runId = s.store.taskSummary(task.id).activeRunId
        cancellationStatus = (await post('/api/tasks/cancel', { id: task.id, runId })).status
      }
      expect(cancellationStatus).toBe(outcome === 'cancel' ? 200 : undefined)
      release()
      await waitForRuntime(() => expect(s.tasks.hasWorkingFamily(task.id)).toBe(false))
      expect(run).toHaveBeenCalledTimes(outcome === 'complete' ? 1 : 0)
      const settled = s.store.taskSummary(task.id)
      expect(settled.status).toBe(
        outcome === 'complete' ? 'review' : outcome === 'fail' ? 'failed' : 'cancelled',
      )
      expect(settled.queue?.[0]?.id).toBe(outcome === 'complete' ? undefined : 'first')
      expect(settled.error).toBe(
        outcome === 'complete'
          ? undefined
          : outcome === 'fail'
            ? 'Checkout preparation failed'
            : 'Cancelled by user',
      )
    } finally {
      release()
      await runtime.close()
      await f.cleanup()
      vi.restoreAllMocks()
    }
  },
)
