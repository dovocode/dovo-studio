import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun, AgentSteer } from '../../execution/types.js'
import { turnTokenCounter } from '../../tasks/context-usage.js'

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (input: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) => unknown
    >(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../../configuration/claude-command.js', () => ({
  claudeCommand: async () => '/bin/claude',
}))
import { createClaudeAdapter } from './claude.js'

class Events {
  private items: unknown[] = []
  private wake = () => {}
  private closed = false
  push(message: unknown) {
    this.items.push(message)
    this.wake()
  }
  close() {
    this.closed = true
    this.wake()
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      if (this.items.length) yield this.items.shift()
      else await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }
}

const cleanup: Array<() => Promise<void>> = []
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(async () => {
  vi.useRealTimers()
  for (const dispose of cleanup.splice(0)) await dispose()
})

function fixture() {
  const adapter = createClaudeAdapter()
  cleanup.push(async () => adapter.dispose?.())
  mocks.query.mockClear()
  const events = new Events()
  const input: SDKUserMessage[] = []
  const close = vi.fn<() => void>(() => events.close())
  const interrupt = vi.fn<() => Promise<void>>(async () => {})
  const backgroundTasks = vi.fn<(toolUseId?: string) => Promise<boolean>>(async () => true)
  mocks.query.mockImplementation(({ prompt }) => {
    if (typeof prompt === 'string') throw new Error('Expected streaming input')
    void (async () => {
      for await (const message of prompt) input.push(message)
    })()
    return {
      [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
      close,
      interrupt,
      backgroundTasks,
    }
  })
  const controller = new AbortController()
  const onNativeTurnEnd = vi.fn<() => void>()
  const onText = vi.fn<(text: string) => void>()
  const onPromptAccepted = vi.fn<NonNullable<AgentRun['onPromptAccepted']>>()
  const onSubagentEvent = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const usage = turnTokenCounter('claude', () => 'session')
  const onEvent = vi.fn<NonNullable<AgentRun['onEvent']>>((name, payload) =>
    usage.accept(name, payload),
  )
  let steer: AgentSteer | undefined
  const run: AgentRun = {
    taskId: 'task',
    agent: {
      id: 'claude',
      name: 'Claude',
      provider: 'claude',
      endpoint: '',
      model: '',
      instructions: '',
      permission: 'full-access',
    },
    cwd: '/tmp',
    prompt: 'Start',
    signal: controller.signal,
    onSession: () => {},
    onActivity: () => {},
    onText,
    onPromptAccepted,
    onSubagentEvent,
    onEvent,
    onNativeTurnEnd,
    onSteer: (handler) => {
      steer = handler
    },
    approve: async () => 'deny',
    ask: async () => null,
  }
  const running = adapter.run(run)
  void running.catch(() => {})
  return {
    adapter,
    run,
    events,
    input,
    close,
    interrupt,
    backgroundTasks,
    controller,
    running,
    onNativeTurnEnd,
    onText,
    onPromptAccepted,
    onSubagentEvent,
    onEvent,
    usage,
    async ready() {
      await vi.waitFor(() => expect(input).toHaveLength(1))
      if (!steer) throw new Error('Expected active steering')
      return steer
    },
    get steer() {
      return steer
    },
  }
}

const success = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  session_id: 'session',
  terminal_reason: 'completed',
  usage: {
    input_tokens: 20,
    output_tokens: 8,
    cache_read_input_tokens: 6,
    cache_creation_input_tokens: 4,
  },
}
const task = (id: string, depth = 1, background = false) => ({
  type: 'system',
  subtype: 'task_started',
  session_id: 'session',
  task_id: id,
  task_type: 'local_agent',
  tool_use_id: `tool-${id}`,
  spawn_depth: depth,
  is_backgrounded: background,
  description: id,
})

it('preserves native jobs and the warm stream after a pre-accept context rejection', async () => {
  const f = fixture()
  await f.ready()
  f.events.push({ ...task('background-shell', 1, true), task_type: 'local_bash' })
  f.events.push(success)
  await f.running
  f.onPromptAccepted.mockClear()
  const rejected = f.adapter.run({ ...f.run, sessionId: 'session', prompt: 'Next request' })
  await vi.waitFor(() => expect(f.input).toHaveLength(2))
  // Claude can emit a synthetic API-error assistant before the terminal result.
  f.events.push({
    type: 'assistant',
    error: 'invalid_request',
    session_id: 'session',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'Prompt is too long' }] },
  })
  f.events.push({
    ...success,
    subtype: 'error_during_execution',
    is_error: true,
    terminal_reason: 'prompt_too_long',
    errors: ['Request exceeds the available window'],
  })
  await expect(rejected).rejects.toThrow('prompt_too_long')
  expect(f.onPromptAccepted).not.toHaveBeenCalled()
  expect(f.close).not.toHaveBeenCalled()
  expect(f.onSubagentEvent).not.toHaveBeenCalledWith('dovo/session/closed', {}, 'session')
  f.events.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'background-shell',
    status: 'completed',
    session_id: 'session',
  })
  await vi.waitFor(() =>
    expect(f.onSubagentEvent).toHaveBeenCalledWith(
      'system',
      expect.objectContaining({ subtype: 'task_notification', status: 'completed' }),
      'session',
    ),
  )
  const resumed = f.adapter.run({
    ...f.run,
    sessionId: 'session',
    prompt: '/compact',
    compact: true,
  })
  await vi.waitFor(() => expect(f.input).toHaveLength(3))
  f.events.push({ type: 'system', subtype: 'compact_boundary', session_id: 'session' })
  f.events.push(success)
  await expect(resumed).resolves.toBeUndefined()
  expect(mocks.query).toHaveBeenCalledOnce()
})

it.each(['assistant', 'stream_event'])(
  'keeps context failures terminal after actual %s work',
  async (kind) => {
    const f = fixture()
    await f.ready()
    f.events.push(
      kind === 'assistant'
        ? {
            type: 'assistant',
            session_id: 'session',
            parent_tool_use_id: null,
            message: { content: [{ type: 'text', text: 'Started work' }] },
          }
        : {
            type: 'stream_event',
            session_id: 'session',
            event: { type: 'message_start' },
          },
    )
    f.events.push({
      ...success,
      is_error: true,
      terminal_reason: 'prompt_too_long',
      result: 'Prompt too long',
    })
    await expect(f.running).rejects.toThrow('prompt_too_long')
    expect(f.onPromptAccepted).toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
  },
)

it.each([
  ['aborted_streaming', 'success'],
  ['aborted_tools', 'success'],
  ['aborted_streaming', 'error_during_execution'],
  ['aborted_tools', 'error_during_execution'],
])(
  'continues the same query after steering through %s (%s) and sums segment usage',
  async (reason, subtype) => {
    const f = fixture()
    const steer = await f.ready()
    await steer({ id: 'steer-1', prompt: 'Change direction' })
    await vi.waitFor(() => expect(f.input).toHaveLength(2))
    expect(f.input[1]).toMatchObject({
      uuid: expect.any(String),
      priority: 'now',
      message: { content: [{ type: 'text', text: 'Change direction' }] },
    })
    f.events.push({
      ...success,
      subtype,
      errors: ['interrupted'],
      terminal_reason: reason,
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
    })
    await vi.waitFor(() => expect(f.onEvent).toHaveBeenCalledWith('result', expect.anything()))
    expect(f.onNativeTurnEnd).not.toHaveBeenCalled()
    expect(f.steer).toBeDefined()
    await steer({ id: 'steer-2', prompt: 'And keep going' })
    f.events.push({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Continued' } },
    })
    f.events.push(success)
    await f.running
    expect(f.onText).toHaveBeenCalledWith('Continued')
    expect(f.onNativeTurnEnd).toHaveBeenCalledOnce()
    expect(f.usage.usage()).toEqual({ input: 30, output: 11, cacheRead: 8, cacheWrite: 5 })
    expect(f.steer).toBeUndefined()
    expect(f.close).not.toHaveBeenCalled()
    expect(f.interrupt).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledOnce()
    await expect(steer({ id: 'late', prompt: 'Too late' })).rejects.toThrow('finished')
    expect(f.input).toHaveLength(3)
  },
)

it('preserves only running root-owned foreground subagents before sending images and text', async () => {
  const f = fixture()
  const steer = await f.ready()
  f.events.push(task('root'))
  f.events.push(task('nested', 2))
  f.events.push(task('background', 1, true))
  f.events.push(task('finished'))
  f.events.push({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'finished',
    status: 'completed',
  })
  f.events.push({ type: 'system', subtype: 'init', session_id: 'session' })
  await vi.waitFor(() => expect(f.onEvent).toHaveBeenCalledTimes(6))
  const move = deferred<boolean>()
  f.backgroundTasks.mockReturnValue(move.promise)
  const sending = steer({
    id: 'image-steer',
    prompt: 'Use this image',
    attachments: [
      {
        id: 'image',
        name: 'image.png',
        mime: 'image/png',
        size: 3,
        path: '/tmp/image.png',
        data: 'YWJj',
      },
    ],
  })
  expect(f.backgroundTasks).toHaveBeenCalledExactlyOnceWith('tool-root')
  expect(f.input).toHaveLength(1)
  move.resolve(true)
  await sending
  await vi.waitFor(() => expect(f.input).toHaveLength(2))
  expect(f.input[1]).toMatchObject({
    session_id: 'session',
    priority: 'now',
    uuid: expect.any(String),
    message: {
      content: [
        { type: 'text', text: 'Use this image' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } },
      ],
    },
  })
  await steer({ id: 'again', prompt: 'More guidance' })
  expect(f.backgroundTasks).toHaveBeenCalledOnce()
  f.events.push(success)
  await f.running
})

it.each(['refused', 'failed', 'timeout'])(
  'still steers when backgrounding is %s, reusing an outstanding move',
  async (mode) => {
    const f = fixture()
    const steer = await f.ready()
    f.events.push(task('root'))
    await vi.waitFor(() => expect(f.onEvent).toHaveBeenCalledOnce())
    if (mode === 'failed') f.backgroundTasks.mockRejectedValue(new Error('disabled'))
    else if (mode === 'refused') f.backgroundTasks.mockResolvedValue(false)
    else {
      f.backgroundTasks.mockReturnValue(new Promise(() => {}))
      vi.useFakeTimers()
    }
    const sending = steer({ id: 'steer-1', prompt: 'Continue' })
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(5_000)
    await sending
    if (mode === 'timeout') {
      const again = steer({ id: 'steer-2', prompt: 'Continue again' })
      await vi.advanceTimersByTimeAsync(5_000)
      await again
      vi.useRealTimers()
    }
    expect(f.backgroundTasks).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(f.input.length).toBeGreaterThan(1))
    f.events.push(success)
    await f.running
  },
)

it('rejects a steer when the turn finishes while backgrounding, without injecting a follow-up', async () => {
  const f = fixture()
  const steer = await f.ready()
  f.events.push(task('root'))
  await vi.waitFor(() => expect(f.onEvent).toHaveBeenCalledOnce())
  const move = deferred<boolean>()
  f.backgroundTasks.mockReturnValue(move.promise)
  const sending = steer({ id: 'late', prompt: 'Too late' })
  f.events.push(success)
  await f.running
  move.resolve(true)
  await expect(sending).rejects.toThrow('finished')
  expect(f.input).toHaveLength(1)
})

it('Stop cancels a steered turn even while another steer waits for backgrounding', async () => {
  const f = fixture()
  const steer = await f.ready()
  await steer({ id: 'first', prompt: 'First guidance' })
  f.events.push(task('root'))
  await vi.waitFor(() => expect(f.onEvent).toHaveBeenCalledOnce())
  f.backgroundTasks.mockReturnValue(new Promise(() => {}))
  const sending = steer({ id: 'cancelled', prompt: 'Do not inject' })
  f.controller.abort()
  await Promise.all([
    expect(sending).rejects.toThrow(/aborted/i),
    expect(f.running).rejects.toThrow('Task cancelled'),
  ])
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.input).toHaveLength(2)
  expect(f.steer).toBeUndefined()
  expect(f.onNativeTurnEnd).not.toHaveBeenCalled()
})

it('keeps a real failure terminal after steering', async () => {
  const f = fixture()
  const steer = await f.ready()
  await steer({ id: 'guidance', prompt: 'Continue' })
  f.events.push({
    ...success,
    subtype: 'error_during_execution',
    terminal_reason: 'api_error',
    errors: ['API unavailable'],
  })
  await expect(f.running).rejects.toThrow('API unavailable')
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.steer).toBeUndefined()
})

it.each(['success', 'error_during_execution'])(
  'does not hide an aborted %s on an unsteered turn',
  async (subtype) => {
    const f = fixture()
    await f.ready()
    f.events.push({
      ...success,
      subtype,
      terminal_reason: 'aborted_tools',
      errors: ['Interrupted'],
    })
    await expect(f.running).rejects.toThrow('Claude turn interrupted')
    expect(f.close).toHaveBeenCalledOnce()
  },
)

it('uses root tool ownership for older task events and handles background snapshots before starts', async () => {
  const f = fixture()
  const steer = await f.ready()
  f.events.push({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', name: 'Agent', id: 'tool-root' }] },
  })
  f.events.push({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'background', task_type: 'local_agent', description: 'background' }],
  })
  f.events.push({ ...task('root'), spawn_depth: undefined })
  f.events.push({ ...task('unknown-owner'), spawn_depth: undefined })
  f.events.push({ ...task('background'), is_backgrounded: undefined })
  f.events.push({ ...task('ambient'), ambient: true })
  await vi.waitFor(() => expect(f.onEvent).toHaveBeenCalledTimes(6))
  await steer({ id: 'steer', prompt: 'Continue' })
  expect(f.backgroundTasks).toHaveBeenCalledExactlyOnceWith('tool-root')
  f.events.push(success)
  await f.running
})

it('rejects stale steering callbacks and resets steering state when a warm query starts its next turn', async () => {
  const f = fixture()
  const oldSteer = await f.ready()
  await oldSteer({ id: 'first', prompt: 'Guide the first turn' })
  f.events.push(success)
  await f.running
  const followup = f.adapter.run({ ...f.run, sessionId: 'session', prompt: 'Second turn' })
  await vi.waitFor(() => expect(f.input).toHaveLength(3))
  await expect(oldSteer({ id: 'stale', prompt: 'Do not inject' })).rejects.toThrow('finished')
  expect(f.input).toHaveLength(3)
  f.events.push({ ...success, terminal_reason: 'aborted_streaming' })
  await expect(followup).rejects.toThrow('Claude turn interrupted')
  expect(mocks.query).toHaveBeenCalledOnce()
})
