import { expect, it } from 'vitest'
import { contextUsage, turnTokenCounter } from './context-usage'

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
  expect(turnTokenCounter('acp', () => undefined).total()).toBeUndefined()
})
