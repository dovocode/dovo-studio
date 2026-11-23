import { expect, it } from 'vite-plus/test'
import { z } from 'zod3'
import example from '../../../examples/a2ui/issue-picker.json'
import workbench from '../../../examples/a2ui/change-review-workbench.json'
import mediaAndConfiguration from '../../../examples/a2ui/media-and-configuration.json'
import {
  a2uiApplyValues,
  a2uiCatalog,
  a2uiEvent,
  a2uiInputValues,
  a2uiMessages,
  a2uiProcessor,
  a2uiValidateInputs,
} from './a2ui'

it('checks Zod 3 collection limits before validating elements in both parse modes', async () => {
  let elementChecks = 0
  const element = z.string().refine(() => {
    elementChecks++
    return true
  })
  const collections = [
    { schema: z.array(element).max(1), input: ['first', 'second'] },
    { schema: z.array(element).length(1), input: ['first', 'second'] },
    { schema: z.set(element).max(1), input: new Set(['first', 'second']) },
    { schema: z.set(element).size(1), input: new Set(['first', 'second']) },
  ]
  const overflow = {
    success: false,
    error: { issues: [{ code: 'too_big', maximum: 1 }] },
  }
  for (const { schema, input } of collections) {
    expect(schema.safeParse(input)).toMatchObject(overflow)
    expect(await schema.safeParseAsync(input)).toMatchObject(overflow)
  }
  expect(elementChecks).toBe(0)
  expect(z.array(element).max(1).safeParse(['first'])).toEqual({
    success: true,
    data: ['first'],
  })
  expect(elementChecks).toBe(1)
})

it('processes real A2UI v1.0 messages, applies typed input and restores a compact snapshot', () => {
  const processor = a2uiProcessor(example.messages)
  try {
    expect(a2uiCatalog.toJson()).toHaveProperty('catalogId')
    const baseline = a2uiMessages(processor)
    const original = structuredClone(baseline)
    a2uiApplyValues(
      processor,
      {
        issues: { '/selected': ['123'], '/instructions': 'Keep my draft', '/includeTests': false },
      },
      true,
    )
    expect(baseline).toEqual(original)
    expect(a2uiEvent(processor, 'issues', 'send')).toMatchObject({
      name: 'selectIssues',
      context: { issues: ['123'], instructions: 'Keep my draft' },
    })
    const restored = a2uiProcessor(a2uiMessages(processor))
    try {
      expect(a2uiInputValues(restored)).toEqual(a2uiInputValues(processor))
    } finally {
      restored.dispose()
    }
  } finally {
    processor.dispose()
  }
})

it('rejects invalid input, required omissions, forged actions and unknown data paths', () => {
  const processor = a2uiProcessor(example.messages)
  try {
    expect(() => a2uiApplyValues(processor, {}, true)).toThrow('required')
    expect(() => a2uiApplyValues(processor, { issues: { '/selected': ['other'] } })).toThrow(
      'valid',
    )
    expect(() => a2uiApplyValues(processor, { issues: { '/includeTests': 'yes' } })).toThrow(
      'boolean',
    )
    expect(() => a2uiApplyValues(processor, { issues: { '/undeclared': 'value' } })).toThrow(
      'Unknown',
    )
    expect(() => a2uiApplyValues(processor, { other: {} })).toThrow('Unknown')
    expect(() => a2uiEvent(processor, 'issues', 'heading')).toThrow('Unknown')
  } finally {
    processor.dispose()
  }
})

it.each([
  { version: '0.8', surfaceUpdate: { surfaceId: 'bad', components: [] } },
  {
    version: '1.0',
    callRendererFunction: {
      surfaceId: 'issues',
      functionCall: { '@call': 'openUrl', args: { url: 'https://example.com' } },
    },
  },
  {
    version: '1.0',
    createSurface: { surfaceId: 'bad', catalogId: 'https://unknown/catalog', components: [] },
  },
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'bad',
      catalogId: a2uiCatalog.id,
      components: [{ id: 'root', component: 'Html', html: '<script>bad()</script>' }],
    },
  },
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'bad',
      catalogId: a2uiCatalog.id,
      components: [{ id: 'root', component: 'Column', children: ['root'] }],
    },
  },
])('rejects unsupported protocols, functions, catalogs, components and cycles', (message) => {
  expect(() => a2uiProcessor([message])).toThrow(/A2UI/)
})

function workbenchComponents(id: string, properties: Record<string, unknown>) {
  const surface = workbench.messages[0].createSurface
  return [
    {
      version: '1.0',
      createSurface: {
        ...surface,
        components: surface.components.map((component) =>
          component.id === id ? { ...component, ...properties } : component,
        ),
      },
    },
  ]
}

it('restores a complete workbench with typed table selections, numbers and resolved event context', () => {
  const processor = a2uiProcessor(workbench.messages)
  try {
    expect(() => a2uiValidateInputs(processor)).toThrow('Changed files')
    const values = {
      review: {
        '/selected': ['runtime', 'protocol'],
        '/parallel': 4,
        '/lint': false,
        '/instructions': 'Inspect reconnect behavior',
      },
    }
    a2uiApplyValues(processor, values, true)
    const before = a2uiMessages(processor)
    a2uiValidateInputs(processor)
    expect(a2uiMessages(processor)).toEqual(before)
    expect(a2uiEvent(processor, 'review', 'send').context).toEqual({
      files: ['runtime', 'protocol'],
      parallel: 4,
      lint: false,
      instructions: 'Inspect reconnect behavior',
    })
    const restored = a2uiProcessor(before)
    try {
      expect(a2uiInputValues(restored)).toEqual(values)
    } finally {
      restored.dispose()
    }
  } finally {
    processor.dispose()
  }
})

it.each([
  [{ '/selected': ['forged'] }, 'valid A2UI table row'],
  [{ '/selected': ['runtime', 'runtime'] }, 'valid A2UI table row'],
  [{ '/selected': 'runtime' }, 'Expected array'],
  [{ '/parallel': 0 }, 'allowed range'],
  [{ '/parallel': 9 }, 'allowed range'],
  [{ '/parallel': 1.5 }, 'step'],
  [{ '/parallel': '4' }, 'Expected number'],
  [{ '/parallel': Number.POSITIVE_INFINITY }, 'finite'],
])('rejects forged table selections and invalid numeric values: %j', (values, message) => {
  const processor = a2uiProcessor(workbench.messages)
  try {
    expect(() => a2uiApplyValues(processor, { review: values })).toThrow(message)
  } finally {
    processor.dispose()
  }
})

it('allows an unfinished numeric draft but validates it before submission', () => {
  const processor = a2uiProcessor(workbench.messages)
  try {
    a2uiApplyValues(processor, { review: { '/selected': ['runtime'], '/parallel': null } })
    expect(() => a2uiValidateInputs(processor, false)).not.toThrow()
    expect(() => a2uiValidateInputs(processor)).toThrow('Parallel checks')
  } finally {
    processor.dispose()
  }
})

it('keeps browse-only tables out of draft and response inputs', () => {
  const processor = a2uiProcessor(workbench.messages)
  try {
    expect(a2uiInputValues(processor).review).toEqual({
      '/selected': [],
      '/parallel': 2,
      '/lint': true,
      '/instructions': '',
    })
    expect(() => a2uiApplyValues(processor, { review: { '/sources': ['sample'] } })).toThrow(
      'Unknown A2UI input binding',
    )
  } finally {
    processor.dispose()
  }
})

it('accepts decimal steps without rounding errors and enforces single-row selection', () => {
  const processor = a2uiProcessor([
    ...workbenchComponents('parallel', { min: 0, max: 3, step: 0.1 }),
    { version: '1.0', updateDataModel: { surfaceId: 'review', path: '/parallel', value: 0.3 } },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'review',
        components: [
          {
            ...workbench.messages[0].createSurface.components.find(
              (component) => component.id === 'changes',
            ),
            multiple: false,
          },
        ],
      },
    },
  ])
  try {
    a2uiApplyValues(processor, { review: { '/selected': ['runtime'], '/parallel': 0.7 } }, true)
    expect(() =>
      a2uiApplyValues(processor, { review: { '/selected': ['runtime', 'protocol'] } }),
    ).toThrow('at most 1')
  } finally {
    processor.dispose()
  }
})

it.each([
  ['parallel', { min: 10, max: 1 }],
  ['parallel', { step: Number.MIN_VALUE }],
  ['progress', { value: -1 }],
  ['progress', { value: 4 }],
  ['status', { text: { '@path': '/parallel' } }],
  [
    'changes',
    {
      rows: [
        { id: 'same', cells: {} },
        { id: 'same', cells: {} },
      ],
    },
  ],
  ['changes', { rows: [{ id: 'one', cells: { undeclared: 'value' } }] }],
  ['sources', { required: true }],
  ['sources', { rows: [{ id: 'one', cells: {}, detail: 'missing' }] }],
  ['sources', { rows: [{ id: 'one', cells: {}, detail: 'root' }] }],
  [
    'runtimeDiff',
    { hunks: [{ oldStart: 0, newStart: 1, lines: [{ kind: 'context', text: 'old' }] }] },
  ],
  [
    'runtimeDiff',
    { hunks: [{ oldStart: 0, newStart: 1, lines: [{ kind: 'add', text: 'two\nlines' }] }] },
  ],
  ['history', { items: [{ id: 'event', title: 'Started', time: 'yesterday' }] }],
  ['tabs', { tabs: [{ title: 'Recursive', child: 'tabs' }] }],
  [
    'tabs',
    {
      tabs: [
        { title: 'First', child: 'changes' },
        { title: 'Duplicate', child: 'changes' },
      ],
    },
  ],
  ['details', { child: 'missing-child' }],
])('rejects invalid workbench definitions for %s', (id, properties) => {
  expect(() => a2uiProcessor(workbenchComponents(id, properties))).toThrow(/A2UI|Expected string/)
})

it('validates media, local dialog triggers and saved configuration values', () => {
  const processor = a2uiProcessor(mediaAndConfiguration.messages)
  try {
    const configuration = { '/volume': 0.8, '/when': '2028-02-29T16:30' }
    a2uiApplyValues(processor, { configuration }, true)
    expect(a2uiInputValues(processor)).toEqual({ configuration })
    expect(() => a2uiEvent(processor, 'configuration', 'open')).toThrow('Unknown A2UI action')
    expect(() =>
      a2uiApplyValues(processor, { configuration: { ...configuration, '/volume': 0.83 } }),
    ).toThrow('steps')
    expect(() =>
      a2uiApplyValues(processor, {
        configuration: { ...configuration, '/when': '2027-02-29T16:30' },
      }),
    ).toThrow('ISO local')
  } finally {
    processor.dispose()
  }
})

it.each([
  'javascript:alert(1)',
  'data:image/svg+xml;base64,PHN2Zz4=',
  'https://user:password@example.org/media.png',
  'file:///tmp/media.png',
])('rejects unsupported media URLs at publication and through bindings (%s)', (url) => {
  const message = {
    version: '1.0',
    createSurface: {
      surfaceId: 'media',
      catalogId: a2uiCatalog.id,
      components: [{ id: 'root', component: 'Image', url: { '@path': '/preview' } }],
      dataModel: { preview: url },
    },
  }
  expect(() => a2uiProcessor([message])).toThrow(/supported image data URL/)
  expect(() =>
    a2uiProcessor([
      {
        ...message,
        createSurface: {
          ...message.createSurface,
          components: [{ id: 'root', component: 'Image', url }],
        },
      },
    ]),
  ).toThrow(/Invalid A2UI messages/)
})
