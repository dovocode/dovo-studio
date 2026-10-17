import { Schema } from 'effect'
import { expect, it } from 'vite-plus/test'
import { recentTools, activitySchema } from '../../automation/activity'
import { activitySummary, toolPresentation } from './tool-presentation'
type Event = Schema.Schema.Type<typeof activitySchema>['events'][number]

it('presents native Codex images with useful labels, paths and failure messages rather than base64 output', () => {
  const present = (item: unknown) => toolPresentation(JSON.stringify({ event: { item } }), 'Image')
  expect(present({ type: 'imageView', path: '/tmp/preview.png' })).toMatchObject({
    title: 'View preview.png',
    kind: 'file',
    input: '/tmp/preview.png',
    detail: '/tmp/preview.png',
    output: '',
  })
  const generated = {
    type: 'imageGeneration',
    result: 'private-base64',
    savedPath: '/tmp/result.png',
    revisedPrompt: 'A blue sky',
  }
  expect(present(generated)).toMatchObject({
    title: 'Generate image',
    input: 'A blue sky',
    detail: '/tmp/result.png',
    output: '',
  })
  expect(JSON.stringify(present(generated))).not.toContain('private-base64')
  expect(
    present({ ...generated, failure: { type: 'usageLimitExceeded', limitId: 'images' } }).output,
  ).toBe('Image generation limit reached (images).')
})
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
  // New optional context fields stay absent when a harness supplies none.
  expect(toolPresentation('{}', 'Tool')).toEqual({
    title: 'Tool',
    input: '',
    output: '',
    kind: 'tool',
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
  ).toEqual({
    title: 'git status',
    kind: 'command',
    input: 'git status',
    output: 'Clean',
    detail: undefined,
    diff: undefined,
  })
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
    detail: undefined,
    diff: undefined,
  })
  expect(activitySummary(calls)).toBe('Ran 1 command and 1 file operation')
})
it('keeps the tool start position when later updates arrive after more text', () => {
  const start = event('start', 'same', 'running', {})
  start.payload = JSON.stringify({
    turnId: 'turn',
    toolId: 'same',
    status: 'running',
    textOffset: 6,
  })
  const end = event('end', 'same', 'completed', {}, 'Tool', '2026-09-22T10:00:01Z')
  end.payload = JSON.stringify({
    turnId: 'turn',
    toolId: 'same',
    status: 'completed',
    textOffset: 13,
  })
  expect(recentTools([start, end])[0]?.textOffset).toBe(6)
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
  ).toEqual({
    title: 'Reasoning',
    input: '',
    output: 'Check the source first.',
    kind: 'reasoning',
    detail: undefined,
    diff: undefined,
  })
})
it('handles legacy text, unknown payloads and truncated event JSON without crashing', () => {
  expect(toolPresentation('raw output', 'Old tool')).toEqual({
    title: 'Old tool',
    input: '',
    output: 'raw output',
    kind: 'tool',
  })
  expect(toolPresentation('raw output', 'Old tool')).not.toHaveProperty('detail')
  expect(toolPresentation('{}', 'Tool').output).toBe('')
  expect(recentTools([{ ...event('x', 'x', 'recorded', {}), payload: '{broken' }])).toHaveLength(1)
})

it('reuses immutable tool display data without hiding changed payloads, summaries or inputs', () => {
  const payload = JSON.stringify({ text: 'cache-output-fixture' })
  const first = toolPresentation(payload, 'Original')
  expect(toolPresentation(payload, 'Original')).toBe(first)
  expect(Object.isFrozen(first)).toBe(true)
  expect(toolPresentation(payload, 'Changed').title).toBe('Changed')
  expect(toolPresentation(JSON.stringify({ text: 'new-output' }), 'Original')).not.toBe(first)
  const input = JSON.stringify({ command: 'git status' })
  const changed = toolPresentation(payload, 'Original', input)
  expect(changed).not.toBe(first)
  expect(toolPresentation(payload, 'Original', input)).toBe(changed)
})

it('bounds cached presentations and skips oversized payloads', () => {
  const first = toolPresentation('cache-eviction-fixture', 'Original')
  for (let index = 0; index < 257; index++) toolPresentation(`eviction-${index}`, 'Tool')
  expect(toolPresentation('cache-eviction-fixture', 'Original')).not.toBe(first)
  const large = 'x'.repeat(2_000_001)
  expect(toolPresentation(large, 'Large')).not.toBe(toolPresentation(large, 'Large'))
})

it('shows authoritative terminal commands like Bash and avoids duplicate native terminal-run cards', () => {
  const command = 'pnpm dev -- --host 0.0.0.0\npnpm test'
  const recorded: Event = {
    id: 'terminal',
    kind: 'tool',
    scope: 'task',
    time: '2026-09-22T10:00:01Z',
    summary: 'Terminal command',
    payload: JSON.stringify({
      turnId: 'turn',
      toolId: 'terminal:1',
      terminalCommand: true,
      status: 'completed',
      presentation: {
        kind: 'command',
        title: command,
        input: command,
        output: 'Started in terminal.',
      },
    }),
  }
  const start = event(
    'transport-start',
    'native',
    'running',
    {
      item: {
        type: 'mcpToolCall',
        server: 'dovo_task',
        tool: 'terminal_run',
        arguments: { command },
      },
    },
    'terminal_run',
  )
  const end = event(
    'transport-end',
    'native',
    'completed',
    {
      item: {
        type: 'mcpToolCall',
        server: 'dovo_task',
        tool: 'terminal_run',
        result: { content: [{ type: 'text', text: '{"id":"1"}' }] },
      },
    },
    'terminal_run',
    '2026-09-22T10:00:02Z',
  )
  const calls = recentTools([start, recorded, end])
  expect(calls).toHaveLength(1)
  expect(toolPresentation(calls[0]!.payload, calls[0]!.summary)).toEqual({
    kind: 'command',
    title: command,
    input: command,
    output: 'Started in terminal.',
    detail: undefined,
    diff: undefined,
  })
  const bash = toolPresentation(
    JSON.stringify({ event: { item: { type: 'commandExecution', command } } }),
    'Bash',
  )
  expect(bash.kind).toBe('command')
  expect(bash.input).toBe(command)
  expect(activitySummary(calls)).toBe('Ran 1 command')
})

it('shows Muse bash, read and edit context from item args, visible output and patch counts', () => {
  expect(
    toolPresentation(
      JSON.stringify({
        event: {
          item: {
            kind: 'toolCall',
            tool: 'bash',
            args: JSON.stringify({
              command: 'pnpm test',
              description: 'Run tests',
              yield_time_ms: 60000,
            }),
            visibleOutput: 'ok',
          },
        },
      }),
      'bash',
    ),
  ).toEqual({
    title: 'pnpm test',
    input: 'pnpm test',
    output: 'ok',
    kind: 'command',
    detail: 'Run tests',
    diff: undefined,
  })
  expect(
    toolPresentation(
      JSON.stringify({
        event: {
          item: {
            kind: 'toolCall',
            tool: 'read_file',
            args: JSON.stringify({ path: 'packages/app.ts', limit: 120 }),
            visibleOutput: 'Read text file `packages/app.ts`.\n1|first\n2|second',
          },
        },
      }),
      'read_file',
    ),
  ).toEqual({
    title: 'Read app.ts',
    input: 'packages/app.ts',
    output: 'Read text file `packages/app.ts`.\n1|first\n2|second',
    kind: 'file',
    detail: 'packages/app.ts · lines 1–2',
    diff: undefined,
  })
  const body = [
    'edited',
    'changed lines: line 15',
    '--- original',
    '+++ updated',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '-old',
    '+new',
    '+added',
  ].join('\n')
  expect(
    toolPresentation(
      JSON.stringify({
        event: {
          item: {
            kind: 'toolCall',
            tool: 'edit_file',
            args: JSON.stringify({ path: 'packages/app.ts', find: 'old', replace: 'new' }),
            patchSummary: { added: 2, files: 1, removed: 1 },
            visibleOutput: body,
          },
        },
      }),
      'edit_file',
    ),
  ).toEqual({
    title: 'Edit app.ts',
    input: 'packages/app.ts',
    output: '',
    kind: 'file',
    detail: 'packages/app.ts · +2 −1',
    diff: '@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+added',
  })
  expect(
    toolPresentation(
      JSON.stringify({
        event: {
          item: {
            kind: 'toolCall',
            tool: 'search',
            args: JSON.stringify({ pattern: 'toolPresentation', paths: ['packages/protocol/src'] }),
            visibleOutput: '',
          },
        },
      }),
      'search',
    ),
  ).toEqual({
    title: 'Search toolPresentation',
    input: 'toolPresentation',
    output: '',
    kind: 'search',
    detail: 'toolPresentation',
    diff: undefined,
  })
})

it('keeps terminal command identity through compact activity and preserves failed native calls', async () => {
  const { compactActivityEvents } = await import('../../automation/activity')
  const command = 'pnpm test'
  const recorded = event('terminal-compact', 'terminal:1', 'completed', {})
  recorded.payload = JSON.stringify({
    turnId: 'turn',
    toolId: 'terminal:1',
    status: 'completed',
    terminalCommand: true,
    presentation: {
      kind: 'command',
      title: command,
      input: command,
      output: 'Started in terminal.',
    },
  })
  const native = event(
    'native-compact',
    'native',
    'completed',
    { item: { tool: 'terminal_run', arguments: { command } } },
    'terminal_run',
  )
  expect(recentTools(compactActivityEvents([native, recorded]))).toHaveLength(1)
  expect(
    recentTools([
      recorded,
      { ...native, payload: native.payload.replace('"completed"', '"failed"') },
    ]),
  ).toHaveLength(2)
  const otherTurn = { ...native, payload: native.payload.replace('"turn"', '"other-turn"') }
  expect(recentTools([recorded, otherTurn])).toHaveLength(2)
})
