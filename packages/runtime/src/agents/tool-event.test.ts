import { expect, it } from 'vitest'
import { toolEvent } from './tool-event'
it('recognizes tool lifecycle events from all four providers and ignores text deltas', () => {
  expect(
    toolEvent('codex', 'item/completed', {
      item: { id: '1', type: 'commandExecution', command: 'git status', status: 'completed' },
    }),
  ).toMatchObject({ title: 'git status', status: 'completed' })
  expect(
    toolEvent('claude', 'assistant', {
      message: { content: [{ type: 'tool_use', id: '2', name: 'Read' }] },
    }),
  ).toMatchObject({ title: 'Read', status: 'running' })
  expect(
    toolEvent('acp', 'tool_call', {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Inspect files',
        toolCallId: '3',
        status: 'in_progress',
      },
    }),
  ).toMatchObject({ toolId: '3', title: 'Inspect files' })
  expect(
    toolEvent('opencode', 'message.part.updated', {
      properties: {
        part: { type: 'tool', callID: '4', tool: 'bash', state: { status: 'completed' } },
      },
    }),
  ).toMatchObject({ title: 'bash', status: 'completed' })
  expect(toolEvent('codex', 'item/agentMessage/delta', { delta: 'Hello' })).toBeUndefined()
})
