import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  agentTurnSettings,
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

it.each(['harness', 'custom agent'] as const)(
  'uses a model chosen during a run for following turns with a %s',
  async (selection) => {
    const f = await fixture()
    const token = 'test-owner-token-with-at-least-32-characters'
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    let complete = () => {}
    const completion = new Promise<void>((resolve) => (complete = resolve))
    try {
      const configured = {
        ...defaultTaskHarness('codex'),
        model: 'original',
        reasoning: 'low',
        permission: 'read-only' as const,
        instructions: 'Thread instructions',
      }
      const custom = { ...configured, id: 'agent', name: 'Custom Codex' }
      runtime.services.store.update(() => ({ ...f.workspace, agents: [custom] }))
      const run = vi.fn<AgentAdapter['run']>(async (input) => {
        input.onText('Response')
        if (run.mock.calls.length === 1) await completion
      })
      vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
        run,
        probe: vi.fn<AgentAdapter['probe']>(),
      })
      const task = runtime.services.tasks.create({
        title: 'Model changes',
        objective: '',
        repositoryId: 'repo',
        agentId: selection === 'custom agent' ? custom.id : '',
        harness: configured,
        execution: 'main',
      })
      const send = async (
        messageId: string,
        turnSettings?: ReturnType<typeof agentTurnSettings>,
      ) => {
        const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/message`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: task.id, messageId, text: messageId, turnSettings }),
        })
        expect(response.status).toBe(200)
      }
      await send('first')
      await waitForRuntime(() => expect(run).toHaveBeenCalledOnce())
      await send(
        'chosen',
        agentTurnSettings(
          { ...configured, model: 'large', reasoning: 'high', instructions: 'Only this turn' },
          true,
        ),
      )
      await send('inherited')
      await send('reset', { provider: 'codex', model: '', reasoning: '' })
      await send('inherited-reset')
      expect(resolveTaskAgent(runtime.services.store.task(task.id), [custom])?.model).toBe(
        'original',
      )
      expect(run.mock.calls[0]![0].agent.model).toBe('original')
      complete()
      await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(5))
      await waitForRuntime(() =>
        expect(runtime.services.tasks.hasWorkingFamily(task.id)).toBe(false),
      )
      expect(run.mock.calls.map(([input]) => [input.agent.model, input.agent.reasoning])).toEqual([
        ['original', 'low'],
        ['large', 'high'],
        ['large', 'high'],
        ['', ''],
        ['', ''],
      ])
      expect(run.mock.calls.map(([input]) => input.agent.instructions.split('\n')[0])).toEqual([
        'Thread instructions',
        'Only this turn',
        'Thread instructions',
        'Thread instructions',
        'Thread instructions',
      ])
      expect(runtime.services.store.get().agents).toEqual([custom])
    } finally {
      complete()
      await runtime.close()
      await f.cleanup()
    }
  },
)
