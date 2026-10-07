import { expect, it } from 'vite-plus/test'
import { contextUsage, turnTokenCounter } from './context-usage'

it('reads Hermes native context usage', () => {
  expect(
    contextUsage('hermes', 'session.usage', { usage: { context_used: 42, context_max: 1000 } }),
  ).toEqual({
    used: 42,
    limit: 1000,
  })
})

it('reads context usage from each provider and ignores unrelated events', () => {
  expect(
    contextUsage(
      'codex',
      'thread/tokenUsage/updated',
      {
        threadId: 'main',
        tokenUsage: {
          total: { totalTokens: 90_000 },
          last: { totalTokens: 41_000 },
          modelContextWindow: 272_000,
        },
      },
      'main',
    ),
  ).toEqual({ used: 41_000, limit: 272_000 })
  expect(
    contextUsage(
      'codex',
      'thread/tokenUsage/updated',
      { threadId: 'child', tokenUsage: {} },
      'main',
    ),
  ).toBeUndefined()
  expect(
    contextUsage('claude', 'assistant', {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 30_000,
          cache_creation_input_tokens: 500,
        },
      },
    }),
  ).toEqual({ used: 30_510 })
  expect(
    contextUsage('claude', 'assistant', {
      type: 'assistant',
      parent_tool_use_id: 'task',
      message: { usage: { input_tokens: 5 } },
    }),
  ).toBeUndefined()
  expect(
    contextUsage('claude', 'result', {
      type: 'result',
      modelUsage: {
        small: { inputTokens: 100, contextWindow: 100_000 },
        main: { inputTokens: 9_000, contextWindow: 200_000 },
      },
    }),
  ).toEqual({ limit: 200_000 })
  expect(
    contextUsage('acp', 'usage_update', {
      update: { sessionUpdate: 'usage_update', used: 7, size: 64 },
    }),
  ).toEqual({ used: 7, limit: 64 })
  expect(
    contextUsage('opencode', 'message.updated', {
      properties: {
        info: { role: 'assistant', tokens: { input: 5, cache: { read: 95, write: 0 } } },
      },
    }),
  ).toEqual({ used: 100 })
  expect(
    contextUsage('opencode', 'session.usage.updated', {
      data: { tokens: { input: 5, cache: { read: 95, write: 0 } } },
    }),
  ).toEqual({ used: 100 })
  expect(contextUsage('codex', 'item/started', {})).toBeUndefined()
})

it('counts the tokens of one turn for each provider', () => {
  const codex = turnTokenCounter('codex', () => 'main')
  const usage = (total: number, last: number) => ({
    threadId: 'main',
    tokenUsage: { total: { totalTokens: total }, last: { totalTokens: last } },
  })
  codex.accept('thread/tokenUsage/updated', usage(1_000, 400))
  codex.accept('thread/tokenUsage/updated', { ...usage(9_999, 5), threadId: 'child' })
  codex.accept('thread/tokenUsage/updated', usage(1_900, 500))
  expect(codex.total()).toBe(1_300)

  const claude = turnTokenCounter('claude', () => undefined)
  claude.accept('result', {
    type: 'result',
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300 },
  })
  expect(claude.total()).toBe(330)

  const opencode = turnTokenCounter('opencode', () => undefined)
  const message = (id: string, input: number) => ({
    properties: { info: { id, role: 'assistant', tokens: { input, output: 1 } } },
  })
  opencode.accept('message.updated', message('a', 5))
  opencode.accept('message.updated', message('a', 9))
  opencode.accept('message.updated', message('b', 4))
  expect(opencode.total()).toBe(15)
  const opencodeV2 = turnTokenCounter('opencode', () => undefined)
  opencodeV2.accept('session.usage.updated', {
    data: { tokens: { input: 5, output: 3, reasoning: 2, cache: { read: 90, write: 0 } } },
  })
  expect(opencodeV2.total()).toBe(100)
  expect(turnTokenCounter('acp', () => undefined).total()).toBeUndefined()
})

it('keeps the billable token categories for a Codex turn and a Claude result', () => {
  const codex = turnTokenCounter('codex', () => 'main')
  const event = (
    input: number,
    output: number,
    cached: number,
    lastInput: number,
    lastOutput: number,
    lastCached: number,
  ) => ({
    threadId: 'main',
    tokenUsage: {
      total: {
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: cached,
        totalTokens: input + output,
      },
      last: {
        inputTokens: lastInput,
        outputTokens: lastOutput,
        cachedInputTokens: lastCached,
        totalTokens: lastInput + lastOutput,
      },
    },
  })
  codex.accept('thread/tokenUsage/updated', event(1000, 100, 500, 200, 20, 100))
  codex.accept('thread/tokenUsage/updated', event(1300, 150, 700, 300, 50, 200))
  expect(codex.usage()).toEqual({ input: 200, output: 70, cacheRead: 300, cacheWrite: 0 })

  const claude = turnTokenCounter('claude', () => undefined)
  claude.accept('result', {
    type: 'result',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 50,
    },
    modelUsage: { 'claude-sonnet-4-6': { inputTokens: 360 } },
  })
  expect(claude.usage()).toEqual({ input: 10, output: 20, cacheRead: 300, cacheWrite: 50 })
  expect(claude.model()).toBe('claude-sonnet-4-6')
})

it('counts only the new OpenCode v2 session usage after a baseline', () => {
  const counter = turnTokenCounter('opencode', () => 's')
  counter.accept('dovo/usage/baseline', {
    tokens: { input: 100, output: 20, cache: { read: 50, write: 0 } },
    cost: 1,
  })
  counter.accept('session.usage.updated', {
    data: {
      sessionID: 's',
      tokens: { input: 150, output: 30, cache: { read: 70, write: 0 } },
      cost: 1.25,
    },
  })
  expect(counter.total()).toBe(80)
  expect(counter.usage()).toEqual({ input: 50, output: 10, cacheRead: 20, cacheWrite: 0 })
  expect(counter.cost()).toBe(0.25)
})

it('adds child request usage without counting cumulative Claude session models again', () => {
  const counter = turnTokenCounter('claude', () => undefined)
  counter.accept('assistant', {
    type: 'assistant',
    parent_tool_use_id: 'child',
    message: {
      id: 'child-response',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 2,
      },
    },
  })
  counter.accept('result', {
    type: 'result',
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 0,
    },
    modelUsage: { 'claude-sonnet-4-6': { inputTokens: 999999 } },
  })
  expect(counter.total()).toBe(207)
  expect(counter.usage()).toEqual({ input: 110, output: 25, cacheRead: 70, cacheWrite: 2 })
})
