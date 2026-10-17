import { expect, it } from 'vite-plus/test'
import { toolImages, toolImageReferences, nativeToolImagePath } from './tool-images'
import { compactActivityEvents } from '../automation/activity'
const image = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6K0sAAAAASUVORK5CYII='
const native = (item: unknown, status = 'completed') => ({ status, event: { item } })

it('extracts native generated raster data and keeps it out of compact activity', () => {
  const item = {
    id: 'generated',
    type: 'imageGeneration',
    status: 'completed',
    result: png,
    savedPath: '/tmp/result.png',
  }
  expect(toolImages(native(item))).toEqual([
    { uri: `data:image/png;base64,${png}`, mime: 'image/png' },
  ])
  const event = {
    id: 'gen-event',
    scope: 'task',
    kind: 'tool',
    time: '',
    summary: 'Generate image',
    payload: JSON.stringify(native(item)),
  }
  const [compact] = compactActivityEvents([event])
  expect(toolImageReferences(compact!.payload)).toEqual([
    { eventId: 'gen-event', index: 0, mime: 'image/png' },
  ])
  expect(compact!.payload).not.toContain(png)
  expect(compactActivityEvents([compact!])).toEqual([compact])
  for (const result of ['', 'not-image', '<svg/>', 'https://example.com/image.png'])
    expect(toolImages(native({ ...item, result }))).toEqual([])
  expect(
    toolImages(native({ ...item, status: 'failed', failure: { type: 'usageLimitExceeded' } })),
  ).toEqual([])
  expect(toolImages(native({ ...item, result: `data:image/png;base64,${png}` }))).toHaveLength(1)
})

it.each([
  ['jpeg', '/9j/4AAQSkZJRgAB'],
  ['gif', 'R0lGODlhAQABAIAA'],
  ['webp', 'UklGRhAAAABXRUJQ'],
])('recognizes generated %s data by its raster signature', (format, result) => {
  expect(
    toolImages(native({ type: 'imageGeneration', status: 'completed', result }))[0]?.mime,
  ).toBe(`image/${format}`)
})

it.each(['imageView', 'imageGeneration'])(
  'keeps %s file previews task/event scoped through compaction',
  (type) => {
    const item =
      type === 'imageView'
        ? { type, path: '/tmp/view.png' }
        : { type, status: 'completed', savedPath: '/tmp/view.png', result: '' }
    const payload = native(item)
    expect(nativeToolImagePath(payload)).toBe('/tmp/view.png')
    expect(nativeToolImagePath(native(item, 'running'))).toBeUndefined()
    const event = {
      id: 'file-event',
      scope: 'task',
      kind: 'tool',
      time: '',
      summary: 'Image',
      payload: JSON.stringify(payload),
    }
    const compact = compactActivityEvents([event])
    expect(toolImageReferences(compact[0]!.payload)).toEqual([{ eventId: 'file-event', index: 0 }])
    expect(toolImageReferences(payload, event.id)).toEqual([{ eventId: 'file-event', index: 0 }])
    expect(JSON.parse(compact[0]!.payload).event).toBeUndefined()
    expect(compactActivityEvents(compact)).toEqual(compact)
    for (const path of [
      'https://example.com/a.png',
      'file:///tmp/a.png',
      'data:image/png;base64,AAAA',
      'bad\0.png',
    ])
      expect(nativeToolImagePath(native({ type: 'imageView', path }))).toBeUndefined()
  },
)
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
