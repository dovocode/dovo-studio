import { ChildProcess } from 'node:child_process'
import * as processes from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { AgentRun, AgentSteer } from '../../execution/types'
import * as owned from '../../execution/stop-owned-child'
import { createCodexAdapter } from './codex'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof processes.spawn>(),
}))

const adapters: ReturnType<typeof createCodexAdapter>[] = []
afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.dispose?.()
  vi.restoreAllMocks()
  vi.mocked(processes.spawn).mockReset()
})

function fixture(
  errors: Record<string, { code: number; message: string }> = {},
  responses: Record<string, object> = {},
  silentTurn = false,
) {
  const child = new ChildProcess()
  const input = new PassThrough()
  const output = new PassThrough()
  child.stdin = input
  child.stdout = output
  child.stderr = new PassThrough()
  const stop = vi.spyOn(owned, 'stopOwnedChild').mockResolvedValue(undefined)
  const spawn = vi.mocked(processes.spawn).mockReturnValue(child)
  const send = (value: object) => output.write(JSON.stringify(value) + '\n')
  const notify = (method: string, params: object, threadId = 'thread') =>
    send({ method, params: { threadId, ...params } })
  const complete = (id: string, status = 'completed') =>
    notify('turn/completed', { turn: { id, status } })
  const goal = (status: string) => notify('thread/goal/updated', { goal: { status } })
  const started = vi.fn<() => void>()
  const requests: Array<{ id: number; method: string; params: unknown }> = []
  input.on('data', (data: Buffer) => {
    const message = JSON.parse(data.toString()) as { id?: number; method: string; params: unknown }
    if (message.id === undefined || !message.method) return
    requests.push({ id: message.id, method: message.method, params: message.params })
    if (message.method === 'turn/start' && silentTurn) return
    if (errors[message.method]) {
      send({ id: message.id, error: errors[message.method] })
      return
    }
    const result =
      message.method === 'thread/start' || message.method === 'thread/resume'
        ? { thread: { id: 'thread' } }
        : message.method === 'turn/start'
          ? { turn: { id: 'turn', status: 'inProgress' } }
          : message.method === 'thread/goal/get' || message.method === 'thread/goal/set'
            ? {
                goal: {
                  objective: 'Fix tests',
                  status: 'active',
                  tokensUsed: 23,
                  timeUsedSeconds: 1,
                },
              }
            : {}
    send({ id: message.id, result: responses[message.method] ?? result })
    if (message.method === 'turn/start') started()
  })
  const controller = new AbortController()
  const run: AgentRun = {
    taskId: 'task',
    agent: {
      id: 'agent',
      name: 'Agent',
      provider: 'codex',
      permission: 'ask',
      instructions: '',
      model: '',
      endpoint: '',
    },
    cwd: '/tmp',
    prompt: 'Test transport',
    signal: controller.signal,
    onSession: vi.fn<AgentRun['onSession']>(),
    onActivity: vi.fn<AgentRun['onActivity']>(),
    onText: vi.fn<AgentRun['onText']>(),
    approve: async () => 'deny',
    ask: async () => null,
  }
  const adapter = createCodexAdapter(silentTurn ? 30 : undefined)
  adapters.push(adapter)
  return {
    child,
    input,
    output,
    stop,
    spawn,
    send,
    notify,
    complete,
    goal,
    started,
    controller,
    run,
    adapter,
    requests,
  }
}

it('retires a live Codex process that does not acknowledge turn start', async () => {
  const f = fixture({}, {}, true)
  const accepted = vi.fn<NonNullable<AgentRun['onPromptAccepted']>>()
  await expect(f.adapter.run({ ...f.run, onPromptAccepted: accepted })).rejects.toThrow(
    'Codex did not confirm the turn start',
  )
  expect(accepted).not.toHaveBeenCalled()
  expect(f.stop).toHaveBeenCalledTimes(1)
  const starts = f.requests.filter(({ method }) => method === 'turn/start')
  expect(starts).toHaveLength(1)
  f.send({ id: starts[0]?.id, result: { turn: { id: 'late', status: 'inProgress' } } })
  await Promise.resolve()
  expect(accepted).not.toHaveBeenCalled()
})

it('reports cold session startup and warm session resume before accepting each prompt', async () => {
  const f = fixture()
  const progress: string[] = []
  const run = {
    ...f.run,
    onStartup: (step: Parameters<NonNullable<AgentRun['onStartup']>>[0]) => progress.push(step),
    onPromptAccepted: () => {
      if (progress.at(-1) !== 'accepted') progress.push('accepted')
    },
  }
  const turn = async (sessionId?: string) => {
    f.started.mockClear()
    const result = f.adapter.run({ ...run, sessionId })
    await vi.waitFor(() => expect(f.started).toHaveBeenCalledOnce())
    f.complete('turn')
    await result
  }
  await turn()
  await turn('thread')
  expect(f.spawn).toHaveBeenCalledOnce()
  expect(progress).toEqual([
    'initializing',
    'opening-session',
    'sending-prompt',
    'accepted',
    'resuming-session',
    'sending-prompt',
    'accepted',
  ])
})

it.each([-32600, -32601])(
  'starts without an exit grace wait for optional account error %s',
  async (code) => {
    const f = fixture({
      'account/read': { code, message: 'Account metadata unavailable' },
      'account/rateLimits/read': { code, message: 'Account limits unavailable' },
    })
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const result = f.adapter.run(f.run)
    void result.catch(() => {})
    try {
      await vi.waitFor(() => expect(f.started).toHaveBeenCalledOnce())
      expect(timers.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(0)
      f.send({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } })
      await result
    } finally {
      f.controller.abort()
      await result.catch(() => {})
    }
  },
)

it('reports a rejected thread start without waiting for a process exit', async () => {
  const f = fixture({ 'thread/start': { code: -32602, message: 'Invalid thread settings' } })
  const timers = vi.spyOn(globalThis, 'setTimeout')
  await expect(f.adapter.run(f.run)).rejects.toThrow('Invalid thread settings')
  expect(timers.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(0)
  expect(f.started).not.toHaveBeenCalled()
})

it.each(['get', 'clear', 'pause'] as const)(
  'executes native goal %s without starting a model turn',
  async (action) => {
    const f = fixture()
    await f.adapter.run({ ...f.run, sessionId: 'thread', goal: { action } })
    expect(f.started).not.toHaveBeenCalled()
    expect(f.requests.some((request) => request.method === 'thread/resume')).toBe(false)
    expect(f.requests.some((request) => request.method.startsWith('thread/goal/'))).toBe(true)
    expect(f.run.onText).toHaveBeenCalled()
  },
)

it.each(['set', 'resume'] as const)(
  'follows the turn Codex starts after goal %s',
  async (action) => {
    const f = fixture()
    const result = f.adapter.run({
      ...f.run,
      sessionId: action === 'resume' ? 'thread' : undefined,
      goal: action === 'set' ? { action, objective: 'Fix tests' } : { action },
    })
    try {
      await vi.waitFor(() =>
        expect(f.requests.some(({ method }) => method === 'thread/goal/set')).toBe(true),
      )
      f.notify('turn/started', { turn: { id: 'goal-turn', status: 'inProgress' } })
      f.notify('item/agentMessage/delta', { turnId: 'goal-turn', delta: 'Goal output' })
      f.goal('complete')
      f.complete('goal-turn')
      await vi.waitFor(() => expect(f.run.onText).toHaveBeenCalledWith('Goal output'))
      await result
      expect(f.started).not.toHaveBeenCalled()
    } finally {
      f.controller.abort()
      await result.catch(() => {})
    }
  },
)

it('streams successive Codex goal turns and keeps questions and steering with the current turn', async () => {
  const f = fixture()
  let steer: AgentSteer | undefined
  f.run.onSteer = (value) => {
    steer = value
  }
  f.run.onNativeTurnEnd = vi.fn<() => void>()
  f.run.ask = vi.fn<AgentRun['ask']>().mockResolvedValue(null)
  const result = f.adapter.run({ ...f.run, sessionId: 'thread' })
  try {
    await vi.waitFor(() => expect(steer).toBeTypeOf('function'))
    const initialSteer = steer!
    f.goal('active')
    f.complete('turn')
    f.notify('turn/started', { turn: { id: 'child-turn' } }, 'child')
    f.notify('thread/goal/cleared', {}, 'child')
    f.notify('item/agentMessage/delta', { turnId: 'turn', delta: 'Late output' })
    f.notify('turn/started', { turn: { id: 'goal-1', status: 'inProgress' } })
    f.send({
      id: 'question',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread',
        turnId: 'goal-1',
        itemId: 'question',
        questions: [{ id: 'choice', header: 'Choice', question: 'Which way?', options: null }],
      },
    })
    await vi.waitFor(() => expect(f.run.ask).toHaveBeenCalledOnce())
    expect(f.run.onNativeTurnEnd).not.toHaveBeenCalled()
    expect(f.run.onText).not.toHaveBeenCalled()
    expect(f.stop).not.toHaveBeenCalled()
    await expect(initialSteer({ id: 'stale', prompt: 'Old turn' })).rejects.toThrow('has ended')
    await steer!({ id: 'steer', prompt: 'Goal turn' })
    expect(f.requests.find(({ method }) => method === 'turn/steer')?.params).toMatchObject({
      expectedTurnId: 'goal-1',
    })
    f.complete('goal-1')
    f.notify('turn/started', { turn: { id: 'goal-2', status: 'inProgress' } })
    f.complete('goal-1')
    f.goal('complete')
    f.notify('item/agentMessage/delta', { turnId: 'goal-2', delta: 'Final goal answer' })
    f.complete('goal-2')
    await result
    expect(f.run.onText).toHaveBeenCalledExactlyOnceWith('Final goal answer')
    expect(f.run.onNativeTurnEnd).toHaveBeenCalledOnce()
    expect(f.started).toHaveBeenCalledOnce()
  } finally {
    f.controller.abort()
    await result.catch(() => {})
  }
})

it.each(['handoff', 'continuation'] as const)('can Stop during a goal %s', async (phase) => {
  const f = fixture()
  let steer: AgentSteer | undefined
  f.run.onSteer = (value) => {
    steer = value
  }
  const result = f.adapter.run(f.run)
  void result.catch(() => {})
  await vi.waitFor(() => expect(steer).toBeTypeOf('function'))
  const initialSteer = steer
  f.goal('active')
  f.complete('turn')
  await vi.waitFor(() => expect(steer).toBeUndefined())
  if (phase === 'continuation')
    f.notify('turn/started', { turn: { id: 'goal-turn', status: 'inProgress' } })
  await vi.waitFor(() =>
    expect(typeof steer).toBe(phase === 'continuation' ? 'function' : 'undefined'),
  )
  expect(steer).not.toBe(initialSteer)
  f.controller.abort()
  await expect(result).rejects.toThrow('Task cancelled')
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.child)
})

it('settles when Codex keeps a goal active without starting a continuation', async () => {
  const f = fixture()
  const result = f.adapter.run(f.run)
  await vi.waitFor(() => expect(f.started).toHaveBeenCalledOnce())
  f.goal('active')
  f.complete('turn')
  await result
  expect(f.started).toHaveBeenCalledOnce()
})

it.each([
  { model: 'chosen', reasoning: 'low', expected: { model: 'chosen', effort: 'low' } },
  { model: 'chosen', reasoning: '', expected: { model: 'chosen', effort: 'medium' } },
  { model: '', reasoning: '', expected: { model: 'configured', effort: 'high' } },
])(
  'applies $expected.model and $expected.effort to a loaded Codex thread',
  async ({ model, reasoning, expected }) => {
    const f = fixture(
      {},
      {
        'thread/resume': { thread: { id: 'thread' }, model: 'previous', reasoningEffort: 'xhigh' },
        'config/read': { config: { model: 'configured', model_reasoning_effort: null } },
        'model/list': {
          data: [
            {
              model: 'chosen',
              displayName: 'Chosen',
              description: '',
              isDefault: false,
              defaultReasoningEffort: 'medium',
              supportedReasoningEfforts: [],
            },
            {
              model: 'configured',
              displayName: 'Configured',
              description: '',
              isDefault: true,
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: [],
            },
          ],
        },
      },
    )
    const result = f.adapter.run({
      ...f.run,
      sessionId: 'thread',
      agent: { ...f.run.agent, model, reasoning },
    })
    void result.catch(() => {})
    try {
      await vi.waitFor(() => expect(f.started).toHaveBeenCalledOnce())
      expect(f.requests.find(({ method }) => method === 'turn/start')?.params).toMatchObject({
        ...expected,
        serviceTier: 'default',
      })
    } finally {
      f.complete('turn')
      await result
    }
  },
)

it.each(['eof', 'read-error', 'write-error', 'write-close'] as const)(
  'fails an active completed wait after %s while the child remains alive',
  async (failure) => {
    const f = fixture()
    const result = f.adapter.run(f.run)
    void result.catch(() => {})
    await vi.waitFor(() => expect(f.started).toHaveBeenCalled())
    expect(f.child.exitCode).toBeNull()
    if (failure === 'eof') f.output.end()
    else if (failure === 'read-error') f.output.emit('error', new Error('read failed'))
    else if (failure === 'write-error') f.input.emit('error', new Error('write failed'))
    else f.input.destroy()
    await expect(result).rejects.toThrow(/Codex RPC transport/)
    expect(f.stop).toHaveBeenCalledWith(f.child)
    expect(f.child.exitCode).toBeNull()
  },
)

it('prefers the process exit reason when it arrives just after EOF', async () => {
  const f = fixture()
  const result = f.adapter.run(f.run)
  void result.catch(() => {})
  await vi.waitFor(() => expect(f.started).toHaveBeenCalled())
  f.child.stderr!.emit('data', Buffer.from('fatal detail'))
  f.output.end()
  await vi.waitFor(() => expect(f.output.readableEnded).toBe(true))
  f.child.emit('exit', 23)
  await expect(result).rejects.toThrow('Codex exited (23). fatal detail')
})

it('preserves cancellation and final completion queued immediately before EOF', async () => {
  const f = fixture()
  let cancelled = false
  f.run.ask = vi.fn<AgentRun['ask']>(async (_prompt, signal) => {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    cancelled = true
    return null
  })
  const result = f.adapter.run(f.run)
  await vi.waitFor(() => expect(f.started).toHaveBeenCalled())
  f.send({
    id: 'question',
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread',
      turnId: 'turn',
      itemId: 'item',
      questions: [{ id: 'choice', header: 'Choice', question: 'Which way?', options: null }],
    },
  })
  await vi.waitFor(() => expect(f.run.ask).toHaveBeenCalled())
  f.send({ method: 'serverRequest/resolved', params: { requestId: 'question' } })
  f.send({
    method: 'item/agentMessage/delta',
    params: { threadId: 'thread', delta: 'Final answer' },
  })
  f.send({
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } },
  })
  f.output.end()
  await result
  expect(cancelled).toBe(true)
  expect(f.run.onText).toHaveBeenCalledWith('Final answer')
  expect(f.stop).toHaveBeenCalledWith(f.child)
})

it('cancels promptly during the transport exit grace period', async () => {
  const f = fixture()
  const result = f.adapter.run(f.run)
  void result.catch(() => {})
  await vi.waitFor(() => expect(f.started).toHaveBeenCalled())
  f.output.end()
  f.controller.abort()
  await expect(result).rejects.toThrow('Task cancelled')
})

it.each(['before-grace', 'after-grace'])(
  'replaces an idle invalid native session %s without reusing its transport',
  async (timing) => {
    const f = fixture()
    const result = f.adapter.run(f.run)
    await vi.waitFor(() => expect(f.started).toHaveBeenCalled())
    f.send({
      method: 'turn/started',
      params: { threadId: 'native-child', turn: { id: 'native-turn' } },
    })
    f.send({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } })
    await result
    expect(f.stop).not.toHaveBeenCalled()
    f.output.end()
    await vi.waitFor(
      () => {
        const ready =
          timing === 'after-grace'
            ? f.stop.mock.calls.some(([child]) => child === f.child)
            : f.output.readableEnded
        expect(ready).toBe(true)
      },
      { timeout: 2500 },
    )
    // The next child gets independent pipes; the old process has still not exited.
    const next = fixture()
    const nextResult = f.adapter.run({ ...next.run, sessionId: 'thread' })
    await vi.waitFor(() => expect(next.started).toHaveBeenCalled())
    expect(next.spawn).toHaveBeenCalledTimes(2)
    next.send({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } })
    await nextResult
  },
)

it('keeps native shutdown confirmation authoritative after transport loss', async () => {
  const f = fixture()
  let confirm!: () => void
  const confirmed = new Promise<void>((resolve) => {
    confirm = resolve
  })
  f.run.onSubagentEvent = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  f.stop.mockRejectedValueOnce(
    new owned.OwnedProcessShutdownError('Shutdown not confirmed', { confirmed }),
  )
  const result = f.adapter.run(f.run)
  void result.catch(() => {})
  await vi.waitFor(() => expect(f.started).toHaveBeenCalled())
  f.output.end()
  await expect(result).rejects.toThrow('Shutdown not confirmed')
  expect(f.run.onSubagentEvent).not.toHaveBeenCalledWith('dovo/session/closed', {}, 'thread')
  confirm()
  await vi.waitFor(() =>
    expect(f.run.onSubagentEvent).toHaveBeenCalledWith('dovo/session/closed', {}, 'thread'),
  )
})
