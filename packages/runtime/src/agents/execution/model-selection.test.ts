import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  defaultTaskHarness,
  resolveTaskAgent,
  snapshotSchema,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import type { AgentAdapter } from './types'

vi.setConfig(runtimeIntegration)
afterEach(() => vi.restoreAllMocks())

it.each(['harness', 'custom agent'] as const)(
  'keeps an explicit Claude model after the first HTTP send with a %s',
  async (selection) => {
    const f = await fixture()
    const token = 'test-owner-token-with-at-least-32-characters'
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    let complete = () => {}
    const completion = new Promise<void>((resolve) => (complete = resolve))
    try {
      const configured = { ...defaultTaskHarness('claude'), model: 'default' }
      const custom = { ...configured, id: 'claude', name: 'Custom Claude' }
      runtime.services.store.update(() => ({ ...f.workspace, agents: [custom] }))
      const run = vi.fn<AgentAdapter['run']>(async (input) => {
        expect(input.agent.provider).toBe('claude')
        expect(input.agent.model).toBe('opus')
        input.onSession('claude-session')
        input.onText('First response')
        await completion
      })
      vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
        run,
        probe: vi.fn<AgentAdapter['probe']>(),
      })
      const task: Task = {
        id: 'first-send',
        title: 'New task',
        repositoryId: 'repo',
        agentId: selection === 'custom agent' ? custom.id : '',
        harness: configured,
        status: 'draft',
        createdAt: '2026-10-07T00:00:00Z',
        messages: [],
        files: [],
        draft: 'Use Opus 5.5',
        example: false,
      }
      const request = (path: string, input?: unknown, method = input ? 'POST' : 'GET') =>
        fetch(`http://127.0.0.1:${runtime.port}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(input ? { body: JSON.stringify(input) } : {}),
        })
      expect(
        (
          await request(
            '/api/workspace',
            {
              collection: 'tasks',
              id: task.id,
              create: task,
              changes: {},
            },
            'PATCH',
          )
        ).status,
      ).toBe(200)
      const changes =
        selection === 'custom agent'
          ? { agentOverrides: { before: null, after: { model: 'opus' } } }
          : { harness: { before: configured, after: { ...configured, model: 'opus' } } }
      expect(
        (
          await request(
            '/api/workspace',
            {
              collection: 'tasks',
              id: task.id,
              changes: { ...changes, harnessCustomized: { before: null, after: true } },
            },
            'PATCH',
          )
        ).status,
      ).toBe(200)
      expect(
        (
          await request('/api/tasks/message', {
            id: task.id,
            messageId: 'first-input',
            text: task.draft,
          })
        ).status,
      ).toBe(200)
      await waitForRuntime(() => expect(run).toHaveBeenCalledOnce())
      const selectedModel = async () => {
        const snapshot = decode(snapshotSchema, await (await request('/api/snapshot')).json())
        const saved = snapshot.workspace.tasks.find((entry) => entry.id === task.id)!
        expect(resolveTaskAgent(saved, snapshot.workspace.agents)?.model).toBe('opus')
        expect(saved.harnessCustomized).toBe(true)
        return saved
      }
      expect((await selectedModel()).status).toBe('running')
      complete()
      await waitForRuntime(() => expect(runtime.services.store.task(task.id).status).toBe('review'))
      expect((await selectedModel()).draft).toBe('')
      expect(runtime.services.store.get().agents[0]?.model).toBe('default')
    } finally {
      complete()
      await runtime.close()
      await f.cleanup()
    }
  },
)
