import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { randomBytes } from 'node:crypto'
import {
  decode,
  taskSchema,
  modelMentionsSchema,
  defaultTaskHarness,
  type ModelCatalog,
} from '@dovo/protocol'

it('deduplicates built-in model aliases while keeping configured identities and cached discovery', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const models = vi.fn<() => Promise<ModelCatalog>>(async () => ({
    models: [
      { id: 'default', name: 'Default' },
      { id: 'gpt-hidden', name: 'GPT hidden', hidden: true },
      { id: 'gpt/exact', name: 'GPT Exact' },
      { id: 'gpt/exact', name: 'GPT Exact' },
    ],
    reasoning: [],
  }))
  const available = new Set(['codex'])
  const get = vi.spyOn(runtime.services.agents, 'get').mockImplementation(async (provider) => ({
    probe: async () => ({ provider, available: available.has(provider), detail: '' }),
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
    const result = decode(modelMentionsSchema, await (await call('gpt')).json())
    expect(result.models).toEqual([
      {
        reference: 'model:harness%3Acodex/gpt%2Fexact',
        name: 'GPT Exact',
        provider: 'codex',
        model: 'gpt/exact',
      },
    ])
    const calls = models.mock.calls.length
    await call('exact')
    expect(models).toHaveBeenCalledTimes(calls)
    expect(runtime.services.store.task('task').draft).toBe('Keep @gpt')
    expect(runtime.services.store.task('task').agentId).toBe(task.agentId)

    // Saved profiles retain their exact identities, even when they share a catalog.
    runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: [
        { ...defaultTaskHarness('codex'), id: 'work', name: 'Work Codex' },
        {
          ...defaultTaskHarness('codex'),
          id: 'other-account',
          name: 'Other account',
          env: { CODEX_HOME: '/tmp/dovo-model-mentions-other' },
        },
      ],
    }))
    const configured = decode(modelMentionsSchema, await (await call('gpt')).json())
    expect(configured.models.map((model) => model.reference)).toEqual([
      'model:agent%3Aother-account/gpt%2Fexact',
      'model:agent%3Awork/gpt%2Fexact',
      'model:harness%3Acodex/gpt%2Fexact',
    ])

    // A scoped override of a built-in agent is distinct when its launch/account differs.
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: [
        {
          id: 'project',
          name: 'Project',
          path: '/tmp/dovo-model-mentions-project',
          branch: 'main',
          agents: [
            {
              ...defaultTaskHarness('codex'),
              id: 'dovo:codex',
              name: 'Project Codex',
              env: { CODEX_HOME: '/tmp/dovo-model-mentions-project-account' },
            },
          ],
        },
      ],
      tasks: workspace.tasks.map((entry) => ({ ...entry, repositoryId: 'project' })),
    }))
    available.add('claude')
    const scoped = decode(modelMentionsSchema, await (await call('gpt')).json())
    expect(scoped.models.map((model) => model.reference)).toEqual([
      'model:agent%3Adovo%3Acodex/gpt%2Fexact',
      'model:agent%3Aother-account/gpt%2Fexact',
      'model:agent%3Awork/gpt%2Fexact',
      'model:harness%3Aclaude/gpt%2Fexact',
      'model:harness%3Acodex/gpt%2Fexact',
    ])
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})
