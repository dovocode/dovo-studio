import { afterEach, expect, it, vi } from 'vitest'
import {
  ReasoningEvents,
  safeReasoningEvent,
  type ReasoningActivityRow,
} from './reasoning-event.js'

afterEach(() => vi.useRealTimers())
function recorder(provider: ConstructorParameters<typeof ReasoningEvents>[0]) {
  const rows: ReasoningActivityRow[] = []
  const stream = new ReasoningEvents(provider, (row) => rows.push(row))
  return { stream, rows }
}
it('coalesces Codex summary deltas and lifecycle snapshots without exposing raw reasoning', () => {
  vi.useFakeTimers()
  const { stream, rows } = recorder('codex')
  stream.accept('item/started', {
    item: { id: 'r', type: 'reasoning', summary: [], content: ['private reasoning'] },
  })
  stream.accept('item/reasoning/summaryTextDelta', {
    itemId: 'r',
    summaryIndex: 0,
    delta: 'Checking ',
  })
  stream.accept('item/reasoning/summaryTextDelta', {
    itemId: 'r',
    summaryIndex: 0,
    delta: 'the project.',
  })
  expect(rows).toEqual([])
  vi.advanceTimersByTime(100)
  expect(rows).toEqual([
    {
      toolId: 'reasoning:codex:r',
      status: 'running',
      reasoning: { text: 'Checking the project.' },
    },
  ])
  expect(stream.accept('item/reasoning/textDelta', { delta: 'private raw text' })).toBe(true)
  stream.accept('item/completed', {
    item: {
      id: 'r',
      type: 'reasoning',
      summary: ['Checking the project.'],
      content: ['private reasoning'],
      encrypted_content: 'opaque',
    },
  })
  stream.finish()
  expect(rows).toHaveLength(2)
  expect(rows[1]).toEqual({ ...rows[0], status: 'completed' })
  expect(JSON.stringify(rows)).not.toMatch(/private|opaque/)
})
it('orders separate Codex summary paragraphs and keeps accumulated text when final snapshot is empty', () => {
  const { stream, rows } = recorder('codex')
  stream.accept('item/reasoning/summaryTextDelta', {
    itemId: 'r',
    summaryIndex: 1,
    delta: 'Second',
  })
  stream.accept('item/reasoning/summaryTextDelta', { itemId: 'r', summaryIndex: 0, delta: 'First' })
  stream.accept('item/completed', {
    item: { id: 'r', type: 'reasoning', summary: [], content: ['private'] },
  })
  stream.finish()
  expect(rows).toEqual([
    { toolId: 'reasoning:codex:r', status: 'completed', reasoning: { text: 'First\n\nSecond' } },
  ])
})
it('assembles Claude public thinking text and deduplicates its final assistant block', () => {
  const { stream, rows } = recorder('claude')
  const event = (event: unknown) =>
    stream.accept('stream_event', { parent_tool_use_id: null, event })
  event({ type: 'message_start', message: { id: 'message' } })
  event({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  })
  event({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'Checking the cancellation flow.' },
  })
  event({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'private-signature' },
  })
  event({ type: 'content_block_stop', index: 0 })
  stream.accept('assistant', {
    uuid: 'uuid',
    message: {
      id: 'message',
      content: [
        {
          type: 'thinking',
          thinking: 'Checking the cancellation flow.',
          signature: 'private-signature',
        },
      ],
    },
  })
  event({ type: 'message_stop' })
  stream.finish()
  expect(rows).toEqual([
    {
      toolId: 'reasoning:claude::message:0',
      status: 'completed',
      reasoning: { text: 'Checking the cancellation flow.' },
    },
  ])
})
it('keeps redacted Claude blocks private and supports non-streamed public thinking', () => {
  const { stream, rows } = recorder('claude')
  expect(
    stream.accept('assistant', {
      message: { id: 'm', content: [{ type: 'redacted_thinking', data: 'opaque' }] },
    }),
  ).toBe(true)
  stream.accept('assistant', {
    uuid: 'uuid',
    message: {
      id: 'm',
      content: [{ type: 'thinking', thinking: 'An exposed summary.', signature: 'opaque' }],
    },
  })
  stream.finish()
  expect(rows).toEqual([
    {
      toolId: 'reasoning:claude::m:final:uuid:0',
      status: 'completed',
      reasoning: { text: 'An exposed summary.' },
    },
  ])
})
it('groups ACP thoughts between tools and messages and completes unfinished blocks at turn end', () => {
  const { stream, rows } = recorder('acp')
  const thought = (text: string) =>
    stream.accept('agent_thought_chunk', {
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } },
    })
  thought('Inspecting ')
  thought('the project.')
  stream.accept('tool_call', { update: { sessionUpdate: 'tool_call' } })
  thought('Checking the result.')
  stream.finish()
  expect(rows).toEqual([
    {
      toolId: 'reasoning:acp:1',
      status: 'completed',
      reasoning: { text: 'Inspecting the project.' },
    },
    { toolId: 'reasoning:acp:2', status: 'completed', reasoning: { text: 'Checking the result.' } },
  ])
})
it('coalesces OpenCode reasoning parts, text deltas and final snapshots', () => {
  const { stream, rows } = recorder('opencode')
  const part = { id: 'part', type: 'reasoning', text: 'Inspecting', time: { start: 1 } }
  stream.accept('message.part.updated', { properties: { part } })
  stream.accept('message.part.delta', {
    properties: { partID: 'part', field: 'text', delta: ' files.' },
  })
  expect(
    stream.accept('message.part.delta', {
      properties: { partID: 'other', field: 'text', delta: 'Normal assistant message.' },
    }),
  ).toBe(false)
  stream.accept('message.part.updated', {
    properties: { part: { ...part, text: 'Inspecting files.', time: { start: 1, end: 2 } } },
  })
  stream.finish()
  expect(rows).toEqual([
    {
      toolId: 'reasoning:opencode:part',
      status: 'completed',
      reasoning: { text: 'Inspecting files.' },
    },
  ])
})
it('removes opaque fields from mixed diagnostic events while retaining tool input', () => {
  expect(
    safeReasoningEvent({
      message: {
        content: [
          { type: 'thinking', thinking: 'Public text', signature: 'hidden' },
          { type: 'redacted_thinking', data: 'hidden' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } },
          {
            type: 'reasoning',
            summary: ['Public summary'],
            content: ['private'],
            encrypted_content: 'hidden',
          },
        ],
      },
    }),
  ).toEqual({
    message: {
      content: [
        { type: 'thinking', thinking: 'Public text' },
        { type: 'redacted_thinking' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } },
        { type: 'reasoning', summary: ['Public summary'] },
      ],
    },
  })
})
