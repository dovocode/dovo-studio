import { expect, it } from 'vite-plus/test'
import type { ThreadMessage } from '@assistant-ui/react-native'
import {
  foldedTurnPartRanges,
  toolPartArtifacts,
  toolPartGroupEnd,
  turnPartBoundaries,
} from './turn-parts'

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

it('keeps created artifacts in folded work, including textless and intermediate replies', () => {
  const reference = {
    id: 'b43c4ca3-d5cd-40cd-b98c-cfba9b02e405',
    taskId: 'thread',
    title: 'Preview',
    format: 'html' as const,
    revision: 1,
  }
  const tool = (id: string, artifacts = false) => ({
    type: 'tool-call' as const,
    toolCallId: id,
    toolName: 'Tool',
    args: {},
    argsText: '',
    artifact: {
      groupKey: id === 'unrelated' ? 'unrelated' : 'created',
      payload: JSON.stringify({ artifacts: artifacts ? [reference] : [] }),
    },
  })
  const content: ThreadMessage['content'] = [
    tool('unrelated'),
    { type: 'text', text: 'Creating a preview' },
    tool('command'),
    tool('artifact', true),
    { type: 'text', text: 'Ready' },
  ]
  expect(toolPartArtifacts(content[3]!)).toEqual([reference])
  expect(toolPartArtifacts(content[1]!)).toEqual([])
  expect(foldedTurnPartRanges(content, 4, content.length)).toEqual([
    { start: 2, end: 4 },
    { start: 4, end: 5 },
  ])
  expect(foldedTurnPartRanges(content, -1, 4)).toEqual([{ start: 2, end: 4 }])
  expect(toolPartArtifacts({ ...tool('invalid'), artifact: { payload: 'not JSON' } })).toEqual([])
})
