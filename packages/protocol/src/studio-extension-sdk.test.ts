import { expect, it } from 'vite-plus/test'
import { defineExtension, result, setting, view } from './studio-extension-sdk.js'

it('builds a Studio view with nested controls, settings and a custom fallback', () => {
  const dashboard = view({
    id: 'overview',
    title: 'Overview',
    placement: 'settings',
    root: {
      id: 'tabs',
      kind: 'tabs',
      label: 'Service status',
      items: [
        {
          label: 'Status',
          child: {
            id: 'card',
            kind: 'card',
            children: [
              { id: 'branch', kind: 'input', label: 'Branch', setting: 'branch' },
              { id: 'run', kind: 'button', label: 'Read status', action: 'status' },
              {
                id: 'chart',
                kind: 'custom',
                label: 'Trends',
                fallback: {
                  id: 'trend',
                  kind: 'chart',
                  label: 'Runs',
                  value: result('status', 'runs'),
                },
                component: { type: 'future-chart', props: { units: 'seconds' } },
              },
            ],
          },
        },
        {
          label: 'Details',
          child: {
            id: 'disclosure',
            kind: 'disclosure',
            label: 'Current branch',
            child: { id: 'label', kind: 'text', value: setting('branch') },
          },
        },
      ],
    },
  })
  const manifest = defineExtension({
    id: 'example.ci',
    name: 'CI status',
    settings: [{ id: 'branch', title: 'Branch', default: 'main' }],
    contributions: [
      {
        id: 'status',
        kind: 'tool',
        title: 'Read status',
        taskId: 'thread',
        server: 'ci',
        tool: 'status',
      },
      dashboard,
    ],
  })
  expect(manifest.version).toBe(1)
  expect(dashboard.view).toMatchObject({ version: 1, root: 'tabs' })
  expect(dashboard.view.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'tabs',
        items: [
          { label: 'Status', child: 'card' },
          { label: 'Details', child: 'disclosure' },
        ],
      }),
      expect.objectContaining({ id: 'card', children: ['branch', 'run', 'chart'] }),
      expect.objectContaining({ id: 'chart', fallback: 'trend' }),
      expect.objectContaining({ id: 'trend', value: { result: 'status', path: ['runs'] } }),
      expect.objectContaining({ id: 'disclosure', child: 'label' }),
      expect.objectContaining({ id: 'label', value: { setting: 'branch' } }),
    ]),
  )
})

it('rejects duplicate component IDs and undefined setting and action references', () => {
  expect(() =>
    view({
      id: 'overview',
      title: 'Overview',
      placement: 'tool',
      root: {
        id: 'panel',
        kind: 'dialog',
        label: 'Open',
        child: { id: 'panel', kind: 'text', value: 'Hello' },
      },
    }),
  ).toThrow('Duplicate ID: panel')
  const create = (root: Parameters<typeof view>[0]['root']) =>
    defineExtension({
      id: 'example.ci',
      name: 'CI',
      contributions: [view({ id: 'overview', title: 'Overview', placement: 'tool', root })],
    })
  expect(() =>
    create({ id: 'branch', kind: 'switch', label: 'Use branch', setting: 'branch' }),
  ).toThrow('requires a boolean setting')
  expect(() => create({ id: 'run', kind: 'button', label: 'Run', action: 'status' })).toThrow(
    'Unknown tool action: status',
  )
})
