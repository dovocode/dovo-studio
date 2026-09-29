import { expect, it } from 'vite-plus/test'
import { turnPartBoundaries } from './turn-parts'

it('keeps the final reply and checkpoint outside folded work', () => {
  const content = [
    { type: 'text' as const, text: 'Investigating' },
    { type: 'data' as const, name: 'dovo.compaction', data: {} },
    { type: 'text' as const, text: 'Final answer' },
    { type: 'data' as const, name: 'dovo.checkpoint', data: {} },
    { type: 'data' as const, name: 'dovo.turn-summary', data: 'Completed' },
  ]
  expect(turnPartBoundaries(content, false)).toEqual({ finalIndex: 2, end: 3 })
  expect(turnPartBoundaries(content, true)).toEqual({ finalIndex: -1, end: 3 })
})
it('preserves legacy replies and supports textless turns', () => {
  expect(turnPartBoundaries([{ type: 'text', text: 'Legacy answer' }], false)).toEqual({
    finalIndex: 0,
    end: 1,
  })
  expect(turnPartBoundaries([{ type: 'data', name: 'dovo.compaction', data: {} }], false)).toEqual({
    finalIndex: -1,
    end: 1,
  })
})
