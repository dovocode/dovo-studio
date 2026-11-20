import { expect, it } from 'vite-plus/test'
import { decode, snapshotSchema, taskSearchSchema, type Task } from '@dovo/protocol'
import { startRuntime } from '../index.js'

const thread = (id: string, repositoryId: string, updatedAt: string): Task => ({
  id,
  title: id,
  repositoryId,
  agentId: 'agent',
  status: 'draft',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt,
  draft: '',
  files: [],
  example: false,
  messages: [{ id: `${id}-message`, role: 'user', text: `needle in ${id}` }],
  turns: [],
})

it('advertises scoped search and filters message hits over the HTTP API', async () => {
  const token = 'search-scope-device-token-at-least-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: `${token}-owner`,
    port: 0,
  })
  try {
    runtime.services.devices.add('Search scope test', token)
    runtime.services.store.update((current) => ({
      ...current,
      tasks: [
        // 55 newer matches in another project fill the global hit limit.
        ...Array.from({ length: 55 }, (_, index) =>
          thread(`other-${index}`, 'other', `2026-11-${String(10 + (index % 10))}T00:00:00Z`),
        ),
        thread('selected', 'selected', '2026-10-01T00:00:00Z'),
      ],
    }))
    const send = (path: string, input?: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: input === undefined ? undefined : JSON.stringify(input),
      })
    const snapshot = decode(
      snapshotSchema,
      await (await send('/api/snapshot?scope=overview')).json(),
    )
    expect(snapshot.taskSearchScopeSupported).toBe(true)

    const search = async (input: unknown) => {
      const reply = await send('/api/tasks/search', input)
      expect(reply.status).toBe(200)
      return decode(taskSearchSchema, await reply.json())
    }
    const global = await search({ query: 'needle' })
    expect(global.hits).toHaveLength(50)
    expect(global.hits.some((hit) => hit.taskId === 'selected')).toBe(false)

    const scoped = await search({
      query: 'needle',
      scope: { archived: false, repositoryIds: ['selected'] },
    })
    expect(scoped.hits.map((hit) => hit.taskId)).toEqual(['selected'])
    expect(scoped.taskIds).toEqual(global.taskIds)

    runtime.services.store.update((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id === 'selected'),
    }))
    const excluded = await search({
      query: 'needle',
      scope: { archived: false, repositoryIds: ['other'] },
    })
    expect(excluded).toEqual({ taskIds: ['selected'], hits: [] })
  } finally {
    await runtime.close()
  }
})
