import { expect, it } from 'vite-plus/test'
import type { ThreadMessage } from '@assistant-ui/react-native'
import { foldedTurnPartRanges, toolPartGroupEnd, turnPartBoundaries } from './turn-parts'

it('preserves shared activity groups across resumes, failures and text boundaries', () => {
  const tool = (id: string, groupKey: string, isError = false) => ({
    type: 'tool-call' as const,
    toolCallId: id,
    toolName: 'Command',
    args: {},
    argsText: '',
    artifact: { groupKey },
    isError,
  })
  const content: ThreadMessage['content'] = [
    tool('first', 'attempt-one'),
    tool('second', 'attempt-one'),
    tool('resumed', 'attempt-two'),
    tool('failed', 'attempt-two', true),
    tool('after-failure', 'attempt-three'),
    { type: 'text', text: 'Update' },
    tool('after-text', 'attempt-three'),
  ]
  expect(toolPartGroupEnd(content, 0, content.length)).toBe(1)
  expect(toolPartGroupEnd(content, 2, content.length)).toBe(3)
  expect(toolPartGroupEnd(content, 3, content.length)).toBe(3)
  expect(toolPartGroupEnd(content, 4, content.length)).toBe(4)
  expect(toolPartGroupEnd(content, 0, 1)).toBe(0)
  expect(foldedTurnPartRanges(content, 5, content.length)).toEqual([
    { start: 2, end: 4 },
    { start: 5, end: 6 },
  ])
})

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
