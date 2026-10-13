import { expect, it } from 'vite-plus/test'
import { codexThreadEntries, claudeThreadEntries, opencodeThreadEntries } from './native-thread'

it('renders Codex prompts, replies, reasoning and tools in provider order with bounded text', () => {
  const entries = codexThreadEntries({
    thread: {
      turns: [
        {
          id: 'turn',
          items: [
            { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Inspect' }] },
            { id: 'thought', type: 'reasoning', summary: ['Reading the code'] },
            { id: 'command', type: 'commandExecution', command: 'pwd', aggregatedOutput: '/repo' },
            { id: 'files', type: 'fileChange', changes: [{ path: 'a.ts' }] },
            { id: 'answer', type: 'agentMessage', text: 'Done' },
            {
              id: 'mcp',
              type: 'mcpToolCall',
              server: 'dovo',
              tool: 'read',
              arguments: { id: 'child' },
              result: { content: [{ type: 'text', text: 'Tool reply' }] },
            },
            { id: 'large', type: 'agentMessage', text: 'x'.repeat(20000) },
          ],
        },
      ],
    },
  })
  expect(entries.slice(0, 5)).toEqual([
    { id: 'user', role: 'user', text: 'Inspect' },
    { id: 'thought', role: 'reasoning', text: 'Reading the code' },
    { id: 'command', role: 'tool', label: 'Command', text: 'pwd\n/repo' },
    { id: 'files', role: 'tool', label: 'File changes', text: 'a.ts' },
    { id: 'answer', role: 'assistant', text: 'Done' },
  ])
  expect(entries.at(-1)?.text).toHaveLength(16002)
  expect(entries.find((entry) => entry.id === 'mcp')).toEqual({
    id: 'mcp',
    role: 'tool',
    label: 'dovo / read',
    text: '{"id":"child"}\nTool reply',
  })
})
it('keeps Claude tool results separate from user prompts and preserves reasoning', () => {
  expect(
    claudeThreadEntries([
      { uuid: 'u', type: 'user', message: { content: 'Inspect' } },
      {
        uuid: 'a',
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Checking' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
            { type: 'text', text: 'Done' },
          ],
        },
      },
      {
        uuid: 'r',
        type: 'user',
        message: {
          content: [{ type: 'tool_result', content: [{ type: 'text', text: 'Contents' }] }],
        },
      },
    ]),
  ).toEqual([
    { id: 'u', role: 'user', text: 'Inspect' },
    { id: 'a:0', role: 'reasoning', text: 'Checking' },
    { id: 'a:1', role: 'tool', label: 'Read', text: '{"file_path":"a.ts"}' },
    { id: 'a:2', role: 'assistant', text: 'Done' },
    { id: 'r:0', role: 'tool', label: 'Tool result', text: 'Contents' },
  ])
})
it('reads both OpenCode message formats without rendering internal metadata', () => {
  expect(
    opencodeThreadEntries([
      { id: 'u', type: 'user', text: 'Inspect' },
      { id: 'a', type: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
      {
        info: { id: 'v1', role: 'assistant' },
        parts: [{ id: 'p', type: 'reasoning', text: 'Checking' }],
      },
    ]),
  ).toEqual([
    { id: 'u', role: 'user', text: 'Inspect' },
    { id: 'a:0', role: 'assistant', text: 'Reply' },
    { id: 'p', role: 'reasoning', text: 'Checking' },
  ])
})
