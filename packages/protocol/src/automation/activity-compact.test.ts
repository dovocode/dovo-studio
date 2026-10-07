import { expect, it } from 'vite-plus/test'
import { compactActivityEvents, recentTools, type activitySchema } from './activity'
import { toolPresentation } from '../conversation/presentation/tool-presentation'
import { mcpAppReferences } from '../conversation/mcp-apps'
import type { Schema } from 'effect'
type Event = Schema.Schema.Type<typeof activitySchema>['events'][number]
const event = (payload: unknown): Event => ({
  id: 'event',
  time: '2026-10-02T12:00:00Z',
  kind: 'tool',
  scope: 'task',
  summary: 'Command',
  payload: JSON.stringify(payload),
})
it('keeps commands, status, turn offsets and apps while dropping raw data and output', () => {
  const apps = [{ id: 'app', taskId: 'task', title: 'Preview', revision: 1 }]
  const full = event({
    turnId: 'turn',
    toolId: 'command',
    status: 'completed',
    textOffset: 42,
    mcpApps: apps,
    event: {
      item: {
        command: 'pnpm test',
        aggregatedOutput: 'large-output'.repeat(10000),
        privateField: 'raw-only',
      },
    },
  })
  const compact = compactActivityEvents([full])[0]!
  expect(compact.payload.length).toBeLessThan(full.payload.length / 100)
  expect(compact.payload).not.toContain('large-output')
  expect(compact.payload).not.toContain('raw-only')
  expect(toolPresentation(compact.payload, compact.summary)).toMatchObject({
    kind: 'command',
    input: 'pnpm test',
    output: '',
  })
  expect(recentTools([compact])[0]).toMatchObject({
    turnId: 'turn',
    status: 'completed',
    textOffset: 42,
  })
  expect(mcpAppReferences(compact.payload)).toEqual(apps)
  expect(compactActivityEvents([compact])).toEqual([compact])
  expect(full.payload).toContain('large-output')
})
it('preserves multiple Claude tool identities while dropping result text and full arguments', () => {
  const full = event({
    turnId: 'turn',
    toolId: 'message',
    status: 'running',
    event: {
      message: {
        content: [
          { type: 'tool_use', id: 'one', name: 'bash', input: { command: 'pwd' } },
          {
            type: 'tool_use',
            id: 'two',
            name: 'read_file',
            input: { path: 'readme.md', privateField: 'hidden-argument' },
          },
        ],
      },
    },
  })
  const compact = compactActivityEvents([full])
  expect(recentTools(compact).map((tool) => JSON.parse(tool.payload).toolId)).toEqual([
    'one',
    'two',
  ])
  expect(compact[1]!.payload).not.toContain('hidden-argument')
  expect(toolPresentation(compact[1]!.payload, compact[1]!.summary).input).toBe('')
  expect(toolPresentation(compact[1]!.payload, compact[1]!.summary).title).toBe('readme.md')
})
it('keeps the original command after a provider sends a separate result event', () => {
  const start = event({
    turnId: 'turn',
    toolId: 'command',
    status: 'running',
    event: {
      message: {
        content: [
          { type: 'tool_use', id: 'command', name: 'bash', input: { command: 'pnpm test' } },
        ],
      },
    },
  })
  const end = {
    ...event({
      turnId: 'turn',
      toolId: 'command',
      status: 'completed',
      event: {
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'command', content: 'large result' }],
        },
      },
    }),
    id: 'result',
    summary: 'Tool result',
    time: '2026-10-02T12:00:01Z',
  }
  const tool = recentTools(compactActivityEvents([start, end]))[0]!
  expect(toolPresentation(tool.payload, tool.summary, tool.inputPayload)).toMatchObject({
    title: 'pnpm test',
    input: 'pnpm test',
    kind: 'command',
    output: '',
  })
})
it('retains settled tool records while a live tool changes and does not reuse removed records', async () => {
  const { createRecentTools } = await import('./activity')
  const project = createRecentTools()
  const old = { ...event({ turnId: 'older', toolId: 'old', status: 'completed' }), id: 'older' }
  const live = event({ turnId: 'turn', toolId: 'command', status: 'running' })
  const input = [old, live]
  const before = project(input)
  expect(project(input)).toBe(before)
  const after = project([
    old,
    {
      ...live,
      payload: JSON.stringify({ turnId: 'turn', toolId: 'command', status: 'completed' }),
    },
  ])
  expect(after[0]).toBe(before[0])
  expect(after[1]).not.toBe(before[1])
  expect(after[1]!.status).toBe('completed')
  expect(project([])).toEqual([])
  expect(project([old])[0]).not.toBe(before[0])
})
