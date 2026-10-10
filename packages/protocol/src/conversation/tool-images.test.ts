import { expect, it } from 'vite-plus/test'
import { toolImages, toolImageReferences } from './tool-images'
import { compactActivityEvents } from '../automation/activity'
const image = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
it('reads MCP, Claude, nested JSON and screenshot images without exposing inputs', () => {
  expect(toolImages({ input: image, result: JSON.stringify({ content: [image] }) })).toEqual([
    { uri: 'data:image/png;base64,aGVsbG8=', mime: 'image/png' },
  ])
  expect(
    toolImages({
      content: [
        { type: 'image', source: { type: 'base64', data: 'aGVsbG8=', media_type: 'image/jpeg' } },
      ],
    })[0]?.mime,
  ).toBe('image/jpeg')
  expect(toolImages({ image: 'data:image/webp;base64,aGVsbG8=' })[0]?.mime).toBe('image/webp')
  expect(
    toolImages({ type: 'image_url', image_url: { url: 'https://private.test/image' } }),
  ).toEqual([])
  expect(toolImages({ type: 'image', data: '<html>', mimeType: 'text/html' })).toEqual([])
})
it('keeps compact references readable and idempotent without syncing image blobs', () => {
  const event = {
    id: 'original',
    kind: 'tool',
    scope: 'task',
    time: '2026-10-10',
    summary: 'Screenshot',
    payload: JSON.stringify({
      toolId: 'screen',
      status: 'completed',
      result: { content: [image] },
    }),
  }
  const compact = compactActivityEvents([event])
  expect(toolImageReferences(compact[0]!.payload)).toEqual([
    { eventId: 'original', index: 0, mime: 'image/png' },
  ])
  expect(compact[0]!.payload).not.toContain(image.data)
  expect(compactActivityEvents(compact)).toEqual(compact)
})

it('maps split Claude results back to original event image indices', () => {
  const event = {
    id: 'original',
    kind: 'tool',
    scope: 'task',
    time: '2026-10-10',
    summary: 'Tools',
    payload: JSON.stringify({
      event: {
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'one', content: [image] },
            { type: 'tool_result', tool_use_id: 'two', content: [{ ...image, data: 'd29ybGQ=' }] },
          ],
        },
      },
    }),
  }
  const compact = compactActivityEvents([event])
  expect(compact.map((item) => toolImageReferences(item.payload))).toEqual([
    [{ eventId: 'original', index: 0, mime: 'image/png' }],
    [{ eventId: 'original', index: 1, mime: 'image/png' }],
  ])
  expect(compactActivityEvents(compact)).toEqual(compact)
})
