import { Schema } from 'effect'
import { expect, it } from 'vitest'
import { recentTools, activitySchema } from './activity'
import { activitySummary, toolPresentation } from './tool-presentation'
type Event = Schema.Schema.Type<typeof activitySchema>['events'][number]
const event = (
  id: string,
  toolId: string,
  status: string,
  data: unknown,
  summary = 'Tool',
  time = '2026-09-22T10:00:00Z',
): Event => ({
  id,
  time,
  kind: 'tool',
  scope: 'task',
  summary,
  payload: JSON.stringify({ turnId: 'turn', toolId, status, event: data }),
})
it('shows supplied computer-use titles, readable commands and output without protocol noise', () => {
  expect(
    toolPresentation(
      JSON.stringify({
        event: {
          item: {
            type: 'mcpToolCall',
            tool: 'mcp__cua_repl__js',
            arguments: { title: 'Inspect desktop', code: 'await app.getAXState()' },
            result: {
              content: [
                { type: 'text', text: 'Desktop ready' },
                { type: 'image', data: 'base64-secret' },
              ],
            },
          },
        },
      }),
      'js',
    ),
  ).toEqual({
    kind: 'computer',
    title: 'Inspect desktop',
    input: 'await app.getAXState()',
    output: 'Desktop ready',
  })
  expect(
    toolPresentation(
      JSON.stringify({
        event: {
          item: { type: 'commandExecution', command: 'git status', aggregatedOutput: 'Clean' },
        },
      }),
      'commandExecution',
    ),
  ).toEqual({ title: 'git status', kind: 'command', input: 'git status', output: 'Clean' })
})
it('splits batched Claude tools and preserves each input when separate results arrive', () => {
  const start = event(
    'start',
    'a,b',
    'running',
    {
      message: {
        content: [
          { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'rg todo' } },
          { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    },
    'Bash, Read',
  )
  const end = event(
    'end',
    'a',
    'completed',
    { message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'Found 2' }] } },
    'Tool result',
    '2026-09-22T10:00:01Z',
  )
  const calls = recentTools([start, end])
  expect(calls).toHaveLength(2)
  expect(calls[0].status).toBe('completed')
  expect(toolPresentation(calls[0].payload, calls[0].summary, calls[0].inputPayload)).toEqual({
    title: 'rg todo',
    input: 'rg todo',
    output: 'Found 2',
    kind: 'command',
  })
  expect(activitySummary(calls)).toBe('Ran 1 command and 1 file operation')
})
it('keeps completion when start and result share a timestamp', () => {
  const calls = recentTools([
    event('a', 'same', 'running', { item: { command: 'pwd' } }, 'pwd'),
    event('b', 'same', 'completed', { item: { command: 'pwd', aggregatedOutput: '/repo' } }, 'pwd'),
  ])
  expect(calls).toHaveLength(1)
  expect(calls[0].status).toBe('completed')
})
it('summarizes distinct activity without counting reasoning as a tool', () => {
  const calls = recentTools([
    event('cua', 'cua', 'completed', { item: { tool: 'mcp__cua_repl__js' } }),
    event('cmd', 'cmd', 'completed', { item: { command: 'pwd' } }),
    event('tool', 'tool', 'completed', {}),
    {
      ...event('r', 'r', 'completed', {}),
      kind: 'reasoning',
      payload: JSON.stringify({
        turnId: 'turn',
        toolId: 'r',
        status: 'completed',
        reasoning: { text: 'Check the source first.' },
      }),
    },
  ])
  expect(activitySummary(calls)).toBe('Used Computer Use, ran 1 command, and used 1 tool')
  expect(
    toolPresentation(calls.find((call) => call.kind === 'reasoning')!.payload, 'Reasoning'),
  ).toEqual({ title: 'Reasoning', input: '', output: 'Check the source first.', kind: 'reasoning' })
})
it('handles legacy text, unknown payloads and truncated event JSON without crashing', () => {
  expect(toolPresentation('raw output', 'Old tool')).toEqual({
    title: 'Old tool',
    input: '',
    output: 'raw output',
    kind: 'tool',
  })
  expect(toolPresentation('{}', 'Tool').output).toBe('')
  expect(recentTools([{ ...event('x', 'x', 'recorded', {}), payload: '{broken' }])).toHaveLength(1)
})
