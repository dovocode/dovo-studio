import { expect, it } from 'vite-plus/test'
import { recentTools } from '@dovo/studio-core'
import { threadTimeline } from './thread-timeline'

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
