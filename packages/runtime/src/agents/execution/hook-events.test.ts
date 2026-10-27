import { expect, it } from 'vite-plus/test'
import type { Agent } from '@dovo/protocol'
import { HookEvents } from './hook-events.js'

const cases: Array<{
  provider: Agent['provider']
  start: [string, unknown]
  end: [string, unknown]
  input: unknown
  output: unknown
}> = [
  {
    provider: 'codex',
    start: ['item/started', { item: { id: 't', type: 'commandExecution', command: 'pwd' } }],
    end: [
      'item/completed',
      { item: { id: 't', type: 'commandExecution', exitCode: 0, aggregatedOutput: '/work' } },
    ],
    input: 'pwd',
    output: '/work',
  },
  {
    provider: 'cursor',
    start: [
      'cursor/tool_call',
      { call_id: 't', name: 'shell', arguments: { command: 'pwd' }, status: 'started' },
    ],
    end: ['cursor/tool_call', { call_id: 't', status: 'completed', result: '/work' }],
    input: { command: 'pwd' },
    output: '/work',
  },
  {
    provider: 'copilot',
    start: [
      'tool.execution_start',
      { toolCallId: 't', toolName: 'bash', arguments: { command: 'pwd' } },
    ],
    end: ['tool.execution_complete', { toolCallId: 't', success: true, result: '/work' }],
    input: { command: 'pwd' },
    output: '/work',
  },
  {
    provider: 'hermes',
    start: ['tool.start', { tool_id: 't', name: 'terminal', args: { command: 'pwd' } }],
    end: ['tool.complete', { tool_id: 't', result: '/work' }],
    input: { command: 'pwd' },
    output: '/work',
  },
  {
    provider: 'muse',
    start: [
      'item/started',
      {
        item: {
          itemId: 't',
          kind: 'toolCall',
          tool: 'bash',
          args: '{"command":"pwd"}',
          status: 'inProgress',
        },
      },
    ],
    end: [
      'item/completed',
      { item: { itemId: 't', kind: 'toolCall', status: 'completed', result: '/work' } },
    ],
    input: '{"command":"pwd"}',
    output: '/work',
  },
  {
    provider: 'opencode',
    start: [
      'message.part.updated',
      {
        properties: {
          part: {
            type: 'tool',
            callID: 't',
            tool: 'bash',
            state: { status: 'running', input: { command: 'pwd' } },
          },
        },
      },
    ],
    end: [
      'message.part.updated',
      {
        properties: {
          part: { type: 'tool', callID: 't', state: { status: 'completed', output: '/work' } },
        },
      },
    ],
    input: { command: 'pwd' },
    output: '/work',
  },
  {
    provider: 'vibe',
    start: [
      'vibe/effect',
      {
        entry: {
          id: 't',
          detail: { kind: 'shell', toolName: 'bash', input: { command: 'pwd' } },
          state: { status: 'running' },
        },
      },
    ],
    end: [
      'vibe/effect',
      { entry: { id: 't', state: { status: 'completed', outputText: '/work' } } },
    ],
    input: { command: 'pwd' },
    output: '/work',
  },
  ...(['acp', 'grok'] as const).map((provider) => ({
    provider,
    start: [
      'session/update',
      {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't',
          title: 'Run shell',
          kind: 'execute',
          rawInput: { command: 'pwd' },
          status: 'in_progress',
        },
      },
    ] as [string, unknown],
    end: [
      'session/update',
      {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't',
          status: 'completed',
          rawOutput: '/work',
        },
      },
    ] as [string, unknown],
    input: { command: 'pwd' },
    output: '/work',
  })),
]
it.each(cases)(
  'normalizes $provider tools and deduplicates progress/results',
  ({ provider, start, end, input, output }) => {
    const events = new HookEvents(provider)
    const started = events.accept(...start)
    expect(started).toMatchObject([
      { event: 'tool-start', data: { tool: { id: 't', kind: 'command', input } } },
    ])
    expect(events.accept(...start)).toEqual([])
    const completed = events.accept(...end)
    expect(completed).toMatchObject([
      {
        event: 'tool-complete',
        data: {
          tool: { id: 't', name: started[0]?.data.tool?.name, kind: 'command', input, output },
        },
      },
    ])
    expect(events.accept(...end)).toEqual([])
    expect(events.accept(...start)).toEqual([])
  },
)
it('keeps parallel Claude call identities and errors with their original inputs', () => {
  const events = new HookEvents('claude')
  const starts = events.accept('assistant', {
    message: {
      content: [
        { type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.ts' } },
        { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'false' } },
      ],
    },
  })
  expect(starts.map((event) => event.data.tool?.kind)).toEqual(['file', 'command'])
  const results = events.accept('user', {
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'b', is_error: true, content: 'failed' },
        { type: 'tool_result', tool_use_id: 'a', content: 'source' },
      ],
    },
  })
  expect(results).toMatchObject([
    {
      event: 'tool-error',
      data: { tool: { id: 'b', name: 'Bash', input: { command: 'false' }, output: 'failed' } },
    },
    {
      event: 'tool-complete',
      data: { tool: { id: 'a', name: 'Read', input: { path: 'a.ts' }, output: 'source' } },
    },
  ])
})
it('interprets nonzero command exit codes as errors even when Codex reports completed', () => {
  expect(
    new HookEvents('codex').accept('item/completed', {
      item: { id: 't', type: 'commandExecution', status: 'completed', exitCode: 1 },
    })[0]?.event,
  ).toBe('tool-error')
})
it('observes native compaction without interpreting arbitrary text', () => {
  const events = new HookEvents('codex')
  expect(events.accept('item/started', { item: { type: 'contextCompaction' } })).toEqual([
    { event: 'before-compaction', data: { trigger: 'auto' } },
  ])
  expect(events.accept('item/completed', { item: { type: 'contextCompaction' } })).toEqual([
    { event: 'after-compaction', data: { trigger: 'auto' } },
  ])
  expect(events.accept('text', { text: 'Compacting now' })).toEqual([])
})
it('tracks native children against their root session, without re-emitting progress', () => {
  const events = new HookEvents('opencode', 'root')
  expect(
    events.accept('session.created', {
      properties: { info: { id: 'child', parentID: 'root', title: 'Review' } },
    }),
  ).toMatchObject([
    { event: 'subagent-start', data: { subagent: { id: 'child', name: 'Review' } } },
  ])
  expect(events.accept('session.execution.started', { data: { sessionID: 'child' } })).toEqual([])
  expect(events.accept('session.execution.started', { data: { sessionID: 'child' } })).toEqual([])
  expect(
    events.accept('session.execution.succeeded', { data: { sessionID: 'child' } }),
  ).toMatchObject([
    { event: 'subagent-stop', data: { subagent: { id: 'child', status: 'completed' } } },
  ])
})

it('pairs server-side discovery hook results with their original query', () => {
  const events = new HookEvents('claude')
  events.accept('assistant', {
    message: {
      content: [
        {
          type: 'server_tool_use',
          id: 'discovery',
          name: 'ToolSearch',
          input: { query: 'browser' },
        },
      ],
    },
  })
  expect(
    events.accept('assistant', {
      message: {
        content: [
          {
            type: 'tool_search_tool_result',
            tool_use_id: 'discovery',
            content: {
              type: 'tool_search_tool_result_error',
              error_code: 'unavailable',
            },
          },
        ],
      },
    }),
  ).toMatchObject([
    {
      event: 'tool-error',
      data: {
        tool: {
          id: 'discovery',
          name: 'ToolSearch',
          input: { query: 'browser' },
          status: 'failed',
        },
      },
    },
  ])
})
