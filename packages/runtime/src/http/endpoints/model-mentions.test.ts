import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { randomBytes } from 'node:crypto'
import { decode, taskSchema, type ModelCatalog } from '@dovo/protocol'

it('discovers exact model references through cached catalogs without changing the task', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const models = vi.fn<() => Promise<ModelCatalog>>(async () => ({
    models: [
      { id: 'default', name: 'Default' },
      { id: 'gpt-hidden', name: 'GPT hidden', hidden: true },
      { id: 'gpt/exact', name: 'GPT Exact' },
    ],
    reasoning: [],
  }))
  const get = vi.spyOn(runtime.services.agents, 'get').mockImplementation(async (provider) => ({
    probe: async () => ({ provider, available: provider === 'codex', detail: '' }),
    models,
    run: async () => {
      throw new Error('Model lookup must not run an agent')
    },
  }))
  const task = decode(taskSchema, {
    id: 'task',
    title: 'Task',
    repositoryId: '',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: 'Keep @gpt',
    example: false,
  })
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  const call = (query: string, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/model-mentions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task', query }),
    })
  try {
    expect((await call('gpt', 'invalid')).status).toBe(401)
    expect(await (await call('g')).json()).toEqual({ models: [], unavailable: [] })
    const result = await (await call('gpt')).json()
    expect(
      result.models.some(
        (model: { reference: string }) => model.reference === 'model:harness%3Acodex/gpt%2Fexact',
      ),
    ).toBe(true)
    expect(result.models.every((model: { model: string }) => model.model === 'gpt/exact')).toBe(
      true,
    )
    const calls = models.mock.calls.length
    await call('exact')
    expect(models).toHaveBeenCalledTimes(calls)
    expect(runtime.services.store.task('task').draft).toBe('Keep @gpt')
    expect(runtime.services.store.task('task').agentId).toBe(task.agentId)
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})
