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
      block.kind === 'text' ? block.text : block.tools.map((item) => item.summary),
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
