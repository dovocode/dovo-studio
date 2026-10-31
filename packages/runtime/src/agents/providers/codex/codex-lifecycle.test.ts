import { ChildProcess } from 'node:child_process'
import * as processes from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { AgentRun } from '../../execution/types'
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

function fixture() {
  const child = new ChildProcess()
  const input = new PassThrough()
  const output = new PassThrough()
  child.stdin = input
  child.stdout = output
  child.stderr = new PassThrough()
  const stop = vi.spyOn(owned, 'stopOwnedChild').mockResolvedValue(undefined)
  const spawn = vi.mocked(processes.spawn).mockReturnValue(child)
  const send = (value: object) => output.write(JSON.stringify(value) + '\n')
  const started = vi.fn<() => void>()
  input.on('data', (data: Buffer) => {
    const message = JSON.parse(data.toString()) as { id?: number; method: string }
    if (message.id === undefined || !message.method) return
    const result =
      message.method === 'thread/start' || message.method === 'thread/resume'
        ? { thread: { id: 'thread' } }
        : message.method === 'turn/start'
          ? { turn: { id: 'turn', status: 'inProgress' } }
          : {}
    send({ id: message.id, result })
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
  const adapter = createCodexAdapter()
  adapters.push(adapter)
  return { child, input, output, stop, spawn, send, started, controller, run, adapter }
}

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
