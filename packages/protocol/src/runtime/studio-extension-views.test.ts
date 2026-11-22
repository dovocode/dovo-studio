import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../shared/schema.js'
import { studioExtensionManifestSchema } from './studio-extensions.js'

function validate(nodes: unknown[]) {
  return decodeResult(studioExtensionManifestSchema, {
    id: 'example',
    name: 'Example',
    version: 1,
    settings: [{ id: 'branch', title: 'Branch', default: 'main' }],
    contributions: [
      {
        id: 'status',
        title: 'Status',
        kind: 'tool',
        taskId: 'thread',
        server: 'ci',
        tool: 'status',
      },
      {
        id: 'view',
        title: 'View',
        kind: 'view',
        placement: 'settings',
        view: { version: 1, root: 'main', nodes },
      },
    ],
  })
}

it('accepts a custom diagram with bound data and a Studio fallback', () => {
  expect(
    validate([
      {
        id: 'main',
        kind: 'custom',
        label: 'Build status',
        fallback: 'fallback',
        component: {
          type: 'diagram',
          actions: [{ label: 'Refresh', action: 'status' }],
          shapes: [
            {
              kind: 'text',
              x: 20,
              y: 30,
              value: { result: 'status', path: ['items', '0'] },
              tone: 'accent',
            },
          ],
        },
      },
      { id: 'fallback', kind: 'textarea', label: 'Branch', setting: 'branch' },
    ]).success,
  ).toBe(true)
})

it.each([
  [{ id: 'main', kind: 'stack', children: ['missing'] }],
  [{ id: 'main', kind: 'stack', children: ['main'] }],
  [
    { id: 'main', kind: 'row', children: ['text', 'text'] },
    { id: 'text', kind: 'text', value: 'Hello' },
  ],
  [
    { id: 'main', kind: 'text', value: 'Hello' },
    { id: 'stray', kind: 'separator' },
  ],
  [
    { id: 'main', kind: 'text', value: 'Hello' },
    { id: 'main', kind: 'separator' },
  ],
  [{ id: 'main', kind: 'switch', setting: 'branch', label: 'Main' }],
  [{ id: 'main', kind: 'text', value: { setting: 'missing' } }],
  [{ id: 'main', kind: 'button', action: 'missing', label: 'Read' }],
  [{ id: 'main', kind: 'text', value: { result: 'view' } }],
  [{ id: 'main', kind: 'custom', label: 'Custom', component: { type: 'diagram' } }],
  [
    {
      id: 'main',
      kind: 'custom',
      label: 'Custom',
      fallback: 'main',
      component: { type: 'diagram', src: 'https://example.com' },
    },
  ],
  Array.from({ length: 13 }, (_, i) => ({
    id: i === 0 ? 'main' : `node-${i}`,
    ...(i === 12 ? { kind: 'separator' } : { kind: 'stack', children: [`node-${i + 1}`] }),
  })),
])('rejects an invalid component tree %#', (...nodes) => {
  expect(validate(nodes).success).toBe(false)
})

it('accepts bounded props for an unknown custom type and keeps the fallback', () => {
  const nodes = (description: string) => [
    {
      id: 'main',
      kind: 'custom',
      label: 'Summary',
      fallback: 'standard',
      component: { type: 'future-summary', props: { items: [{ description }] } },
    },
    { id: 'standard', kind: 'text', value: 'Standard summary' },
  ]
  expect(validate(nodes('Report')).success).toBe(true)
  expect(validate(nodes('x'.repeat(8192))).success).toBe(false)
})
