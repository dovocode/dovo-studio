import { expect, it } from 'vite-plus/test'
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

it('derives Muse row labels from tool args instead of the bare tool name', () => {
  const muse = (item: Record<string, unknown>) =>
    toolEvent('muse', 'item/started', {
      item: { kind: 'toolCall', itemId: '1', status: 'inProgress', ...item },
    })
  expect(
    muse({
      tool: 'bash',
      args: JSON.stringify({ command: 'pnpm test', description: 'Run tests' }),
    }),
  ).toMatchObject({ toolId: '1', title: 'pnpm test', status: 'running' })
  expect(
    muse({ tool: 'read_file', args: JSON.stringify({ path: 'packages/app.ts' }) }),
  ).toMatchObject({ title: 'Read app.ts' })
  expect(
    muse({
      tool: 'edit_file',
      args: JSON.stringify({ path: 'packages/app.ts', find: 'a', replace: 'b' }),
    }),
  ).toMatchObject({ title: 'Edit app.ts' })
  expect(
    muse({ tool: 'search', args: JSON.stringify({ pattern: 'needle', paths: ['packages'] }) }),
  ).toMatchObject({ title: 'Search needle' })
  expect(muse({ tool: 'bash', args: '{broken' })).toMatchObject({ title: 'bash' })
  expect(
    toolEvent('muse', 'item/completed', {
      item: { kind: 'userShell', itemId: '2', commandText: 'ls -la', status: 'completed' },
    }),
  ).toMatchObject({ title: 'ls -la', status: 'completed' })
})

it('records Hermes native tool lifecycle events', () => {
  expect(
    toolEvent('hermes', 'tool.complete', {
      tool_id: 'hermes-tool',
      name: 'Patch file',
      result: {},
    }),
  ).toEqual({ toolId: 'hermes-tool', title: 'Patch file', status: 'completed' })
})
