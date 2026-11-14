import { expect, it } from 'vite-plus/test'
import { HookEvents } from './hook-events.js'
import { ToolLoopGuard, ToolLoopStop } from './tool-loop.js'
import { setupBotRuntime } from '../../testing/bots.js'
import { waitForRuntime } from '../../testing/integration.js'

it('counts terminal outcomes once and resets after progress or different errors', () => {
  const hooks = new HookEvents('acp')
  const guard = new ToolLoopGuard()
  const feed = (id: number, status = 'failed', output = 'Missing query') =>
    hooks
      .accept('session/update', {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: String(id),
          title: 'search',
          status,
          rawInput: { query: '' },
          rawOutput: output,
        },
      })
      .some((event) => guard.accept(event))
  for (let id = 0; id < 4; id++) expect(feed(id)).toBe(false)
  expect(feed(3)).toBe(false)
  expect(feed(4, 'completed')).toBe(false)
  for (let id = 5; id < 9; id++) expect(feed(id)).toBe(false)
  expect(feed(9, 'failed', 'Unavailable')).toBe(false)
  for (let id = 10; id < 13; id++) expect(feed(id, 'failed', 'Unavailable')).toBe(false)
  expect(feed(13, 'failed', 'Unavailable')).toBe(true)
})

it('fails only the looping turn, keeps partial text and pauses queued work', async () => {
  const f = await setupBotRuntime()
  const { task } = await f.create()
  const s = f.runtime.services
  f.runtime.run.mockImplementation(async (input) => {
    input.onText('Saved progress')
    s.tasks.queue.add(task.id, 'later', 'Keep this request')
    for (let i = 0; i < 5; i++) {
      input.onEvent?.('item/completed', {
        item: {
          id: String(i),
          type: 'mcpToolCall',
          tool: 'search',
          arguments: { query: '' },
          status: 'failed',
          result: 'Missing query',
        },
      })
    }
    expect(input.signal.reason).toBeInstanceOf(ToolLoopStop)
    throw input.signal.reason
  })
  await s.tasks.send(task.id, 'first', 'Work')
  await waitForRuntime(() => expect(s.store.task(task.id).status).toBe('failed'))
  const saved = s.store.task(task.id)
  expect(saved.error).toContain('five identical failed tool calls')
  expect(saved.queuePaused).toBe(true)
  expect(saved.queue?.map((message) => message.id)).toEqual(['later'])
  expect(saved.messages.some((message) => message.text.includes('Saved progress'))).toBe(true)
  expect(f.inputs).toHaveLength(1)
})
