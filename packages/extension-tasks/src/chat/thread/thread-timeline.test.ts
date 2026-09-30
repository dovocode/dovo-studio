import { expect, it } from 'vite-plus/test'
import { recentTools } from '@dovo/studio-core'
import { threadTimeline, finalReplyIndex } from './thread-timeline'

const tool = (id: string, textOffset?: number) =>
  recentTools([
    {
      id,
      time: '2026-09-29T10:00:00Z',
      kind: 'tool',
      scope: 'task',
      summary: id,
      payload: JSON.stringify({ turnId: 'turn', toolId: id, status: 'running', textOffset }),
    },
  ])[0]!

it('keeps assistant output and tool calls in their original order', () => {
  const blocks = threadTimeline('BeforeBetweenAfter', [tool('first', 6), tool('second', 13)])
  expect(
    blocks.map((block) =>
      block.kind === 'text'
        ? block.text
        : block.kind === 'activity'
          ? block.tools.map((item) => item.summary)
          : 'compaction',
    ),
  ).toEqual([[], 'Before', ['first'], 'Between', ['second'], 'After'])
})

it('groups tools at the same position and keeps older activity above legacy text', () => {
  const blocks = threadTimeline('Reply', [tool('legacy'), tool('one', 0), tool('two', 0)])
  expect(blocks).toHaveLength(2)
  expect(blocks[0]?.kind === 'activity' && blocks[0].tools.map((item) => item.summary)).toEqual([
    'legacy',
    'one',
    'two',
  ])
  expect(blocks[1]).toMatchObject({ kind: 'text', text: 'Reply' })
})

it('places compaction between the text and tools surrounding it', () => {
  const blocks = threadTimeline(
    'BeforeAfter',
    [tool('first', 6), tool('second', 6)],
    [
      {
        at: '2026-09-29T10:00:01Z',
        turnId: 'turn',
        sessionId: 'session',
        provider: 'codex',
        trigger: 'auto',
        textOffset: 6,
      },
    ],
  )
  expect(blocks.map((block) => block.kind)).toEqual([
    'activity',
    'text',
    'activity',
    'compaction',
    'text',
  ])
  expect(blocks[3]).toMatchObject({ kind: 'compaction', offset: 6 })
})

it('does not split a streamed sentence in the middle of a word', () => {
  const text = 'The two tasks must not write to the same checkout at once. I will inspect it.'
  const offset = text.indexOf('checkout') + 2
  const blocks = threadTimeline(text, [tool('first', offset)])
  expect(blocks.map((block) => (block.kind === 'text' ? block.text : 'tool'))).toEqual([
    'tool',
    'The two tasks must not write to the same checkout at once.',
    'tool',
    ' I will inspect it.',
  ])
})

it('keeps tool groups distinct when compaction splits tools at the same text offset', () => {
  const before = tool('before', 0)
  const after = {
    ...tool('after', 0),
    time: '2026-09-29T10:00:02Z',
    startedAt: '2026-09-29T10:00:02Z',
  }
  const blocks = threadTimeline(
    '',
    [before, after],
    [
      {
        at: '2026-09-29T10:00:01Z',
        turnId: 'turn',
        sessionId: 'session',
        provider: 'codex',
        trigger: 'auto',
        textOffset: 0,
      },
    ],
  )
  const keys = blocks.flatMap((block) => (block.kind === 'activity' ? [block.key] : []))
  expect(keys).toHaveLength(2)
  expect(new Set(keys).size).toBe(keys.length)
})
it('preserves group identity when a streamed word boundary moves', () => {
  const before = threadTimeline('Checking the check', [tool('first', 15)])
  const after = threadTimeline('Checking the checkout now.', [tool('first', 15)])
  const firstKey = (blocks: ReturnType<typeof threadTimeline>) =>
    blocks.flatMap((block) =>
      block.kind === 'activity' && block.tools.length ? [block.key] : [],
    )[0]
  expect(firstKey(before)).toBeDefined()
  expect(firstKey(before)).toBe(firstKey(after))
})

it('keeps a tool in its original group when it finishes after compaction', () => {
  const start = {
    ...tool('first', 0),
    time: '2026-09-29T10:00:00Z',
    startedAt: '2026-09-29T10:00:00Z',
  }
  const compaction = {
    at: '2026-09-29T10:00:01Z',
    turnId: 'turn',
    sessionId: 'session',
    provider: 'codex' as const,
    trigger: 'auto' as const,
    textOffset: 0,
  }
  const before = threadTimeline('', [start], [compaction])
  const after = threadTimeline(
    '',
    [{ ...start, time: '2026-09-29T10:00:02Z', status: 'completed' }],
    [compaction],
  )
  expect(after.map((block) => block.kind)).toEqual(before.map((block) => block.kind))
  expect(after.flatMap((block) => (block.kind === 'activity' ? [block.key] : []))).toEqual(
    before.flatMap((block) => (block.kind === 'activity' ? [block.key] : [])),
  )
})

it('folds intermediate work without hiding the completed answer', () => {
  const blocks = threadTimeline('Before. Answer.', [tool('check', 8)])
  const index = finalReplyIndex(blocks, false)
  expect(blocks[index]).toMatchObject({ kind: 'text', text: 'Answer.' })
  expect(finalReplyIndex(blocks, true)).toBe(-1)
  expect(finalReplyIndex(threadTimeline('Legacy answer', [tool('legacy')]), false)).toBe(1)
  expect(finalReplyIndex(threadTimeline('', [tool('only')]), false)).toBe(-1)
})

it('keeps completed provider messages separate even without an intervening tool', () => {
  const blocks = threadTimeline('Progress.Final answer.', [], [], [9, 22])
  expect(blocks.filter((block) => block.kind === 'text').map((block) => block.text)).toEqual([
    'Progress.',
    'Final answer.',
  ])
  expect(blocks[finalReplyIndex(blocks, false)]).toMatchObject({
    kind: 'text',
    text: 'Final answer.',
  })
})

it('keeps tool events at exact provider boundaries rather than shifting them into the next reply', () => {
  const blocks = threadTimeline('FirstSecond sentence.', [tool('command', 5)], [], [5, 21])
  expect(
    blocks.map((block) =>
      block.kind === 'text'
        ? block.text
        : block.kind === 'activity'
          ? block.tools.map((item) => item.summary)
          : 'compaction',
    ),
  ).toEqual([[], 'First', ['command'], 'Second sentence.'])
})
