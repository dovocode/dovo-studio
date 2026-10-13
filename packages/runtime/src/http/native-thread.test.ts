import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, nativeThreadPageSchema, type NativeThreadEntry } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration } from '../testing/integration'
import type { AgentAdapter, NativeAgentSession } from '../agents/execution/types'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
it('authenticates native reads, fences them to a known child, and pages history without touching the parent', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'native-thread-test-owner-token-long-enough'
  const runtime = await startRuntime({ port: 0, databasePath: ':memory:', ownerToken: token })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const entries: NativeThreadEntry[] = Array.from({ length: 55 }, (_, index) => ({
    id: `entry-${index}`,
    role: 'assistant',
    text: `Reply ${index}`,
  }))
  const read = vi.fn<NonNullable<NativeAgentSession['readThread']>>(async () => entries)
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onSession('parent-session')
      run.onNativeSession?.({ stop: async () => {}, readThread: read }, 'parent-session')
      run.onSubagentEvent?.(
        'item/started',
        {
          threadId: 'native-child',
          item: { type: 'commandExecution' },
        },
        'parent-session',
      )
      run.onText('Parent reply')
    },
  })
  const task = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Delegate',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const parentMessages = s.store.task(task.id).messages
  const request = (changes: Record<string, unknown> = {}, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/native-thread`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.id,
        id: 'native-child',
        provider: 'codex',
        sessionId: 'parent-session',
        ...changes,
      }),
    })
  expect((await request({}, 'invalid')).status).toBe(401)
  expect((await request({ id: 'another-child' })).status).toBe(404)
  expect((await request({ sessionId: 'another-session' })).status).toBe(404)
  expect(read).not.toHaveBeenCalled()
  const page = decode(nativeThreadPageSchema, await (await request()).json())
  expect(page.entries).toEqual(entries.slice(5))
  expect(page.before).toBe('entry-5')
  const older = decode(
    nativeThreadPageSchema,
    await (await request({ before: page.before })).json(),
  )
  expect(older.entries).toEqual(entries.slice(0, 5))
  expect(older.before).toBeUndefined()
  expect((await request({ before: 'removed' })).status).toBe(409)
  expect(read).toHaveBeenCalledWith('native-child')
  expect(s.store.task(task.id).messages).toEqual(parentMessages)
  expect(s.store.task(task.id).activeRunId).toBeUndefined()
})
